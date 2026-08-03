import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCustomer } from "./lib/run-customer.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const asOf = arg("--as-of", new Date().toISOString().slice(0, 10));
const includePilot = process.argv.includes("--include-pilot");
const includeDemo = process.argv.includes("--include-demo");
const allowedStatuses = new Set([
  "active",
  ...(includePilot ? ["pilot"] : []),
  ...(includeDemo ? ["demo"] : []),
]);

const profiles = [];
for (const filename of (await readdir(path.join(root, "customers"))).sort()) {
  if (!filename.endsWith(".json")) continue;
  const profile = JSON.parse(
    await readFile(path.join(root, "customers", filename), "utf8"),
  );
  if (allowedStatuses.has(profile.status)) profiles.push(profile);
}

const results = [];
for (const profile of profiles) {
  results.push(await runCustomer({ customerSlug: profile.slug, asOf }));
}

const blocked = results.filter((result) => result.status === "BLOCKED");
const summary = {
  status:
    blocked.length > 0
      ? "BLOCKED"
      : results.length === 0
        ? "NO_ACTIVE_CUSTOMERS"
        : "READY_FOR_OWNER_REVIEW",
  asOf,
  customerCount: results.length,
  readyCount: results.length - blocked.length,
  blockedCount: blocked.length,
  liveDelivery: false,
  dashboardPackets: results
    .filter((result) => result.dashboardPacket)
    .map((result) => path.relative(process.cwd(), result.dashboardPacket)),
  results,
};
await mkdir(path.join(root, "outbox"), { recursive: true });
const summaryPath = path.join(root, "outbox", `run-summary-${asOf}.json`);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
if (blocked.length > 0) process.exitCode = 1;
