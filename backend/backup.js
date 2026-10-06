import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { LOCATION_KEYS, DEFAULT_LOCATION } from './locations.js';
import { config } from './config.js';

/**
 * Nightly SQLite snapshots.
 *
 * The whole financial record — sheets, machine readings, expenses, payout status, the audit
 * trail — lives in one SQLite file. Azure's /home is durable storage, but durable is not the
 * same as backed up: an accidental delete in the UI, a bad edit, or a bug that wipes rows
 * propagates instantly with no recovery point. These snapshots are that recovery point.
 *
 * VACUUM INTO (rather than a file copy) is used deliberately — it takes a read lock and writes
 * a consistent, already-compacted database, so a snapshot taken mid-write is still valid. A
 * plain fs.copyFile of a WAL-mode database can capture a torn state.
 */

const BACKUP_DIR_NAME = 'backups';
const RETAIN = 14;                          // keep two weeks of daily snapshots
const INTERVAL_MS = 24 * 60 * 60 * 1000;    // once a day
const MIN_AGE_MS = 20 * 60 * 60 * 1000;     // skip a boot-time backup if one is already this fresh

/**
 * One folder per location. The original install kept its snapshots flat in backups/; those
 * belong to the default location, so they are moved under it once rather than left behind
 * where nothing would ever list them again.
 */
export const backupDir = (location) => path.join(config.dataDir, BACKUP_DIR_NAME, location);

let migrated = false;
function migrateLegacyFlatBackups() {
  if (migrated) return;
  migrated = true;
  const flat = path.join(config.dataDir, BACKUP_DIR_NAME);
  if (!fs.existsSync(flat)) return;
  const stale = fs.readdirSync(flat).filter((f) => FILE_RE.test(f));
  if (!stale.length) return;
  const dest = backupDir(DEFAULT_LOCATION);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of stale) fs.renameSync(path.join(flat, f), path.join(dest, f));
}

/** Snapshot filenames are timestamped, so lexical order is chronological order. */
const stampFor = (date) => date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const FILE_RE = /^gameroom-(.+)\.db$/;

/**
 * Recovers the snapshot time from its filename ("2026-02-02T03-00-00") rather than the file's
 * mtime — the name is what the snapshot claims to be, and it survives a file being copied or
 * restored from elsewhere, which would reset mtime.
 */
function stampToISO(stamp) {
  const [datePart, timePart] = stamp.split('T');
  if (!timePart) return null;
  const parsed = Date.parse(`${datePart}T${timePart.replace(/-/g, ':')}Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Existing snapshots, newest first. */
export function listBackups(location) {
  migrateLegacyFlatBackups();
  const dir = backupDir(location);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => ({ name, match: FILE_RE.exec(name) }))
    .filter(({ match }) => match && stampToISO(match[1]))
    .map(({ name, match }) => ({
      name,
      size: fs.statSync(path.join(dir, name)).size,
      created_at: stampToISO(match[1]),
    }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function prune(location) {
  for (const stale of listBackups(location).slice(RETAIN)) {
    fs.rmSync(path.join(backupDir(location), stale.name), { force: true });
  }
}

/**
 * Writes one snapshot and prunes old ones. Returns the snapshot's filename.
 * Pass force=true to snapshot regardless of how recent the last one is.
 */
export function runBackup(location, { force = false, now = new Date() } = {}) {
  migrateLegacyFlatBackups();
  const dir = backupDir(location);
  fs.mkdirSync(dir, { recursive: true });

  if (!force) {
    const [latest] = listBackups(location);
    if (latest && now.getTime() - Date.parse(latest.created_at) < MIN_AGE_MS) return null;
  }

  const name = `gameroom-${stampFor(now)}.db`;
  const dest = path.join(dir, name);
  // VACUUM INTO refuses to write to a path that already exists, and the stamp only has
  // second granularity — so two forced backups inside the same second would otherwise throw.
  // Replacing is harmless: it's a snapshot of the same database at the same second.
  fs.rmSync(dest, { force: true });
  // Single-quoted SQL string literal; the stamp is generated from a Date, never user input.
  getDb(location).exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  prune(location);
  return name;
}

/** Snapshot on boot (unless one is already fresh), then daily. */
export function startBackupSchedule() {
  const attempt = () => {
    try {
      // Each location is attempted on its own, so one failing doesn't skip the others.
      for (const location of LOCATION_KEYS) {
        try {
          const name = runBackup(location);
          if (name) console.log(`[backup] ${location}: wrote ${name}`);
        } catch (err) {
          console.error(`[backup] ${location} failed:`, err.message);
        }
      }
    } catch (err) {
      // A failed backup must never take the app down with it.
      console.error('[backup] failed:', err.message);
    }
  };
  attempt();
  const timer = setInterval(attempt, INTERVAL_MS);
  timer.unref?.();
  return timer;
}
