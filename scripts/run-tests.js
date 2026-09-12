/**
 * Test runner wrapper.
 *
 * `npm test` used to run `node --test` directly, which made every test file
 * sync({ force: true }) against the DEFAULT sqlite file — i.e. `npm test`
 * dropped the local dev/demo database on every run. utils/database.js already
 * supports DB_STORAGE for exactly this; nothing was setting it.
 *
 * This wrapper points DB_STORAGE at a throwaway temp file (unique per run so
 * parallel invocations can't collide) and forwards everything else — args
 * after `--` are passed through to node --test (e.g.
 * `npm test -- --test-name-pattern=demo`).
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const dbFile = path.join(os.tmpdir(), `salon-app-tests-${process.pid}.sqlite`);

const passthrough = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', 'tests/**/*.test.js', ...passthrough],
  {
    stdio: 'inherit',
    env: { ...process.env, DB_STORAGE: dbFile },
  }
);

// Best-effort cleanup of the throwaway database.
for (const f of [dbFile, `${dbFile}-journal`]) {
  try { fs.rmSync(f, { force: true }); } catch { /* temp dir cleanup covers it */ }
}

process.exit(result.status ?? 1);
