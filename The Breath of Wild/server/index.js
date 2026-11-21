'use strict';

/**
 * Hyrule backend server.
 *
 * Serves the static game (project root) and the JSON API used for cloud saves,
 * profiles, translation dictionaries and leaderboards. Only Node.js built-ins
 * are used. Start with `node server/index.js` or require `{ start }` in tests.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const {
  Store,
  StoreError,
  MAX_SAVE_BYTES,
  PROFILE_ID_RE,
  SLOT_RE,
  BOARDS,
} = require('./store');

const VERSION = '1.0.0';
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LANGUAGE = 'zh-CN';
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB request bodies
const TOP_RECORDS = 20;
const WRITE_LIMIT = 60;
const WRITE_WINDOW_MS = 60 * 1000;
const MAX_RECORD_NAME_LENGTH = 24;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const LOCALE_ID_RE = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})*$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

const FEATURES = Object.freeze({
  cloudSave: true,
  i18n: true,
  leaderboard: true,
  profiles: true,
});

const LIMITS = Object.freeze({
  maxSaveBytes: MAX_SAVE_BYTES,
  maxSlots: 8,
});

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
});

const NATIVE_LANGUAGE_NAMES = Object.freeze({
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
});

const LANGUAGE_ORDER = [
  'zh-CN',
  'en',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'ru',
  'pt',
  'it',
];

// Files that should never be exposed by the static file server. Data includes
// cloud saves; server/package files include source. Translating traversal to a
// direct hit on one of these still yields 404.
const BLOCKED_TOP_LEVEL = new Set([
  'server',
  'data',
  'node_modules',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'start-server.bat',
]);

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, code, message, options) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = (options && options.headers) || null;
    this.closeRequest = Boolean(options && options.closeRequest);
  }
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function nowMs() {
  return Date.now();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanRecordName(value) {
  return typeof value === 'string'
    ? value.trim().replace(CONTROL_CHARS_RE, '').trim()
    : '';
}

function clientIp(req) {
  const address = (req.socket && req.socket.remoteAddress) || 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function supportsGzip(req) {
  const header = req.headers['accept-encoding'];
  if (!header) return false;

  return header.split(',').some((part) => {
    const pieces = part.trim().split(';');
    const coding = pieces[0].trim().toLowerCase();
    if (coding !== 'gzip' && coding !== '*') return false;

    let quality = 1;
    for (const parameter of pieces.slice(1)) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter);
      if (match) quality = Number(match[1]);
    }
    return Number.isFinite(quality) && quality > 0;
  });
}

function isCompressible(contentType) {
  return /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg\+xml)/i.test(
    contentType
  );
}

function cacheControlFor(relativePath, extension) {
  if (extension === '.html' || extension === '.htm') return 'no-cache';
  const first = relativePath.split('/')[0].toLowerCase();
  if (first === 'assets' || first === 'js' || first === 'locales') {
    return 'public, max-age=3600';
  }
  if (
    ['.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2', '.woff', '.wasm'].includes(
      extension
    )
  ) {
    return 'public, max-age=3600';
  }
  return 'no-cache';
}

// -----------------------------------------------------------------------------
// HTTP response helpers
// -----------------------------------------------------------------------------

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Allows Chrome's Private Network Access preflight when main.html is opened
  // from a public/file origin but talks to this localhost server.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, status, payload, extraHeaders) {
  if (res.writableEnded || res.destroyed) return;

  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }
  res.end(body);
}

function sendText(req, res, status, text, extraHeaders) {
  if (res.writableEnded || res.destroyed) return;

  const body = Buffer.from(text, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendStaticNotFound(req, res) {
  sendText(req, res, 404, '404 Not Found');
}

// -----------------------------------------------------------------------------
// Request body parsing
// -----------------------------------------------------------------------------

function tooLargeError() {
  return new HttpError(
    413,
    'PAYLOAD_TOO_LARGE',
    `Request body must not exceed ${MAX_BODY_BYTES} bytes.`,
    { closeRequest: true, headers: { Connection: 'close' } }
  );
}

/**
 * Read a JSON request body with a hard byte limit. On overflow the request is
 * paused; the caller sends a 413 and the server destroys the socket after the
 * response has been flushed.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    let total = 0;

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAborted);
      req.removeListener('error', onError);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function onData(chunk) {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.pause();
        fail(tooLargeError());
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) return;
      let value;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        value = JSON.parse(text);
      } catch (_) {
        fail(
          new HttpError(
            400,
            'INVALID_JSON',
            'Request body must contain valid JSON.'
          )
        );
        return;
      }
      finish(value);
    }

    function onAborted() {
      const error = new Error('Client aborted the request.');
      error.isAborted = true;
      fail(error);
    }

    function onError(error) {
      fail(error);
    }

    if (req.aborted || req.destroyed) {
      const error = new Error('Client aborted the request.');
      error.isAborted = true;
      reject(error);
      return;
    }

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      req.pause();
      reject(tooLargeError());
      return;
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
  });
}

// -----------------------------------------------------------------------------
// Per-IP write rate limiting (GETs are unlimited)
// -----------------------------------------------------------------------------

class WriteRateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  consume(ip) {
    const now = nowMs();
    const cutoff = now - this.windowMs;
    let entries = this.hits.get(ip);

    if (!entries) {
      entries = [];
      this.hits.set(ip, entries);
    }

    while (entries.length > 0 && entries[0] <= cutoff) entries.shift();

    if (entries.length >= this.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, entries[0] + this.windowMs - now),
        remaining: 0,
      };
    }

    entries.push(now);
    if (this.hits.size > 2000) this._prune(cutoff);
    return { allowed: true, remaining: this.limit - entries.length };
  }

  _prune(cutoff) {
    for (const [ip, entries] of this.hits) {
      if (entries.length === 0 || entries[entries.length - 1] <= cutoff) {
        this.hits.delete(ip);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// I18n dictionaries (read from disk on every request)
// -----------------------------------------------------------------------------

function nativeLanguageName(id) {
  return NATIVE_LANGUAGE_NAMES[id] || id;
}

function languageRank(id) {
  const index = LANGUAGE_ORDER.indexOf(id);
  return index === -1 ? LANGUAGE_ORDER.length : index;
}

/**
 * Discover flat JSON dictionaries in locales/. Missing directory is fine.
 * The default language is always listed, even before its file exists.
 */
function listLanguages(localesDir) {
  const found = new Map();

  let files = [];
  try {
    files = fs.readdirSync(localesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[botw] Could not read locales directory: ${err.message}`);
    }
  }

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;
    const id = file.name.slice(0, -'.json'.length);
    if (!LOCALE_ID_RE.test(id)) continue;

    let entries = 0;
    try {
      const dict = JSON.parse(
        fs.readFileSync(path.join(localesDir, file.name), 'utf8')
      );
      if (isPlainObject(dict)) entries = Object.keys(dict).length;
    } catch (_) {
      // Advertise the language with zero entries; the detail endpoint reports
      // a JSON error if the dictionary itself is broken.
    }
    found.set(id, entries);
  }

  if (!found.has(DEFAULT_LANGUAGE)) found.set(DEFAULT_LANGUAGE, 0);

  return [...found.entries()]
    .sort(([a], [b]) => {
      const rankDiff = languageRank(a) - languageRank(b);
      return rankDiff !== 0 ? rankDiff : a.localeCompare(b);
    })
    .map(([id, entries]) => ({ id, nativeName: nativeLanguageName(id), entries }));
}

/** Read one locale at request time. Missing dictionaries are HTTP 404 JSON. */
function readLanguage(localesDir, lang) {
  if (!LOCALE_ID_RE.test(lang)) {
    throw new HttpError(404, 'LANG_NOT_FOUND', `Language '${lang}' was not found.`);
  }

  const file = path.join(localesDir, `${lang}.json`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      throw new HttpError(
        404,
        'LANG_NOT_FOUND',
        `Language '${lang}' was not found.`
      );
    }
    console.error(`[botw] Could not read locale ${lang}: ${err.message}`);
    throw new HttpError(500, 'I18N_READ_FAILED', 'Could not read that language.');
  }

  let dict;
  try {
    dict = JSON.parse(raw);
  } catch (err) {
    console.error(`[botw] Invalid locale file ${file}: ${err.message}`);
    throw new HttpError(500, 'I18N_INVALID', 'That language dictionary is invalid.');
  }

  if (!isPlainObject(dict)) {
    console.error(`[botw] Invalid locale file ${file}: root value is not an object`);
    throw new HttpError(500, 'I18N_INVALID', 'That language dictionary is invalid.');
  }

  return { entries: Object.keys(dict).length, dict };
}

// -----------------------------------------------------------------------------
// Static file handling
// -----------------------------------------------------------------------------

function etagFor(stat) {
  const hash = crypto
    .createHash('sha1')
    .update(`${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
  return `"${stat.size.toString(16)}-${hash}"`;
}

function matchesIfNoneMatch(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  return header.split(',').some((candidate) => {
    let value = candidate.trim();
    if (value === '*') return true;
    if (value.startsWith('W/')) value = value.slice(2);
    return value === etag;
  });
}

/** Serve non-/api paths from the project root only. */
function serveStatic(req, res, state) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(req, res, 405, '405 Method Not Allowed', {
      Allow: 'GET, HEAD, OPTIONS',
    });
    return;
  }

  const rawUrl = req.url || '/';
  const queryIndex = rawUrl.indexOf('?');
  const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  if (!rawPath.startsWith('/')) {
    sendText(req, res, 400, '400 Bad Request');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (_) {
    sendText(req, res, 400, '400 Bad Request');
    return;
  }

  // Reject null bytes, Windows separator tricks, and explicit dot segments.
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    sendStaticNotFound(req, res);
    return;
  }

  const parts = decodedPath.split('/').filter(Boolean);
  if (
    parts.some(
      (part) => part === '.' || part === '..' || part.startsWith('.')
    )
  ) {
    sendStaticNotFound(req, res);
    return;
  }
  if (parts[0] && BLOCKED_TOP_LEVEL.has(parts[0].toLowerCase())) {
    sendStaticNotFound(req, res);
    return;
  }

  const relativePath = parts.length > 0 ? parts.join('/') : 'main.html';
  const target = path.resolve(state.rootReal, relativePath);
  if (!isInside(state.rootReal, target)) {
    sendStaticNotFound(req, res);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_) {
    sendStaticNotFound(req, res);
    return;
  }
  if (!stat.isFile()) {
    sendStaticNotFound(req, res);
    return;
  }

  // Resolve symlinks and ensure the real target is still inside the root and
  // not one of the private top-level paths.
  let realTarget;
  try {
    realTarget = fs.realpathSync(target);
  } catch (_) {
    sendStaticNotFound(req, res);
    return;
  }
  if (!isInside(state.rootReal, realTarget)) {
    sendStaticNotFound(req, res);
    return;
  }
  const realRelative = path.relative(state.rootReal, realTarget).split(path.sep);
  if (
    realRelative.some((part) => part.startsWith('.')) ||
    BLOCKED_TOP_LEVEL.has(String(realRelative[0] || '').toLowerCase())
  ) {
    sendStaticNotFound(req, res);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const etag = etagFor(stat);
  const cacheControl = cacheControlFor(relativePath, ext);
  const compressible = isCompressible(contentType);

  if (matchesIfNoneMatch(req, etag)) {
    res.statusCode = 304;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControl);
    if (compressible) res.setHeader('Vary', 'Accept-Encoding');
    res.end();
    return;
  }

  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(realTarget);
  } catch (_) {
    sendStaticNotFound(req, res);
    return;
  }

  let body = fileBuffer;
  let gzipped = false;
  if (fileBuffer.length > 1024 && compressible && supportsGzip(req)) {
    try {
      body = zlib.gzipSync(fileBuffer, { level: 6 });
      gzipped = true;
    } catch (err) {
      console.error(`[botw] gzip failed for ${relativePath}: ${err.message}`);
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  if (compressible) res.setHeader('Vary', 'Accept-Encoding');
  if (gzipped) res.setHeader('Content-Encoding', 'gzip');
  res.end(req.method === 'HEAD' ? undefined : body);
}

// -----------------------------------------------------------------------------
// API helpers
// -----------------------------------------------------------------------------

function requireMethod(req, methods) {
  if (methods.includes(req.method)) return;
  throw new HttpError(
    405,
    'METHOD_NOT_ALLOWED',
    `Method ${req.method} is not allowed for this endpoint.`,
    { headers: { Allow: [...methods, 'OPTIONS'].join(', ') } }
  );
}

function requireProfileId(id) {
  if (!PROFILE_ID_RE.test(id)) {
    throw new HttpError(
      400,
      'INVALID_PROFILE_ID',
      'Profile id must match ^[A-Za-z0-9_-]{1,40}$.'
    );
  }
}

function requireSlot(slot) {
  if (!SLOT_RE.test(slot)) {
    throw new HttpError(
      400,
      'INVALID_SLOT',
      'Slot must match ^[a-z0-9_-]{1,16}$.'
    );
  }
}

function readSlotQuery(url) {
  const raw = url.searchParams.get('slot');
  const slot = raw === null ? 'auto' : raw;
  requireSlot(slot);
  return slot;
}

function readBoardQuery(url) {
  const board = url.searchParams.get('board');
  if (board === null) return 'all';
  if (board !== 'all' && !BOARDS.includes(board)) {
    throw new HttpError(
      400,
      'INVALID_BOARD',
      'board must be all, korok, shrines or ganon.'
    );
  }
  return board;
}

function topBoards(records) {
  const boards = {};
  for (const board of BOARDS) {
    boards[board] = Array.isArray(records[board])
      ? records[board].slice(0, TOP_RECORDS)
      : [];
  }
  return boards;
}

function uptimeMs(state) {
  return Math.max(0, nowMs() - state.startedAt);
}

async function handleApi(req, res, url, state) {
  if (WRITE_METHODS.has(req.method)) {
    const limit = state.rateLimiter.consume(clientIp(req));
    if (!limit.allowed) {
      const retryAfter = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
      req.resume();
      sendJson(
        res,
        429,
        {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many write requests. Please try again shortly.',
          },
        },
        { 'Retry-After': String(retryAfter) }
      );
      return;
    }
  }

  let segments;
  try {
    segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch (_) {
    throw new HttpError(400, 'INVALID_PATH', 'Malformed URL encoding.');
  }

  if (segments[0] !== 'api') {
    throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found.');
  }
  segments = segments.slice(1);

  if (segments.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found.');
  }

  // GET /api/health
  if (segments[0] === 'health' && segments.length === 1) {
    requireMethod(req, ['GET']);
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      uptimeMs: uptimeMs(state),
      features: FEATURES,
    });
    return;
  }

  // GET /api/config
  if (segments[0] === 'config' && segments.length === 1) {
    requireMethod(req, ['GET']);
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      defaultLanguage: DEFAULT_LANGUAGE,
      languages: listLanguages(state.localesDir),
      features: FEATURES,
      limits: LIMITS,
    });
    return;
  }

  // GET /api/i18n and GET /api/i18n/:lang
  if (segments[0] === 'i18n' && segments.length <= 2) {
    requireMethod(req, ['GET']);
    if (segments.length === 1) {
      sendJson(res, 200, {
        ok: true,
        languages: listLanguages(state.localesDir),
      });
      return;
    }

    const lang = segments[1];
    const dictionary = readLanguage(state.localesDir, lang);
    sendJson(res, 200, {
      ok: true,
      lang,
      entries: dictionary.entries,
      dict: dictionary.dict,
    });
    return;
  }

  // GET /api/profile/:id
  if (segments[0] === 'profile' && segments.length === 2) {
    requireMethod(req, ['GET']);
    const id = segments[1];
    requireProfileId(id);
    const profile = state.store.getOrCreateProfile(id);
    sendJson(res, 200, {
      ok: true,
      profile,
      slots: state.store.listSlots(id),
    });
    return;
  }

  // GET /api/save/:id?slot=auto
  if (segments[0] === 'save' && segments.length === 2) {
    requireMethod(req, ['GET']);
    const id = segments[1];
    requireProfileId(id);
    const slot = readSlotQuery(url);
    const save = state.store.getSave(id, slot);
    if (!save) {
      throw new HttpError(
        404,
        'SAVE_NOT_FOUND',
        `No save exists for slot '${slot}'.`
      );
    }
    sendJson(res, 200, {
      ok: true,
      slot,
      data: save.data,
      updatedAt: save.updatedAt,
    });
    return;
  }

  // PUT or DELETE /api/save/:id/:slot
  if (segments[0] === 'save' && segments.length === 3) {
    const id = segments[1];
    const slot = segments[2];
    requireProfileId(id);
    requireSlot(slot);

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!isPlainObject(body) || !isPlainObject(body.data)) {
        throw new HttpError(400, 'SAVE_INVALID', 'Body must be {data: object, meta?: object}.');
      }
      if (
        body.meta !== undefined &&
        body.meta !== null &&
        !isPlainObject(body.meta)
      ) {
        throw new HttpError(400, 'SAVE_INVALID', 'meta must be a JSON object.');
      }

      const result = state.store.putSave(id, slot, body.data, body.meta);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'DELETE') {
      const deleted = state.store.deleteSave(id, slot);
      sendJson(res, 200, { ok: true, deleted });
      return;
    }

    requireMethod(req, ['PUT', 'DELETE']);
  }

  // GET or POST /api/records
  if (segments[0] === 'records' && segments.length === 1) {
    if (req.method === 'GET') {
      readBoardQuery(url);
      const records = state.store.getRecords();
      sendJson(res, 200, { ok: true, boards: topBoards(records) });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!isPlainObject(body)) {
        throw new HttpError(400, 'INVALID_RECORD', 'Body must be a JSON object.');
      }

      if (
        typeof body.board !== 'string' ||
        !BOARDS.includes(body.board)
      ) {
        throw new HttpError(
          400,
          'INVALID_BOARD',
          'board must be korok, shrines or ganon.'
        );
      }

      const name = cleanRecordName(body.name);
      if (!name || Array.from(name).length > MAX_RECORD_NAME_LENGTH) {
        throw new HttpError(
          400,
          'INVALID_NAME',
          'name must be 1-24 characters after trimming.'
        );
      }

      if (
        typeof body.value !== 'number' ||
        !Number.isFinite(body.value) ||
        body.value < 0
      ) {
        throw new HttpError(
          400,
          'INVALID_VALUE',
          'value must be a finite number greater than or equal to 0.'
        );
      }

      const result = state.store.addRecord(
        body.board,
        name,
        body.value,
        body.meta
      );
      sendJson(res, 200, {
        ok: true,
        rank: result.rank,
        board: result.board,
      });
      return;
    }

    requireMethod(req, ['GET', 'POST']);
  }

  // GET /api/stats
  if (segments[0] === 'stats' && segments.length === 1) {
    requireMethod(req, ['GET']);
    const stats = state.store.getStats();
    sendJson(res, 200, {
      ok: true,
      profiles: stats.profiles,
      saves: stats.saves,
      records: stats.records,
      uptimeMs: uptimeMs(state),
    });
    return;
  }

  throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found.');
}

// -----------------------------------------------------------------------------
// Request dispatch / errors
// -----------------------------------------------------------------------------

async function handleRequest(req, res, state) {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch (_) {
    throw new HttpError(400, 'INVALID_URL', 'Malformed request URL.');
  }

  const isApi =
    url.pathname === '/api' || url.pathname.startsWith('/api/');

  if (isApi) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    await handleApi(req, res, url, state);
    return;
  }

  serveStatic(req, res, state);
}

function handleRequestError(req, res, error) {
  // Note: after a request body is fully consumed Node marks the IncomingMessage
  // as destroyed, even though the client is still waiting for the response.
  // Only the response state (and an explicit abort) tells us the client is gone.
  if (req.aborted || res.destroyed || !res.writable) return;

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Unexpected server error.';
  let headers = null;
  let closeRequest = false;

  if (error instanceof HttpError) {
    status = error.status;
    code = error.code;
    message = error.message;
    headers = error.headers;
    closeRequest = error.closeRequest;
  } else if (error instanceof StoreError) {
    status = error.status || 400;
    code = error.code;
    message = error.message;
  } else if (error && error.isAborted) {
    return;
  } else {
    console.error(
      '[botw] Unhandled request error:',
      error && error.stack ? error.stack : error
    );
  }

  if (res.headersSent) {
    res.destroy();
    return;
  }

  // Error paths that happen before a body reader attaches (for example a
  // wrong HTTP method) still need the request body drained so the connection
  // can be reused. Oversized-body errors intentionally close the connection.
  if (!req.complete && !closeRequest) req.resume();

  if (closeRequest) {
    headers = { ...(headers || {}), Connection: 'close' };
    // Give the client a moment to read the JSON error before dropping a body
    // that is still being uploaded.
    res.once('finish', () => {
      const timer = setTimeout(() => {
        if (!req.destroyed) req.destroy();
      }, 150);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  sendJson(
    res,
    status,
    {
      ok: false,
      error: { code, message },
    },
    headers
  );
}

// -----------------------------------------------------------------------------
// Server factory
// -----------------------------------------------------------------------------

function normalizePort(value) {
  if (value === undefined || value === null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

/**
 * Create an unstarted HTTP server. Useful for tests that need an ephemeral
 * port: createServer({dataDir}).listen(0, '127.0.0.1').
 */
function createServer(options) {
  options = options || {};

  const root = path.resolve(options.root || path.join(__dirname, '..'));
  let rootReal = root;
  try {
    rootReal = fs.realpathSync(root);
  } catch (_) {
    /* fall back to the configured path */
  }

  const store = new Store({ dataDir: options.dataDir });
  const state = {
    root,
    rootReal,
    localesDir: path.join(root, 'locales'),
    store,
    rateLimiter: new WriteRateLimiter(WRITE_LIMIT, WRITE_WINDOW_MS),
    startedAt: nowMs(),
  };

  const server = http.createServer((req, res) => {
    // Errors on the individual request/socket should never take down the
    // process; body handling has its own listeners.
    req.on('error', () => {});
    res.on('error', () => {});
    applyCors(res);

    handleRequest(req, res, state).catch((error) => {
      handleRequestError(req, res, error);
    });
  });

  server.on('clientError', (error, socket) => {
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    const body = '400 Bad Request';
    socket.end(
      'HTTP/1.1 400 Bad Request\r\n' +
        'Connection: close\r\n' +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Access-Control-Allow-Origin: *\r\n' +
        'Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\n' +
        'Access-Control-Allow-Headers: Content-Type\r\n' +
        'Access-Control-Max-Age: 86400\r\n' +
        'Access-Control-Allow-Private-Network: true\r\n' +
        '\r\n' +
        body
    );
  });

  server.botw = { version: VERSION, root, store, state };
  return server;
}

/**
 * Start a server. Accepts an options object (or a port number for
 * convenience) and resolves after listening with {server, host, port, url}.
 */
function start(options) {
  if (typeof options === 'number') options = { port: options };
  options = options || {};

  return new Promise((resolve, reject) => {
    let server;
    try {
      server = createServer(options);
    } catch (error) {
      reject(error);
      return;
    }

    let port;
    let host;
    try {
      const configuredPort =
        options.port !== undefined ? normalizePort(options.port) : null;
      const envPort = normalizePort(process.env.PORT);
      port =
        configuredPort !== null
          ? configuredPort
          : envPort !== null
          ? envPort
          : DEFAULT_PORT;
      host = options.host || process.env.HOST || DEFAULT_HOST;
    } catch (error) {
      reject(error);
      return;
    }

    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      const actualPort =
        address && typeof address === 'object' ? address.port : port;
      const urlHost = host.includes(':') ? `[${host}]` : host;
      resolve({
        server,
        host,
        port: actualPort,
        url: `http://${urlHost}:${actualPort}`,
      });
    };

    server.once('error', onError);
    server.once('listening', onListening);

    try {
      server.listen(port, host);
    } catch (error) {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      reject(error);
    }
  });
}

// -----------------------------------------------------------------------------
// CLI entry point
// -----------------------------------------------------------------------------

function runCli() {
  start()
    .then(({ server, url }) => {
      console.log(`[botw] Hyrule server v${VERSION} listening on ${url}`);

      let closing = false;
      const shutdown = () => {
        if (closing) return;
        closing = true;
        const timer = setTimeout(() => process.exit(1), 3000);
        if (typeof timer.unref === 'function') timer.unref();
        server.close(() => {
          clearTimeout(timer);
          process.exit(0);
        });
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('[botw] Failed to start server:', error.message);
      process.exitCode = 1;
    });
}

if (require.main === module) runCli();

module.exports = {
  createServer,
  start,
  VERSION,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
