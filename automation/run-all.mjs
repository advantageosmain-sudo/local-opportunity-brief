import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCustomer } from "./lib/run-customer.mjs";
import { customerEligibility } from "./lib/customer-policy.mjs";
import { readHostedCustomers } from "./lib/hosted-client.mjs";
import { chicagoDate } from "./lib/schedule.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
function arg(name, fallback = "") { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const asOf = arg("--as-of", chicagoDate());
const selectedCustomer = arg("--customer", "all");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Invalid report date.");
if (selectedCustomer !== "all" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selectedCustomer)) throw new Error("Invalid customer slug.");
const hosted = process.argv.includes("--hosted");
const includePilot = process.argv.includes("--include-pilot");
const includeDemo = process.argv.includes("--include-demo");
const profiles = [];
let hostedSources = [];
if (hosted) {
  const payload = await readHostedCustomers();
  profiles.push(...payload.customers);
  hostedSources = payload.sourcePacks ?? [];
} else {
  for (const filename of (await readdir(path.join(root, "customers"))).sort()) {
    if (filename.endsWith(".json")) profiles.push(JSON.parse(await readFile(path.join(root, "customers", filename), "utf8")));
  }
}
const results = [];
const skipped = [];
for (const profile of profiles) {
  if (selectedCustomer !== "all" && profile.slug !== selectedCustomer) continue;
  const eligibility = customerEligibility(profile);
  const rehearsal = !hosted && ((includePilot && profile.status === "pilot") || (includeDemo && profile.status === "demo"));
  if (!eligibility.eligible && !rehearsal) { skipped.push({ customerSlug: profile.slug, reasons: eligibility.reasons }); continue; }
  const sourcePacks = hosted ? (profile.sourcePacks ?? hostedSources.filter((pack) => pack.marketId === profile.marketId)) : undefined;
  results.push(await runCustomer({ customerSlug: profile.slug, asOf, customer: profile, sourcePacks }));
}
const blocked = results.filter((result) => result.status === "BLOCKED");
const summary = {
  status: blocked.length ? "BLOCKED" : results.length ? "READY_FOR_OWNER_REVIEW" : "NO_ELIGIBLE_CUSTOMERS",
  asOf, hosted, customerCount: results.length, readyCount: results.length - blocked.length, blockedCount: blocked.length,
  skippedCount: skipped.length, skipped, liveDelivery: false,
  dashboardPackets: results.filter((result) => result.dashboardPacket).map((result) => path.relative(process.cwd(), result.dashboardPacket)), results,
};
await mkdir(path.join(root, "outbox"), { recursive: true });
const summaryPath = path.join(root, "outbox", `run-summary-${asOf}.json`);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
if (blocked.length) process.exitCode = 1;
