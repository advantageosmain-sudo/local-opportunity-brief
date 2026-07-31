import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateReport } from "./lib/engine.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const reportPath = path.resolve(arg("--report"));
const actor = arg("--actor");
const phrase = arg("--phrase");

if (!reportPath || !actor) {
  console.error(
    "Usage: node automation/approve.mjs --report <report.json> --actor <owner> --phrase APPROVE",
  );
  process.exit(2);
}
if (phrase !== "APPROVE") {
  console.error("The exact owner approval phrase is required.");
  process.exit(1);
}

const reportDir = path.dirname(reportPath);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const validation = JSON.parse(
  await readFile(path.join(reportDir, "validation.json"), "utf8"),
);
const approvalPath = path.join(reportDir, "approval.json");
const approval = JSON.parse(await readFile(approvalPath, "utf8"));

const exactHeadValidation = validateReport(report);
if (!validation.passed || !exactHeadValidation.passed) {
  console.error("A failed report cannot be approved.");
  process.exit(1);
}
if (approval.checksum !== report.checksum) {
  console.error("The report changed after the approval packet was created.");
  process.exit(1);
}

const approved = {
  ...approval,
  decision: "APPROVED",
  decidedBy: actor,
  decidedAt: new Date().toISOString(),
  notes: "Approved through the protected GitHub delivery workflow.",
};
await writeFile(approvalPath, `${JSON.stringify(approved, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status: "APPROVED",
      reportId: report.reportId,
      checksum: report.checksum,
      decidedBy: actor,
    },
    null,
    2,
  ),
);
