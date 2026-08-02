import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateReport, validateReport } from "../lib/engine.mjs";
import { validateReportSyncPayload } from "../../lib/report-sync.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customer = JSON.parse(
  await readFile(path.join(root, "customers/founder-pilot-olympia.json"), "utf8"),
);
const source = JSON.parse(
  await readFile(path.join(root, "sources/olympia-2026-08-03.json"), "utf8"),
);

test("dashboard accepts an exact validated report packet", async () => {
  const report = generateReport(customer, source.opportunities, {
    asOf: "2026-08-03",
    fixture: false,
  });
  const packet = { schemaVersion: 1, report, validation: validateReport(report) };
  assert.deepEqual(await validateReportSyncPayload(packet), { passed: true, errors: [] });

  packet.report.summary = "Changed after validation";
  const tampered = await validateReportSyncPayload(packet);
  assert.equal(tampered.passed, false);
  assert.ok(tampered.errors.includes("Report checksum does not match."));
});
