/*
 * Hyrule browser API client.
 *
 * Loaded as a classic (non-module) script. Exposes window.BOTW_API and works
 * both when the game is served over HTTP and when main.html is opened from
 * file:// (in which case it talks to http://127.0.0.1:8787 by default).
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_BASE = 'http://127.0.0.1:8787';
  var DEFAULT_TIMEOUT_MS = 3500;
  var PROFILE_KEY = 'botw_profile_id';
  var NICKNAME_KEY = 'botw_nickname';
  var PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var memoryStorage = Object.create(null);

  function stripTrailingSlash(value) {
    return String(value).replace(/\/+$/, '');
  }

  function detectBase() {
    var configured =
      typeof global.BOTW_SERVER === 'string' ? global.BOTW_SERVER.trim() : '';
    if (configured) return stripTrailingSlash(configured);

    var location = global.location;
    if (
      location &&
      typeof location.protocol === 'string' &&
      location.protocol.indexOf('http') === 0 &&
      location.origin &&
      location.origin !== 'null'
    ) {
      return stripTrailingSlash(location.origin);
    }

    return DEFAULT_BASE;
  }

  var BASE = detectBase();

  // localStorage can be unavailable/throw under some file:// contexts. Keep a
  // small in-page fallback so repeated helper calls remain stable.
  function storageGet(key) {
    try {
      if (global.localStorage) return global.localStorage.getItem(key);
    } catch (_) {
      /* storage blocked */
    }
    return key in memoryStorage ? memoryStorage[key] : null;
  }

  function storageSet(key, value) {
    var text = String(value);
    memoryStorage[key] = text;
    try {
      if (global.localStorage) global.localStorage.setItem(key, text);
    } catch (_) {
      /* keep the in-page fallback */
    }
  }

  function randomHex(byteCount) {
    var cryptoObj = global.crypto;
    var bytes = new Uint8Array(byteCount);
    var hex = '';
    var i;

    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(bytes);
      for (i = 0; i < bytes.length; i += 1) {
        hex += ('0' + bytes[i].toString(16)).slice(-2);
      }
      return hex;
    }

    for (i = 0; i < bytes.length; i += 1) {
      hex += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2);
    }
    return hex;
  }

  function generateProfileId() {
    var suffix = '';
    var cryptoObj = global.crypto;

    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      suffix = cryptoObj.randomUUID().replace(/-/g, '').slice(0, 16);
    } else {
      suffix = randomHex(8);
    }
    return 'link-' + suffix;
  }

  function getProfileId() {
    var id = storageGet(PROFILE_KEY);
    if (!id || !PROFILE_ID_RE.test(id)) {
      id = generateProfileId();
      storageSet(PROFILE_KEY, id);
    }
    return id;
  }

  function getNickname() {
    var nickname = storageGet(NICKNAME_KEY);
    if (typeof nickname !== 'string' || !nickname.trim()) return 'Link';
    return nickname.trim();
  }

  function setNickname(name) {
    var value =
      name === null || name === undefined ? '' : String(name).trim().slice(0, 24);
    if (!value) value = 'Link';
    storageSet(NICKNAME_KEY, value);
    return value;
  }

  function ApiError(message, code, status, payload) {
    this.name = 'ApiError';
    this.message = message || 'Request failed.';
    this.code = code || 'UNKNOWN';
    this.status = typeof status === 'number' ? status : 0;
    this.payload = payload || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ApiError);
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function joinUrl(pathname) {
    return BASE + pathname;
  }

  /**
   * Fetch JSON with a timeout. Rejects with an ApiError that carries `.code`,
   * `.status` and (when available) `.payload`.
   */
  async function request(pathname, options) {
    options = options || {};

    var timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    var controller =
      typeof global.AbortController === 'function'
        ? new global.AbortController()
        : null;
    var timedOut = false;
    var timer = null;
    var headers = { Accept: 'application/json' };

    if (options.headers) {
      Object.keys(options.headers).forEach(function (key) {
        headers[key] = options.headers[key];
      });
    }

    var fetchOptions = {
      method: options.method || 'GET',
      headers: headers,
      cache: 'no-store',
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      try {
        fetchOptions.body = JSON.stringify(options.body);
      } catch (_) {
        throw new ApiError('Request body is not valid JSON.', 'BAD_REQUEST');
      }
    }

    if (controller) {
      fetchOptions.signal = controller.signal;
      timer = global.setTimeout(function () {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      if (typeof global.fetch !== 'function') {
        throw new ApiError('fetch() is not available in this browser.', 'NO_FETCH');
      }

      var response = await global.fetch(joinUrl(pathname), fetchOptions);
      var text = await response.text();
      var payload = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (parseError) {
          if (response.ok) {
            throw new ApiError(
              'Server returned invalid JSON.',
              'BAD_RESPONSE',
              response.status
            );
          }
        }
      }

      if (!response.ok) {
        var apiError = payload && payload.error;
        throw new ApiError(
          (apiError && apiError.message) || 'HTTP ' + response.status,
          (apiError && apiError.code) || 'HTTP_' + response.status,
          response.status,
          payload
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) {
        throw new ApiError(
          'Request timed out after ' + timeoutMs + ' ms.',
          'TIMEOUT'
        );
      }
      if (error && error.name === 'AbortError') {
        throw new ApiError('Request was aborted.', 'ABORTED');
      }
      throw new ApiError(
        (error && error.message) || 'Network request failed.',
        'NETWORK',
        0,
        null
      );
    } finally {
      if (timer !== null) global.clearTimeout(timer);
    }
  }

  function pickId(id) {
    return id || getProfileId();
  }

  function health() {
    return request('/api/health');
  }

  function config() {
    return request('/api/config');
  }

  function i18n(lang) {
    return request(
      lang ? '/api/i18n/' + encodeURIComponent(lang) : '/api/i18n'
    );
  }

  function profile(id) {
    return request('/api/profile/' + encodeURIComponent(pickId(id)));
  }

  function getSave(id, slot) {
    if (slot === undefined || slot === null || slot === '') slot = 'auto';
    return request(
      '/api/save/' +
        encodeURIComponent(pickId(id)) +
        '?slot=' +
        encodeURIComponent(slot)
    );
  }

  function putSave(id, slot, data, meta) {
    var body = { data: data };
    if (meta !== undefined) body.meta = meta;
    return request(
      '/api/save/' +
        encodeURIComponent(pickId(id)) +
        '/' +
        encodeURIComponent(slot),
      { method: 'PUT', body: body }
    );
  }

  function deleteSave(id, slot) {
    return request(
      '/api/save/' +
        encodeURIComponent(pickId(id)) +
        '/' +
        encodeURIComponent(slot),
      { method: 'DELETE' }
    );
  }

  function records(board) {
    return request(
      '/api/records?board=' + encodeURIComponent(board || 'all')
    );
  }

  function submitRecord(board, name, value, meta) {
    var body = { board: board, name: name, value: value };
    if (meta !== undefined) body.meta = meta;
    return request('/api/records', { method: 'POST', body: body });
  }

  function stats() {
    return request('/api/stats');
  }

  async function cloudSave(slot, data, meta) {
    try {
      var result = await putSave(getProfileId(), slot || 'auto', data, meta);
      return Boolean(result && result.ok);
    } catch (_) {
      return false;
    }
  }

  async function cloudLoad(slot) {
    try {
      var result = await getSave(getProfileId(), slot || 'auto');
      return result && result.ok ? result.data : null;
    } catch (_) {
      return null;
    }
  }

  function isOnline() {
    return Boolean(api.online);
  }

  var api = {
    version: VERSION,
    base: BASE,
    online: false,
    ApiError: ApiError,
    health: health,
    config: config,
    i18n: i18n,
    profile: profile,
    getSave: getSave,
    putSave: putSave,
    deleteSave: deleteSave,
    records: records,
    submitRecord: submitRecord,
    stats: stats,
    getProfileId: getProfileId,
    getNickname: getNickname,
    setNickname: setNickname,
    cloudSave: cloudSave,
    cloudLoad: cloudLoad,
    isOnline: isOnline,
  };

  global.BOTW_API = api;

  // Online detection: once after window load, then every 60 seconds. No probe
  // is allowed to produce an unhandled rejection.
  var probeInFlight = false;
  var probeInterval = null;

  function emitNetEvent() {
    if (
      typeof global.dispatchEvent !== 'function' ||
      typeof global.CustomEvent !== 'function'
    ) {
      return;
    }
    try {
      global.dispatchEvent(
        new global.CustomEvent('botw:net', {
          detail: { online: Boolean(api.online), base: BASE },
        })
      );
    } catch (_) {
      /* an event listener must never break the client */
    }
  }

  async function probeOnline() {
    if (probeInFlight) return;
    probeInFlight = true;
    try {
      var result = await health();
      api.online = Boolean(result && result.ok);
    } catch (_) {
      api.online = false;
    } finally {
      probeInFlight = false;
      emitNetEvent();
    }
  }

  function beginOnlineProbes() {
    probeOnline();
    if (probeInterval === null && typeof global.setInterval === 'function') {
      probeInterval = global.setInterval(function () {
        probeOnline();
      }, 60000);
    }
  }

  if (global.document && global.document.readyState === 'complete') {
    if (typeof global.setTimeout === 'function') {
      global.setTimeout(beginOnlineProbes, 0);
    }
  } else if (typeof global.addEventListener === 'function') {
    global.addEventListener('load', beginOnlineProbes, { once: true });
  } else if (typeof global.setTimeout === 'function') {
    global.setTimeout(beginOnlineProbes, 0);
  }
})(typeof window !== 'undefined' ? window : this);
