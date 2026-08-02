import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateReport, renderMarkdown, validateReport } from "../lib/engine.mjs";
import {
  deliverApprovedReport,
  DeliveryError,
  deliveryIdempotencyKey,
} from "../lib/delivery.mjs";

function opportunity(index) {
  return {
    id: `verified-event-${index}`,
    title: `Verified local event ${index}`,
    eventDate: `2026-08-${String(10 + index).padStart(2, "0")}`,
    prepareBy: "2026-08-05",
    city: "Olympia",
    state: "WA",
    distanceMiles: 1,
    sourceName: "Official organizer",
    sourceUrl: "https://www.olympiawa.gov/calendar.php",
    sourceCheckedAt: "2026-08-02",
    sourceAuthority: "official-organizer",
    sourceAccessStatus: "verified",
    sourceQuality: 5,
    customerTags: ["gift buyers"],
    productTags: ["small gifts"],
    urgency: 4,
    preparationEase: 5,
    offerType: "small gift display",
  };
}

async function createPacket({ deliveryMode = "customer" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lob-delivery-test-"));
  const customer = {
    slug: "test-customer",
    businessName: "Test Customer",
    deliveryEmail: "owner@verified-boutique.co",
    deliveryMode,
    location: { city: "Olympia", state: "WA", radiusMiles: 20 },
    category: "gift-shop",
    products: ["small gifts"],
    customers: ["gift buyers"],
    voice: ["warm"],
    exclusions: [],
  };
  const report = generateReport(
    customer,
    [1, 2, 3, 4, 5].map(opportunity),
    { asOf: "2026-08-03", fixture: false },
  );
  const validation = validateReport(report);
  assert.equal(validation.passed, true);
  await Promise.all([
    writeFile(path.join(directory, "report.json"), JSON.stringify(report)),
    writeFile(path.join(directory, "report.md"), renderMarkdown(report, validation)),
    writeFile(path.join(directory, "validation.json"), JSON.stringify(validation)),
    writeFile(
      path.join(directory, "approval.json"),
      JSON.stringify({ decision: "APPROVED", checksum: report.checksum }),
    ),
  ]);
  return { directory, report, reportPath: path.join(directory, "report.json") };
}

const liveEnv = {
  LIVE_DELIVERY: "1",
  RESEND_API_KEY: "test-key-never-sent",
  DELIVERY_FROM_EMAIL: "briefs@example.test",
};

test("an atomic claim and provider idempotency allow only one concurrent send", async (t) => {
  const packet = await createPacket();
  t.after(() => rm(packet.directory, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    assert.equal(options.headers["idempotency-key"], deliveryIdempotencyKey(packet.report));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ id: "provider-message-1" });
  };

  const results = await Promise.allSettled([
    deliverApprovedReport({ reportPath: packet.reportPath, env: liveEnv, fetchImpl }),
    deliverApprovedReport({ reportPath: packet.reportPath, env: liveEnv, fetchImpl }),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const receipt = JSON.parse(
    await readFile(path.join(packet.directory, "delivery-receipt.json"), "utf8"),
  );
  assert.equal(receipt.status, "DELIVERED");
});

test("provider failures create a diagnostic record for the owner alert", async (t) => {
  const packet = await createPacket();
  t.after(() => rm(packet.directory, { recursive: true, force: true }));
  await assert.rejects(
    deliverApprovedReport({
      reportPath: packet.reportPath,
      env: liveEnv,
      fetchImpl: async () => new Response("provider unavailable", { status: 503 }),
    }),
    (error) => error instanceof DeliveryError && error.code === "EMAIL_PROVIDER_FAILED_503",
  );
  const failure = JSON.parse(
    await readFile(path.join(packet.directory, "delivery-failure.json"), "utf8"),
  );
  assert.equal(failure.status, "DELIVERY_FAILED");
  assert.equal(failure.providerStatus, 503);
});

test("a confirmed provider failure can be retried without leaving a stale claim", async (t) => {
  const packet = await createPacket();
  t.after(() => rm(packet.directory, { recursive: true, force: true }));
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("provider unavailable", { status: 503 })
      : Response.json({ id: "provider-message-after-retry" });
  };

  await assert.rejects(
    deliverApprovedReport({ reportPath: packet.reportPath, env: liveEnv, fetchImpl }),
    (error) => error instanceof DeliveryError && error.code === "EMAIL_PROVIDER_FAILED_503",
  );
  const receipt = await deliverApprovedReport({
    reportPath: packet.reportPath,
    env: liveEnv,
    fetchImpl,
  });
  assert.equal(receipt.providerMessageId, "provider-message-after-retry");
  assert.equal(attempts, 2);
});

test("an ambiguous provider success creates an uncertainty lock", async (t) => {
  const packet = await createPacket();
  t.after(() => rm(packet.directory, { recursive: true, force: true }));
  await assert.rejects(
    deliverApprovedReport({
      reportPath: packet.reportPath,
      env: liveEnv,
      fetchImpl: async () => Response.json({}),
    }),
    (error) =>
      error instanceof DeliveryError && error.code === "EMAIL_PROVIDER_OUTCOME_UNCERTAIN",
  );
  const uncertain = JSON.parse(
    await readFile(path.join(packet.directory, "delivery-uncertain.json"), "utf8"),
  );
  assert.equal(uncertain.status, "DELIVERY_OUTCOME_UNCERTAIN");
});

test("owner-only pilot reports cannot reach the email provider", async (t) => {
  const packet = await createPacket({ deliveryMode: "owner_review_only" });
  t.after(() => rm(packet.directory, { recursive: true, force: true }));
  let called = false;
  await assert.rejects(
    deliverApprovedReport({
      reportPath: packet.reportPath,
      env: liveEnv,
      fetchImpl: async () => {
        called = true;
        return Response.json({ id: "should-not-send" });
      },
    }),
    (error) =>
      error instanceof DeliveryError &&
      error.code === "REPORT_NOT_ELIGIBLE_FOR_CUSTOMER_DELIVERY",
  );
  assert.equal(called, false);
});
