import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateReport } from "./lib/engine.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const reportPath = arg("--report");
if (!reportPath) {
  console.error("Usage: node automation/validate.mjs --report <report.json>");
  process.exit(2);
}

const report = JSON.parse(await readFile(path.resolve(reportPath), "utf8"));
const result = validateReport(report);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
