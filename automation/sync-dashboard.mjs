import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const packetArg = arg("--packet");
const summaryArg = arg("--summary");
if (Boolean(packetArg) === Boolean(summaryArg)) {
  console.error("Provide exactly one of --packet or --summary.");
  process.exit(2);
}

const endpoint = process.env.REPORT_SYNC_URL;
const secret = process.env.REPORT_SYNC_SECRET;
if (!endpoint || !secret) {
  console.error("REPORT_SYNC_URL and REPORT_SYNC_SECRET are required.");
  process.exit(2);
}
if (new URL(endpoint).protocol !== "https:") {
  console.error("REPORT_SYNC_URL must use HTTPS.");
  process.exit(2);
}

let packetPaths = packetArg ? [packetArg] : [];
if (summaryArg) {
  const summary = JSON.parse(await readFile(path.resolve(summaryArg), "utf8"));
  packetPaths = summary.dashboardPackets ?? [];
}

const results = [];
for (const packetPath of packetPaths) {
  const resolved = path.resolve(packetPath);
  const packet = JSON.parse(await readFile(resolved, "utf8"));
  try {
    packet.deliveryReceipt = JSON.parse(
      await readFile(path.join(path.dirname(resolved), "delivery-receipt.json"), "utf8"),
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(packet),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Dashboard sync failed with status ${response.status}.`);
  }
  results.push(body);
}

console.log(JSON.stringify({ status: "SYNCED", count: results.length, results }, null, 2));
