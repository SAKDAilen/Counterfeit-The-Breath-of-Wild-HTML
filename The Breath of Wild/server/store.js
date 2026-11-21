'use strict';

/**
 * JSON persistence for Hyrule cloud saves, profiles and record boards.
 *
 * All files are intentionally small, so synchronous I/O keeps the code simple
 * and avoids interleaved writes. Files are loaded lazily on first use and kept
 * in memory; malformed JSON is quarantined instead of crashing the server.
 */

const fs = require('fs');
const path = require('path');

const MAX_SAVE_BYTES = 1024 * 1024; // 1 MiB of serialized save data
const MAX_RECORDS_PER_BOARD = 100;
const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const SLOT_RE = /^[a-z0-9_-]{1,16}$/;
const BOARDS = Object.freeze(['korok', 'shrines', 'ganon']);
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

let writeSequence = 0;

class StoreError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.status = status || 400;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value, fallback) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

function cleanRecordName(value) {
  return typeof value === 'string'
    ? value.trim().replace(CONTROL_CHARS_RE, '').trim()
    : '';
}

function normalizeRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const name = cleanRecordName(raw.name);
  if (!name || Array.from(name).length > 24) return null;
  if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0) {
    return null;
  }
  return {
    name,
    value: raw.value,
    updatedAt: validTimestamp(raw.updatedAt, nowIso()),
    meta: raw.meta === undefined ? null : raw.meta,
  };
}

/** Highest value first; ties go to the record that was submitted first. */
function compareRecords(a, b) {
  if (b.value !== a.value) return b.value - a.value;
  if (a.updatedAt < b.updatedAt) return -1;
  if (a.updatedAt > b.updatedAt) return 1;
  return 0;
}

/**
 * Write JSON through a sibling temp file and rename. Rename is atomic on the
 * same volume, so readers never observe a half-written persistence file.
 */
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  while (fs.existsSync(tmp)) {
    tmp = `${file}.tmp-${process.pid}-${Date.now()}-${++writeSequence}`;
  }
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* best-effort cleanup */
    }
    throw err;
  }
}

class Store {
  constructor(options) {
    options = options || {};
    const dataDir =
      options.dataDir ||
      process.env.DATA_DIR ||
      path.join(__dirname, '..', 'data');

    this.dataDir = path.resolve(dataDir);
    this.profilesFile = path.join(this.dataDir, 'profiles.json');
    this.recordsFile = path.join(this.dataDir, 'records.json');
    this.savesDir = path.join(this.dataDir, 'saves');

    /** @type {Map<string, object>|null} */
    this._profiles = null;
    /** @type {object|null} */
    this._records = null;
    /** @type {Map<string, Map<string, object>>} */
    this._saves = new Map();
    this._savesLoaded = new Set();
  }

  // ---------------------------------------------------------------------------
  // Low-level persistence helpers
  // ---------------------------------------------------------------------------

  /** Move a corrupt/unreadable data file out of the way. Never throws. */
  _quarantine(file, reason) {
    let backup = `${file}.corrupt-${Date.now()}`;
    let suffix = 0;
    while (fs.existsSync(backup)) {
      backup = `${file}.corrupt-${Date.now()}-${++suffix}`;
    }
    try {
      fs.renameSync(file, backup);
      console.warn(
        `[botw] Corrupt data file backed up: ${file} -> ${backup} (${reason.message})`
      );
    } catch (err) {
      console.error(
        `[botw] Could not back up corrupt data file ${file}: ${err.message}`
      );
    }
  }

  /**
   * Read and parse one JSON file.
   * @returns {{present:boolean, value?:any}}
   */
  _readJson(file) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this._quarantine(file, err);
      return { present: false };
    }

    try {
      return { present: true, value: JSON.parse(text) };
    } catch (err) {
      this._quarantine(file, err);
      return { present: false };
    }
  }

  _writeProfiles() {
    const output = Object.create(null);
    for (const [id, profile] of this._profiles) output[id] = profile;
    atomicWriteJson(this.profilesFile, output);
  }

  _ensureProfiles() {
    if (this._profiles) return this._profiles;

    const profiles = new Map();
    const loaded = this._readJson(this.profilesFile);
    if (loaded.present) {
      if (!isPlainObject(loaded.value)) {
        this._quarantine(this.profilesFile, new Error('root value is not an object'));
      } else {
        const fallback = nowIso();
        for (const [id, raw] of Object.entries(loaded.value)) {
          if (!PROFILE_ID_RE.test(id) || !isPlainObject(raw)) continue;
          const createdAt = validTimestamp(raw.createdAt, fallback);
          profiles.set(id, {
            id,
            nickname:
              typeof raw.nickname === 'string' && raw.nickname.trim()
                ? raw.nickname
                : 'Link',
            createdAt,
            updatedAt: validTimestamp(raw.updatedAt, createdAt),
          });
        }
      }
    }

    this._profiles = profiles;
    return profiles;
  }

  _ensureRecords() {
    if (this._records) return this._records;

    const records = { korok: [], shrines: [], ganon: [] };
    const loaded = this._readJson(this.recordsFile);
    if (loaded.present) {
      if (!isPlainObject(loaded.value)) {
        this._quarantine(this.recordsFile, new Error('root value is not an object'));
      } else {
        for (const board of BOARDS) {
          const list = Array.isArray(loaded.value[board]) ? loaded.value[board] : [];
          records[board] = list
            .map(normalizeRecord)
            .filter(Boolean)
            .sort(compareRecords)
            .slice(0, MAX_RECORDS_PER_BOARD);
        }
      }
    }

    this._records = records;
    return records;
  }

  _assertProfileId(id) {
    if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) {
      throw new StoreError(
        'INVALID_PROFILE_ID',
        'Profile id must match ^[A-Za-z0-9_-]{1,40}$.'
      );
    }
  }

  _assertSlot(slot) {
    if (typeof slot !== 'string' || !SLOT_RE.test(slot)) {
      throw new StoreError(
        'INVALID_SLOT',
        'Slot must match ^[a-z0-9_-]{1,16}$.'
      );
    }
  }

  _savePath(id, slot) {
    this._assertProfileId(id);
    this._assertSlot(slot);
    return path.join(this.savesDir, id, `${slot}.json`);
  }

  _loadSaves(id) {
    this._assertProfileId(id);
    if (this._savesLoaded.has(id)) return this._saves.get(id);

    // Mark as loaded before touching the disk so a read error cannot trigger
    // an endless sequence of repeated readdir attempts.
    this._savesLoaded.add(id);
    const cache = new Map();
    this._saves.set(id, cache);

    let entries = [];
    const dir = path.join(this.savesDir, id);
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[botw] Could not read saves for ${id}: ${err.message}`);
      }
      return cache;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const slot = entry.name.slice(0, -'.json'.length);
      if (!SLOT_RE.test(slot)) continue;

      const file = path.join(dir, entry.name);
      const loaded = this._readJson(file);
      if (!loaded.present) continue;

      const record = this._normalizeSave(loaded.value, file);
      if (!record) {
        this._quarantine(file, new Error('invalid save record'));
        continue;
      }
      cache.set(slot, record);
    }

    return cache;
  }

  _normalizeSave(raw, file) {
    if (!isPlainObject(raw) || !isPlainObject(raw.data)) return null;

    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(raw.data), 'utf8');
    } catch (_) {
      return null;
    }

    let mtime = nowIso();
    try {
      mtime = fs.statSync(file).mtime.toISOString();
    } catch (_) {
      /* use current time */
    }

    return {
      data: raw.data,
      meta: isPlainObject(raw.meta) ? raw.meta : null,
      updatedAt: validTimestamp(raw.updatedAt, mtime),
      size,
    };
  }

  /** Update an already-existing profile's timestamp after a save write. */
  _touchProfile(id, timestamp) {
    try {
      const profiles = this._ensureProfiles();
      const profile = profiles.get(id);
      if (!profile) return;
      profile.updatedAt = timestamp;
      this._writeProfiles();
    } catch (err) {
      // The save itself is the source of truth; a failed profile timestamp
      // refresh should not turn a successful save into an HTTP 500.
      console.error(`[botw] Could not update profile timestamp: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------

  /** Read a profile, auto-creating it on first access. */
  getOrCreateProfile(id) {
    this._assertProfileId(id);
    const profiles = this._ensureProfiles();
    let profile = profiles.get(id);

    if (!profile) {
      const timestamp = nowIso();
      profile = {
        id,
        nickname: 'Link',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      profiles.set(id, profile);
      try {
        this._writeProfiles();
      } catch (err) {
        profiles.delete(id);
        throw err;
      }
    }

    return { ...profile };
  }

  // ---------------------------------------------------------------------------
  // Saves
  // ---------------------------------------------------------------------------

  /** Return a save record or null. */
  getSave(id, slot) {
    this._assertProfileId(id);
    this._assertSlot(slot);
    const cache = this._loadSaves(id);
    const record = cache.get(slot);
    if (!record) return null;

    return {
      data: record.data,
      meta: record.meta,
      updatedAt: record.updatedAt,
      size: record.size,
    };
  }

  /** Persist save data and metadata. */
  putSave(id, slot, data, meta) {
    this._assertProfileId(id);
    this._assertSlot(slot);

    if (!isPlainObject(data)) {
      throw new StoreError('SAVE_INVALID', 'Save data must be a JSON object.');
    }
    if (meta !== undefined && meta !== null && !isPlainObject(meta)) {
      throw new StoreError('SAVE_INVALID', 'Save meta must be a JSON object.');
    }

    let serialized;
    let size;
    try {
      serialized = JSON.stringify(data);
      size = Buffer.byteLength(serialized, 'utf8');
    } catch (_) {
      throw new StoreError('SAVE_INVALID', 'Save data must be JSON-serializable.');
    }

    if (size > MAX_SAVE_BYTES) {
      throw new StoreError(
        'SAVE_TOO_LARGE',
        `Serialized save data exceeds ${MAX_SAVE_BYTES} bytes.`,
        413
      );
    }

    const record = {
      data,
      meta: meta === undefined || meta === null ? null : meta,
      updatedAt: nowIso(),
      size,
    };

    atomicWriteJson(this._savePath(id, slot), record);
    this._loadSaves(id).set(slot, record);
    this._touchProfile(id, record.updatedAt);

    return { slot, updatedAt: record.updatedAt, size };
  }

  /** Delete a slot. Returns true when a file was actually removed. */
  deleteSave(id, slot) {
    this._assertProfileId(id);
    this._assertSlot(slot);

    const cache = this._loadSaves(id);
    let deleted = cache.has(slot);
    try {
      fs.unlinkSync(this._savePath(id, slot));
      deleted = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    cache.delete(slot);
    return deleted;
  }

  /** List slots for a profile, sorted by slot name. */
  listSlots(id) {
    this._assertProfileId(id);
    const cache = this._loadSaves(id);
    const slots = [];
    for (const [slot, record] of cache) {
      const summary =
        record.meta && typeof record.meta.summary === 'string'
          ? record.meta.summary
          : null;
      slots.push({
        slot,
        size: record.size,
        updatedAt: record.updatedAt,
        summary,
      });
    }
    slots.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
    return slots;
  }

  // ---------------------------------------------------------------------------
  // Records / leaderboards
  // ---------------------------------------------------------------------------

  /** Return all three record boards, sorted desc and capped at 100 entries. */
  getRecords() {
    const records = this._ensureRecords();
    const copy = {};
    for (const board of BOARDS) {
      copy[board] = records[board].map((record) => ({ ...record }));
    }
    return copy;
  }

  addRecord(board, name, value, meta) {
    if (!BOARDS.includes(board)) {
      throw new StoreError('INVALID_BOARD', 'Unknown leaderboard.');
    }

    const cleanName = cleanRecordName(name);
    if (!cleanName || Array.from(cleanName).length > 24) {
      throw new StoreError('INVALID_NAME', 'Name must be 1-24 characters.');
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new StoreError('INVALID_VALUE', 'Value must be a finite number >= 0.');
    }

    const records = this._ensureRecords();
    const previous = records[board];
    const entry = {
      name: cleanName,
      value,
      updatedAt: nowIso(),
      meta: meta === undefined ? null : meta,
    };

    const next = previous
      .concat(entry)
      .sort(compareRecords)
      .slice(0, MAX_RECORDS_PER_BOARD);

    records[board] = next;
    try {
      atomicWriteJson(this.recordsFile, {
        korok: records.korok,
        shrines: records.shrines,
        ganon: records.ganon,
      });
    } catch (err) {
      records[board] = previous;
      throw err;
    }

    const index = next.indexOf(entry);
    return { rank: index === -1 ? 0 : index + 1, board, entry: { ...entry } };
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  countSaves() {
    let count = 0;
    let profileDirs = [];
    try {
      profileDirs = fs.readdirSync(this.savesDir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[botw] Could not count saves: ${err.message}`);
      }
      return 0;
    }

    for (const profileDir of profileDirs) {
      if (!profileDir.isDirectory() || !PROFILE_ID_RE.test(profileDir.name)) continue;
      let files = [];
      try {
        files = fs.readdirSync(path.join(this.savesDir, profileDir.name), {
          withFileTypes: true,
        });
      } catch (_) {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        if (SLOT_RE.test(file.name.slice(0, -'.json'.length))) count++;
      }
    }
    return count;
  }

  getStats() {
    const profiles = this._ensureProfiles();
    const records = this._ensureRecords();
    return {
      profiles: profiles.size,
      saves: this.countSaves(),
      records: {
        korok: records.korok.length,
        shrines: records.shrines.length,
        ganon: records.ganon.length,
      },
    };
  }
}

module.exports = {
  Store,
  StoreError,
  MAX_SAVE_BYTES,
  MAX_RECORDS_PER_BOARD,
  PROFILE_ID_RE,
  SLOT_RE,
  BOARDS,
};
