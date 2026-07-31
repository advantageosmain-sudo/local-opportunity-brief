import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateReport } from "./lib/engine.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const reportPath = arg("--report");
if (!reportPath) {
  console.error("Usage: node automation/deliver.mjs --report <report.json>");
  process.exit(2);
}

const resolvedReportPath = path.resolve(reportPath);
const reportDir = path.dirname(resolvedReportPath);
const report = JSON.parse(await readFile(resolvedReportPath, "utf8"));
const approval = JSON.parse(
  await readFile(path.join(reportDir, "approval.json"), "utf8"),
);
const validation = JSON.parse(
  await readFile(path.join(reportDir, "validation.json"), "utf8"),
);
const receiptPath = path.join(reportDir, "delivery-receipt.json");

function stop(reason) {
  console.error(JSON.stringify({ status: "BLOCKED", reason }, null, 2));
  process.exit(1);
}

if (!validation.passed || !validateReport(report).passed) {
  stop("REPORT_VALIDATION_FAILED");
}
if (approval.decision !== "APPROVED") stop("OWNER_APPROVAL_MISSING");
if (approval.checksum !== report.checksum) stop("APPROVAL_CHECKSUM_MISMATCH");
if (report.fixture) stop("FIXTURE_REPORT_CANNOT_BE_DELIVERED");
if (process.env.LIVE_DELIVERY !== "1") stop("LIVE_DELIVERY_DISABLED");
if (!process.env.RESEND_API_KEY) stop("RESEND_API_KEY_MISSING");
if (!process.env.DELIVERY_FROM_EMAIL) stop("DELIVERY_FROM_EMAIL_MISSING");
try {
  await access(receiptPath);
  stop("DELIVERY_RECEIPT_ALREADY_EXISTS");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
    throw error;
  }
}

const markdown = await readFile(path.join(reportDir, "report.md"), "utf8");
const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    from: process.env.DELIVERY_FROM_EMAIL,
    to: [report.customer.deliveryEmail],
    subject: `Your Local Opportunity Brief — week of ${report.weekOf}`,
    text: markdown,
  }),
});

if (!response.ok) {
  stop(`EMAIL_PROVIDER_FAILED_${response.status}`);
}

const providerResult = await response.json();
const receipt = {
  status: "DELIVERED",
  reportId: report.reportId,
  deliveredAt: new Date().toISOString(),
  provider: "resend",
  providerMessageId: providerResult.id,
};
await writeFile(
  receiptPath,
  `${JSON.stringify(receipt, null, 2)}\n`,
  { flag: "wx" },
);
console.log(JSON.stringify(receipt, null, 2));
