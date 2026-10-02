// Starts/stops the isolated dev Postgres cluster in .pgdata on port 5433.
// Port 5432 belongs to the system PostgreSQL service; binding it fails on Windows with "Permission denied".
// Usage: node scripts/db.mjs start|stop|status   (override the binaries folder with PG_BIN)
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const bin = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const pgCtl = join(bin, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
const data = ".pgdata";

const args = {
  start: ["start", "-D", data, "-o", "-p 5433", "-l", join(data, "server.log"), "-w", "-t", "60"],
  stop: ["stop", "-D", data, "-m", "fast"],
  status: ["status", "-D", data],
}[process.argv[2]];

if (!args) {
  console.error("Usage: node scripts/db.mjs start|stop|status");
  process.exit(1);
}

const r = spawnSync(pgCtl, args, { stdio: "inherit" });
if (r.error) {
  console.error(`Could not run ${pgCtl}: ${r.error.message}. Set PG_BIN to your PostgreSQL bin folder.`);
  process.exit(1);
}
process.exit(r.status ?? 1);
