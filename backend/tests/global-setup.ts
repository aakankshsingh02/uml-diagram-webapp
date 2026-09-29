import pg from "pg";

const url = new URL(
  process.env.TEST_DATABASE_URL ?? "postgres://uml:uml_password@localhost:5432/uml_diagrams_test",
);

/** Creates the test database (if missing) and applies all migrations to it. */
export default async function setup() {
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!dbName.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must point at a database ending in _test (got "${dbName}"); tests truncate it`);
  }
  const admin = new pg.Client({ connectionString: new URL("/postgres", url).toString() });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await admin.end();

  process.env.DATABASE_URL = url.toString();
  const { runMigrations } = await import("../src/db/migrations.js");
  const pool = new pg.Pool({ connectionString: url.toString() });
  await runMigrations(pool);
  await pool.end();
}
