import { runMigrations } from "./migrations.js";
import { pool } from "./pool.js";

runMigrations(pool, console.log)
  .then(() => console.log("migrations up to date"))
  .catch((err) => {
    console.error("migration failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
