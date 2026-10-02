import { readFile } from "node:fs/promises";
import path from "node:path";
import { requestHostedDelivery } from "./lib/hosted-client.mjs";
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
const reportPath = arg("--report");
const summaryPath = arg("--summary");
if (Boolean(reportPath) === Boolean(summaryPath)) throw new Error("Provide exactly one of --report or --summary.");
const packets = reportPath ? [reportPath] : JSON.parse(await readFile(summaryPath, "utf8")).dashboardPackets.map((file) => path.join(path.dirname(file), "report.json"));
const results = [];
for (const filename of packets) {
  const report = JSON.parse(await readFile(filename, "utf8"));
  try { results.push({ reportId: report.reportId, ...await requestHostedDelivery({ report }) }); }
  catch (error) { results.push({ reportId: report.reportId, status: "BLOCKED", reason: error.message }); process.exitCode = 1; }
}
console.log(JSON.stringify({ results }, null, 2));
