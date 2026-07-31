import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  generateReport,
  renderMarkdown,
  validateReport,
} from "./lib/engine.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const customerSlug = arg("--customer", "demo-boutique");
const asOf = arg("--as-of", today());
const customerPath = path.join(root, "customers", `${customerSlug}.json`);
const customer = JSON.parse(await readFile(customerPath, "utf8"));

const allOpportunities = [];
let fixture = false;
for (const sourceFile of customer.approvedSourceFiles) {
  const source = JSON.parse(
    await readFile(path.join(root, "sources", sourceFile), "utf8"),
  );
  fixture ||= Boolean(source.fixture);
  allOpportunities.push(...source.opportunities);
}

const report = generateReport(customer, allOpportunities, { asOf, fixture });
const validation = validateReport(report);
const outputDir = path.join(root, "outbox", customer.slug, asOf);
await mkdir(outputDir, { recursive: true });

const approval = {
  reportId: report.reportId,
  checksum: report.checksum,
  decision: "PENDING",
  decidedBy: null,
  decidedAt: null,
  notes: "",
};

await Promise.all([
  writeFile(
    path.join(outputDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  writeFile(
    path.join(outputDir, "report.md"),
    renderMarkdown(report, validation),
  ),
  writeFile(
    path.join(outputDir, "validation.json"),
    `${JSON.stringify(validation, null, 2)}\n`,
  ),
  writeFile(
    path.join(outputDir, "approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
  ),
]);

console.log(
  JSON.stringify(
    {
      status: validation.passed ? "READY_FOR_OWNER_REVIEW" : "BLOCKED",
      reportId: report.reportId,
      outputDir,
      opportunities: report.opportunities.length,
      validation,
      liveDelivery: false,
    },
    null,
    2,
  ),
);

if (!validation.passed) process.exitCode = 1;
