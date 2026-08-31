import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateReport, scoreOpportunity, validateReport } from "../lib/engine.mjs";
import { runCustomer } from "../lib/run-customer.mjs";
import {
  isCustomerEligibleOn,
  validateCustomerProfile,
  validateSourcePack,
} from "../lib/source-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customer = JSON.parse(
  await readFile(path.join(root, "customers/founder-pilot-olympia.json"), "utf8"),
);
const source = JSON.parse(
  await readFile(path.join(root, "sources/olympia-2026-08-03.json"), "utf8"),
);

test("owner pilot uses five verified live sources inside the promised 30-day window", () => {
  const sourceCheck = validateSourcePack(source, { asOf: "2026-08-03" });
  assert.deepEqual(sourceCheck.errors, []);
  assert.equal(sourceCheck.passed, true);

  const report = generateReport(customer, source.opportunities, {
    asOf: "2026-08-03",
    fixture: false,
  });
  const reportCheck = validateReport(report);
  assert.equal(report.opportunities.length, 5);
  assert.ok(report.opportunities.every((opportunity) => opportunity.daysAway <= 30));
  assert.ok(
    report.opportunities.every(
      (opportunity) => !opportunity.evidence.sourceUrl.includes("example.com"),
    ),
  );
  assert.equal(report.deliveryEligible, false);
  assert.deepEqual(reportCheck.errors, []);
});

test("scoring rejects an otherwise relevant event on day 31", () => {
  const opportunity = {
    ...source.opportunities[0],
    id: "day-thirty-one-event",
    eventDate: "2026-09-03",
    prepareBy: "2026-08-20",
  };
  assert.deepEqual(scoreOpportunity(customer, opportunity, "2026-08-03"), {
    eligible: false,
    score: 0,
  });
});

test("live source validation blocks placeholder and stale evidence", () => {
  const placeholder = structuredClone(source);
  placeholder.opportunities[0].sourceUrl = "https://example.com/not-real";
  assert.ok(
    validateSourcePack(placeholder, { asOf: "2026-08-03" }).errors.some((error) =>
      error.includes("Non-live evidence URL"),
    ),
  );

  const stale = structuredClone(source);
  stale.opportunities[0].sourceCheckedAt = "2026-07-01";
  assert.ok(
    validateSourcePack(stale, { asOf: "2026-08-03" }).errors.some((error) =>
      error.includes("Stale source-check date"),
    ),
  );
});

test("customer delivery mode requires a real recipient address", () => {
  const unsafeCustomer = {
    ...customer,
    deliveryMode: "customer",
    deliveryEmail: "owner@example.com",
  };
  assert.ok(
    validateCustomerProfile(unsafeCustomer).errors.includes(
      "Customer delivery email is missing or unsafe.",
    ),
  );
});

test("dated pilots do not contaminate historical batch rehearsals", () => {
  const datedPilot = { ...customer, eligibleFrom: "2026-08-31" };
  assert.equal(isCustomerEligibleOn(datedPilot, "2026-08-03"), false);
  assert.equal(isCustomerEligibleOn(datedPilot, "2026-08-31"), true);
  assert.equal(
    validateCustomerProfile({ ...datedPilot, eligibleFrom: "08/31/2026" }).passed,
    false,
  );
});

test("pilot rehearsal creates a complete owner packet and remains undeliverable", async () => {
  const result = await runCustomer({
    customerSlug: "founder-pilot-olympia",
    asOf: "2026-08-03",
  });
  assert.equal(result.status, "READY_FOR_OWNER_REVIEW");
  assert.equal(result.fixture, false);
  assert.equal(result.deliveryEligible, false);
  for (const filename of [
    "report.json",
    "report.md",
    "email-preview.txt",
    "validation.json",
    "approval.json",
    "research-validation.json",
    "dashboard-sync.json",
  ]) {
    await readFile(path.join(result.outputDir, filename));
  }
});
