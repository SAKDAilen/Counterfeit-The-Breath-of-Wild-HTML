'use strict';

/**
 * Integration test for the Hyrule backend.
 *
 * Starts the server on an ephemeral port with an isolated temp DATA_DIR and
 * exercises every public endpoint. Prints PASS/FAIL per check and exits with
 * a non-zero status when anything fails.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { start } = require('./index');

const PASS = [];
const FAIL = [];

let base = '';
let started = null;
let tempDir = '';
const originalDataDir = process.env.DATA_DIR;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
        actual
      )}`
    );
  }
}

async function check(name, fn) {
  try {
    await fn();
    PASS.push(name);
    console.log(`PASS  ${name}`);
  } catch (error) {
    FAIL.push(name);
    console.log(`FAIL  ${name}`);
    console.log(`      ${error && error.message ? error.message : error}`);
  }
}

async function api(pathname, options) {
  const fetchOptions = Object.assign({}, options || {});
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(5000);
  const response = await fetch(base + pathname, fetchOptions);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    /* caller decides how to report malformed JSON */
  }
  return { response, text, body };
}

function rawGet(pathname, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: started.port,
        method: 'GET',
        path: pathname,
        headers: headers || {},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    request.on('error', reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`raw GET timed out for ${pathname}`));
    });
    request.end();
  });
}

function waitForClose(server) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    if (typeof timer.unref === 'function') timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  });
}

async function run() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botw-server-test-'));
  process.env.DATA_DIR = tempDir;
  console.log(`[test] temp DATA_DIR: ${tempDir}`);

  try {
    started = await start({ port: 0, host: '127.0.0.1' });
    base = started.url;
    console.log(`[test] server listening on ${base}`);
  } catch (error) {
    FAIL.push('server startup');
    console.log('FAIL  server startup');
    console.log(`      ${error.message}`);
  }

  if (started) {
    const profileId = `test-link-${process.pid}-${Date.now()}`;
    const saveData = {
      hearts: 3,
      location: 'Great Plateau',
      inventory: ['sword', 'shield'],
      progress: { shrines: 4, koroks: 2 },
    };
    const saveMeta = { playtime: 1234, summary: 'Great Plateau' };
    let saveSize = null;

    await check('GET /api/health', async () => {
      const { response, body } = await api('/api/health');
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok should be true');
      assert(typeof body.version === 'string' && body.version.length > 0, 'version');
      assert(typeof body.uptimeMs === 'number' && body.uptimeMs >= 0, 'uptimeMs');
      assert(body.features && body.features.cloudSave === true, 'cloudSave feature');
      assert(body.features.i18n === true, 'i18n feature');
      assert(body.features.leaderboard === true, 'leaderboard feature');
      assert(body.features.profiles === true, 'profiles feature');
      assert(
        (response.headers.get('content-type') || '').includes('application/json'),
        'JSON content type'
      );
      assertEqual(response.headers.get('access-control-allow-origin'), '*', 'CORS');
    });

    await check('OPTIONS /api/* preflight', async () => {
      const { response } = await api('/api/anything', { method: 'OPTIONS' });
      assertEqual(response.status, 204, 'status');
      assertEqual(response.headers.get('access-control-allow-origin'), '*', 'CORS origin');
      const methods = response.headers.get('access-control-allow-methods') || '';
      assert(methods.includes('GET') && methods.includes('PUT'), 'allow methods');
      assertEqual(response.headers.get('access-control-max-age'), '86400', 'max-age');
    });

    await check('GET /api/config', async () => {
      const { response, body } = await api('/api/config');
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.defaultLanguage, 'zh-CN', 'defaultLanguage');
      assert(Array.isArray(body.languages), 'languages should be an array');
      assert(
        body.languages.some((language) => language.id === 'zh-CN'),
        'languages should include zh-CN'
      );
      for (const language of body.languages) {
        assert(typeof language.id === 'string', 'language id');
        assert(typeof language.nativeName === 'string', 'nativeName');
        assert(typeof language.entries === 'number', 'entries count');
      }
      assertEqual(body.limits.maxSaveBytes, 1048576, 'maxSaveBytes');
      assertEqual(body.limits.maxSlots, 8, 'maxSlots');
      assert(body.features && body.features.profiles === true, 'features');
    });

    await check('GET /api/i18n language list', async () => {
      const { response, body } = await api('/api/i18n');
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assert(Array.isArray(body.languages), 'languages array');
    });

    await check('GET missing language -> 404 JSON', async () => {
      const { response, body } = await api('/api/i18n/xx-missing');
      assertEqual(response.status, 404, 'status');
      assert(body && body.ok === false, 'ok should be false');
      assertEqual(body.error.code, 'LANG_NOT_FOUND', 'error code');
    });

    await check('GET / serves main.html', async () => {
      const { response, text } = await api('/');
      assertEqual(response.status, 200, 'status');
      assert(
        (response.headers.get('content-type') || '').includes('text/html'),
        'HTML content type'
      );
      assertEqual(
        response.headers.get('cache-control'),
        'no-cache',
        'HTML cache-control'
      );
      assert(text.trimStart().toLowerCase().startsWith('<!doctype'), 'doctype');
    });

    await check('GET /js/api.js static client', async () => {
      const { response, text } = await api('/js/api.js');
      assertEqual(response.status, 200, 'status');
      assert(
        (response.headers.get('content-type') || '').includes('javascript'),
        'JavaScript content type'
      );
      assert(
        (response.headers.get('cache-control') || '').includes('max-age=3600'),
        'asset cache-control'
      );
      assert(text.includes('BOTW_API'), 'client attaches BOTW_API');
    });

    await check('GET unknown static -> plain-text 404', async () => {
      const { response, text } = await api('/definitely-not-a-real-file.txt');
      assertEqual(response.status, 404, 'status');
      assert(
        (response.headers.get('content-type') || '').includes('text/plain'),
        'plain text content type'
      );
      assertEqual(text, '404 Not Found', '404 body');
    });

    await check('ETag, conditional 304, HEAD and gzip', async () => {
      const first = await api('/main.html');
      assertEqual(first.response.status, 200, 'first GET');
      const etag = first.response.headers.get('etag');
      assert(etag && etag.startsWith('"'), 'quoted ETag');

      const conditional = await fetch(base + '/main.html', {
        headers: { 'If-None-Match': etag },
        signal: AbortSignal.timeout(5000),
      });
      assertEqual(conditional.status, 304, 'conditional status');
      assertEqual(conditional.headers.get('etag'), etag, '304 ETag');
      await conditional.arrayBuffer();

      const head = await fetch(base + '/main.html', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      assertEqual(head.status, 200, 'HEAD status');
      assert(
        Number(head.headers.get('content-length')) > 0,
        'HEAD content-length'
      );
      assertEqual(await head.text(), '', 'HEAD body must be empty');

      const raw = await rawGet('/main.html', { 'Accept-Encoding': 'gzip' });
      assertEqual(raw.status, 200, 'raw status');
      assertEqual(raw.headers['content-encoding'], 'gzip', 'gzip encoding');
      assert((raw.headers.vary || '').includes('Accept-Encoding'), 'Vary header');
    });

    await check('path traversal cannot leak package.json', async () => {
      for (const attempted of [
        '/../package.json',
        '/%2e%2e/package.json',
        '/%2e%2e%2fpackage.json',
        '/package.json',
      ]) {
        const response = await rawGet(attempted);
        const text = response.body.toString('utf8');
        assert(response.status !== 200, `${attempted} returned 200`);
        assert(!text.includes('botw-hyrule'), `${attempted} leaked package source`);
      }
    });

    let profileCreated = false;
    await check('GET /api/profile/:id auto-creates profile', async () => {
      const { response, body } = await api(
        `/api/profile/${encodeURIComponent(profileId)}`
      );
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.profile.id, profileId, 'profile id');
      assertEqual(body.profile.nickname, 'Link', 'default nickname');
      assert(typeof body.profile.createdAt === 'string', 'createdAt');
      assert(typeof body.profile.updatedAt === 'string', 'updatedAt');
      assert(Array.isArray(body.slots) && body.slots.length === 0, 'empty slots');
      profileCreated = true;
    });

    await check('GET missing save -> 404 JSON', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}?slot=auto`
      );
      assertEqual(response.status, 404, 'status');
      assertEqual(body.error.code, 'SAVE_NOT_FOUND', 'error code');
    });

    await check('PUT save', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}/auto`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: saveData, meta: saveMeta }),
        }
      );
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.slot, 'auto', 'slot');
      const expectedSize = Buffer.byteLength(JSON.stringify(saveData), 'utf8');
      assertEqual(body.size, expectedSize, 'size');
      saveSize = body.size;
      assert(typeof body.updatedAt === 'string', 'updatedAt');
    });

    await check('GET save round-trips data', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}?slot=auto`
      );
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.slot, 'auto', 'slot');
      assert(
        JSON.stringify(body.data) === JSON.stringify(saveData),
        'save data should round-trip'
      );
      assert(typeof body.updatedAt === 'string', 'updatedAt');
    });

    await check('GET profile lists saved slots', async () => {
      assert(profileCreated, 'profile must have been created');
      const { response, body } = await api(
        `/api/profile/${encodeURIComponent(profileId)}`
      );
      assertEqual(response.status, 200, 'status');
      assertEqual(body.slots.length, 1, 'slot count');
      const slot = body.slots[0];
      assertEqual(slot.slot, 'auto', 'slot name');
      assertEqual(slot.size, saveSize, 'slot size');
      assertEqual(slot.summary, saveMeta.summary, 'slot summary');
      assert(typeof slot.updatedAt === 'string', 'slot updatedAt');
    });

    await check('PUT non-object save data -> 400', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}/manual`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'not-an-object' }),
        }
      );
      assertEqual(response.status, 400, 'status');
      assertEqual(body.error.code, 'SAVE_INVALID', 'error code');
    });

    await check('DELETE save', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}/auto`,
        { method: 'DELETE' }
      );
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.deleted, true, 'deleted');
      const after = await api(
        `/api/save/${encodeURIComponent(profileId)}?slot=auto`
      );
      assertEqual(after.response.status, 404, 'save should be gone');
    });

    await check('DELETE missing save reports deleted:false', async () => {
      const { response, body } = await api(
        `/api/save/${encodeURIComponent(profileId)}/auto`,
        { method: 'DELETE' }
      );
      assertEqual(response.status, 200, 'status');
      assertEqual(body.deleted, false, 'deleted');
    });

    await check('GET empty records boards', async () => {
      const { response, body } = await api('/api/records?board=all');
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      for (const board of ['korok', 'shrines', 'ganon']) {
        assert(Array.isArray(body.boards[board]), `${board} array`);
        assertEqual(body.boards[board].length, 0, `${board} should start empty`);
      }
    });

    await check('POST three records with ranks', async () => {
      const submissions = [
        ['Alpha', 10],
        ['Beta', 30],
        ['Gamma', 20],
      ];
      const ranks = [];
      for (const [name, value] of submissions) {
        const { response, body } = await api('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            board: 'korok',
            name,
            value,
            meta: { source: 'integration-test' },
          }),
        });
        assertEqual(response.status, 200, `POST ${name} status`);
        assert(body && body.ok === true, `POST ${name} ok`);
        assertEqual(body.board, 'korok', 'board');
        ranks.push(body.rank);
      }
      // Ranks describe the board immediately after each submission:
      // Alpha 10 -> 1, Beta 30 -> 1, Gamma 20 -> 2 (Alpha falls to third).
      assert(
        ranks.every((rank) => Number.isInteger(rank) && rank >= 1),
        `ranks should be positive integers, got ${JSON.stringify(ranks)}`
      );
      assertEqual(ranks[0], 1, 'first submission rank');
      assertEqual(ranks[1], 1, 'new best rank');
      assertEqual(ranks[2], 2, 'middle submission rank');
    });

    await check('GET records sorted descending', async () => {
      const { response, body } = await api('/api/records?board=korok');
      assertEqual(response.status, 200, 'status');
      const list = body.boards.korok;
      assertEqual(list.length, 3, 'entry count');
      assertEqual(list[0].name, 'Beta', 'first name');
      assertEqual(list[0].value, 30, 'first value');
      assertEqual(list[1].name, 'Gamma', 'second name');
      assertEqual(list[2].name, 'Alpha', 'third name');
      assert(
        list[0].value >= list[1].value && list[1].value >= list[2].value,
        'values should be descending'
      );
      assert(typeof list[0].updatedAt === 'string', 'entry updatedAt');
      assert(list[0].meta && list[0].meta.source === 'integration-test', 'meta');

      const otherBoards = await api('/api/records?board=shrines');
      for (const board of ['korok', 'shrines', 'ganon']) {
        assert(Array.isArray(otherBoards.body.boards[board]), `${board} in response`);
      }
    });

    await check('POST invalid record -> 400', async () => {
      const { response, body } = await api('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'ganon', name: '', value: -1 }),
      });
      assertEqual(response.status, 400, 'status');
      assertEqual(body.ok, false, 'ok');
      assert(typeof body.error.code === 'string', 'error code');
    });

    await check('POST malformed JSON -> 400 JSON', async () => {
      const { response, body, text } = await api('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"broken":',
      });
      assertEqual(response.status, 400, 'status');
      assertEqual(body && body.ok, false, 'ok');
      assertEqual(body.error.code, 'INVALID_JSON', 'error code');
      assert(!text.startsWith('<'), 'must not be HTML');
    });

    await check('GET unknown API -> 404 JSON', async () => {
      const { response, body, text } = await api('/api/does-not-exist');
      assertEqual(response.status, 404, 'status');
      assert(
        (response.headers.get('content-type') || '').includes('application/json'),
        'JSON content type'
      );
      assertEqual(body && body.ok, false, 'ok');
      assertEqual(body.error.code, 'NOT_FOUND', 'error code');
      assert(!text.startsWith('<'), 'must not be HTML');
    });

    await check('GET /api/stats', async () => {
      const { response, body } = await api('/api/stats');
      assertEqual(response.status, 200, 'status');
      assert(body && body.ok === true, 'ok');
      assertEqual(body.profiles, 1, 'profiles count');
      assertEqual(body.saves, 0, 'saves count');
      assertEqual(body.records.korok, 3, 'korok records count');
      assertEqual(body.records.shrines, 0, 'shrines records count');
      assertEqual(body.records.ganon, 0, 'ganon records count');
      assert(typeof body.uptimeMs === 'number', 'uptimeMs');
    });
  }

  if (started) {
    await waitForClose(started.server);
  }

  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {
    /* temp cleanup is best effort on Windows */
  }

  const total = PASS.length + FAIL.length;
  console.log('');
  console.log(`${PASS.length}/${total} checks passed, ${FAIL.length} failed.`);
  if (FAIL.length > 0) {
    console.log(`Failed: ${FAIL.join(' | ')}`);
  }

  process.exit(FAIL.length > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('[test] fatal error:', error && error.stack ? error.stack : error);
  if (started && started.server) {
    try {
      started.server.close();
      if (typeof started.server.closeAllConnections === 'function') {
        started.server.closeAllConnections();
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
  process.exit(1);
});
