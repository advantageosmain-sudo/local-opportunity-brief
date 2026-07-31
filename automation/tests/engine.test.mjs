import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  generateReport,
  scoreOpportunity,
  validateReport,
} from "../lib/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customer = JSON.parse(
  await readFile(path.join(root, "customers/demo-boutique.json"), "utf8"),
);
const source = JSON.parse(
  await readFile(path.join(root, "sources/demo-events.json"), "utf8"),
);

test("selects exactly five relevant local opportunities", () => {
  const report = generateReport(customer, source.opportunities, {
    asOf: "2026-08-03",
    fixture: true,
  });
  assert.equal(report.opportunities.length, 5);
  assert.ok(
    report.opportunities.every(
      (opportunity) => opportunity.location === "DeWitt, AR",
    ),
  );
  assert.ok(
    report.opportunities.every(
      (opportunity) => opportunity.id !== "demo-far-conference-2026",
    ),
  );
});

test("rejects events outside the approved radius", () => {
  const far = source.opportunities.find(
    (opportunity) => opportunity.id === "demo-far-conference-2026",
  );
  assert.deepEqual(scoreOpportunity(customer, far, "2026-08-03"), {
    eligible: false,
    score: 0,
  });
});

test("new reports stop at owner approval and pass content validation", () => {
  const report = generateReport(customer, source.opportunities, {
    asOf: "2026-08-03",
    fixture: true,
  });
  const result = validateReport(report);
  assert.equal(report.status, "PENDING_APPROVAL");
  assert.equal(report.safeguards.liveDelivery, false);
  assert.equal(result.passed, true);
  assert.ok(
    result.warnings.includes(
      "Fixture data: demonstration only; live delivery is prohibited.",
    ),
  );
});

test("validation blocks prohibited guarantee wording", () => {
  const report = generateReport(customer, source.opportunities, {
    asOf: "2026-08-03",
    fixture: false,
  });
  report.opportunities[0].caption = "Guaranteed sales for every store.";
  const result = validateReport(report);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("guaranteed sales")));
  assert.ok(result.errors.some((error) => error.includes("checksum")));
});
