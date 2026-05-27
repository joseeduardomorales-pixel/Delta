#!/usr/bin/env node
// Delta migration runner.
// Reads supabase/migrations/*.sql in sorted order, tracks applied
// migrations in public._migrations, runs each unapplied file in a
// transaction. Idempotent: re-running is a no-op if nothing changed.
//
// Usage:
//   node db/migrate.mjs               -- apply all pending
//   node db/migrate.mjs --status      -- show what's applied/pending
//   node db/migrate.mjs --reset       -- DROP _migrations entries (data left)
//
// Requires PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE from api/.env.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'node_modules', 'pg'));

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

function loadEnv() {
  // Minimal dotenv-compatible loader. Supports KEY=value and KEY="value"
  // (quoted values may contain # and other special chars).
  const path = join(__dirname, '..', 'api', '.env');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) {
      val = val.slice(1, -1);
    } else {
      // Strip inline comment ONLY for unquoted values.
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash);
      val = val.trim();
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const { Client } = pg;

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60_000,
});

const args = new Set(process.argv.slice(2));
const STATUS = args.has('--status');
const RESET = args.has('--reset');

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      return { name: f, sql, hash: sha256(sql) };
    });
}

async function ensureMigrationsTable() {
  // Tracking table lives in a dedicated schema so it doesn't pollute
  // public (which has a RLS-coverage sanity check in 0001).
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS delta_meta;
    CREATE TABLE IF NOT EXISTS delta_meta.migrations (
      name        text PRIMARY KEY,
      hash        text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet() {
  const r = await client.query('SELECT name, hash FROM delta_meta.migrations');
  return new Map(r.rows.map((row) => [row.name, row.hash]));
}

async function main() {
  await client.connect();
  await ensureMigrationsTable();

  if (RESET) {
    await client.query('DELETE FROM delta_meta.migrations');
    console.log('Cleared delta_meta.migrations log (data untouched).');
    await client.end();
    return;
  }

  const applied = await appliedSet();
  const migrations = listMigrations();

  if (STATUS) {
    console.log('migration                            status     hash');
    console.log('-----------------------------------  ---------  --------');
    for (const m of migrations) {
      const prev = applied.get(m.name);
      const status = !prev ? 'pending  ' : prev === m.hash ? 'applied  ' : 'CHANGED!!';
      console.log(m.name.padEnd(37), status, m.hash.slice(0, 8));
    }
    await client.end();
    return;
  }

  let appliedCount = 0;
  for (const m of migrations) {
    const prev = applied.get(m.name);
    if (prev && prev === m.hash) continue;
    if (prev && prev !== m.hash) {
      throw new Error(
        `Refusing to re-run ${m.name}: file changed since previous apply ` +
          `(was ${prev.slice(0, 8)}, now ${m.hash.slice(0, 8)}). ` +
          `Add a follow-up migration instead.`,
      );
    }

    process.stdout.write(`→ ${m.name} ...`);
    const t0 = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query(
        'INSERT INTO delta_meta.migrations (name, hash) VALUES ($1, $2)',
        [m.name, m.hash],
      );
      await client.query('COMMIT');
      const ms = Date.now() - t0;
      console.log(` ok (${ms} ms)`);
      appliedCount++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.log(' FAIL');
      console.error(`  ${e.message}`);
      throw e;
    }
  }
  console.log(
    appliedCount === 0
      ? 'Nothing to apply — schema up to date.'
      : `Applied ${appliedCount} migration(s).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
