import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { customerEligibility, reviewRequirement } from "../lib/customer-policy.mjs";
import { weeklyScheduleGuard, chicagoDate } from "../lib/schedule.mjs";
import { runCustomer } from "../lib/run-customer.mjs";
import { generateReport, validateReport, computeReportChecksum } from "../lib/engine.mjs";
import { requestHostedDelivery, readHostedCustomers } from "../lib/hosted-client.mjs";

const profile = {
  slug: "mock-active-customer", status: "active", subscriptionStatus: "active", paymentStatus: "active", intakeComplete: true,
  businessName: "Mock fixture retailer", deliveryMode: "customer", deliveryEmail: "owner@mock-retailer.co", marketId: "olympia-wa",
  location: { city: "Olympia", state: "WA", radiusMiles: 12 }, category: "gift-shop", products: ["small gifts"], customers: ["families"], voice: ["warm"], exclusions: [], approvedSourceFiles: [],
};
function sourcePack() {
  return { fixture: false, marketId: "olympia-wa", opportunities: [1, 2, 3, 4, 5].map((index) => ({
    id: `mock-opportunity-${index}`, title: `Mock validation scenario ${index}`, eventDate: `2026-10-${String(3 + index).padStart(2, "0")}`, prepareBy: "2026-10-02", city: "Olympia", state: "WA", geographyMode: "city_match", distanceMiles: null, marketId: "olympia-wa", geographyBasis: "MOCK ONLY: explicit same-city mode", sourceName: "Mock official source", sourceUrl: `https://www.olympiawa.gov/calendar.php?mock_event=${index}`, sourceCheckedAt: "2026-10-02", sourceAuthority: "official-government", sourceAccessStatus: "verified", sourceQuality: 5, customerTags: ["families"], productTags: ["small gifts"], urgency: 4, preparationEase: 5, offerType: "small display",
  })) };
}
async function temporary(t) { const root = await mkdtemp(path.join(os.tmpdir(), "lob-safety-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test("only active paid completed unsuppressed customers are eligible", () => {
  assert.equal(customerEligibility(profile).eligible, true);
  for (const change of [{ status: "demo" }, { status: "pilot" }, { status: "paused" }, { status: "canceled" }, { paymentStatus: "unpaid" }, { subscriptionStatus: "past_due" }, { intakeComplete: false }, { paused: true }, { canceledAt: "2026-10-02" }, { emailSuppressed: true }, { deliveryEmail: "two@example.com\nBcc: third@elsewhere.co" }]) assert.equal(customerEligibility({ ...profile, ...change }).eligible, false, JSON.stringify(change));
});

test("automation cannot self-approve first customer or first market; acceptance is insufficient", () => {
  const accepted = { ownerApproved: true, approvalActorType: "human", deliveryStatus: "ACCEPTED", providerMessageId: "mock-1", reportId: "mock-report", checksum: "mock-hash", customerSlug: profile.slug, marketId: profile.marketId };
  const query = { customerSlug: profile.slug, marketId: profile.marketId, reviewAllReports: false };
  assert.equal(reviewRequirement({ ...query, history: [accepted] }).ownerApprovalRequired, true);
  const delivered = { ...accepted, deliveryStatus: "DELIVERED" };
  assert.equal(reviewRequirement({ ...query, history: [delivered] }).ownerApprovalRequired, false);
  assert.equal(reviewRequirement({ ...query, history: [delivered], reviewAllReports: true }).ownerApprovalRequired, true);
  assert.equal(reviewRequirement({ ...query, history: [delivered], marketId: "new-market" }).ownerApprovalRequired, true);
  assert.equal(reviewRequirement({ ...query, history: [{ ...delivered, approvalActorType: "system" }] }).ownerApprovalRequired, true);
});

test("Chicago Monday schedule selects exactly one UTC cron across DST boundaries", () => {
  for (const [date, expected] of [["2026-03-02", "17 15 * * 1"], ["2026-03-09", "17 14 * * 1"], ["2026-10-26", "17 14 * * 1"], ["2026-11-02", "17 15 * * 1"]]) {
    const results = ["17 14 * * 1", "17 15 * * 1"].map((scheduledCron) => weeklyScheduleGuard({ now: new Date(`${date}T16:45:00Z`), eventName: "schedule", scheduledCron }));
    assert.equal(results.filter((result) => result.enabled).length, 1);
    assert.equal(results.find((result) => result.enabled).expectedCron, expected);
  }
  assert.equal(chicagoDate(new Date("2026-10-02T02:00:00Z")), "2026-10-01");
  assert.equal(weeklyScheduleGuard({ now: new Date("2026-10-06T14:17:00Z"), eventName: "schedule", scheduledCron: "17 14 * * 1" }).enabled, false);
});

test("generation reruns preserve exact approval, source snapshot and delivery receipts", async (t) => {
  const root = await temporary(t);
  const options = { customerSlug: profile.slug, asOf: "2026-10-02", customer: profile, sourcePacks: [sourcePack()], root };
  const initial = await runCustomer(options);
  assert.equal(initial.status, "READY_FOR_OWNER_REVIEW");
  const approvalPath = path.join(initial.outputDir, "approval.json");
  const receiptPath = path.join(initial.outputDir, "delivery-receipt.json");
  const ownerApproval = { decision: "APPROVED", actor: "mock-human" };
  await writeFile(approvalPath, JSON.stringify(ownerApproval));
  await writeFile(receiptPath, JSON.stringify({ status: "ACCEPTED", providerMessageId: "mock-provider" }));
  const second = await runCustomer(options);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(JSON.parse(await readFile(approvalPath, "utf8")), ownerApproval);
  const changed = sourcePack(); changed.opportunities[0].title = "Materially different contents";
  const conflict = await runCustomer({ ...options, sourcePacks: [changed] });
  assert.equal(conflict.reason, "GENERATION_HASH_CONFLICT");
  assert.deepEqual(JSON.parse(await readFile(approvalPath, "utf8")), ownerApproval);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).providerMessageId, "mock-provider");
});

test("fewer than five first-party opportunities block without creating a report", async (t) => {
  const root = await temporary(t);
  const pack = sourcePack(); pack.opportunities.pop();
  const result = await runCustomer({ customerSlug: profile.slug, asOf: "2026-10-02", customer: profile, sourcePacks: [pack], root });
  assert.equal(result.status, "BLOCKED");
  await assert.rejects(readFile(path.join(result.outputDir, "report.json")), { code: "ENOENT" });
  assert.match(await readFile(path.join(result.outputDir, "diagnostic.json"), "utf8"), /exactly 5/);
});

test("stale research, wrong markets, past events and reporting-only sources cannot qualify", async (t) => {
  const root = await temporary(t);
  for (const [index, mutate] of [
    (pack) => { pack.opportunities[0].sourceCheckedAt = "2026-09-01"; },
    (pack) => { pack.marketId = "other-market"; },
    (pack) => { pack.opportunities[0].eventDate = "2026-09-28"; },
    (pack) => { pack.opportunities[0].sourceAuthority = "reputable-local-reporting"; },
  ].entries()) {
    const pack = sourcePack(); mutate(pack);
    const result = await runCustomer({ customerSlug: `${profile.slug}-${index}`, asOf: "2026-10-02", customer: { ...profile, slug: `${profile.slug}-${index}` }, sourcePacks: [pack], root });
    assert.equal(result.status, "BLOCKED");
  }
});

test("report validation independently catches duplicate events and false city-match proof", () => {
  const report = generateReport(profile, sourcePack().opportunities, { asOf: "2026-10-02", fixture: false });
  report.opportunities[0].location = "Seattle, WA"; report.checksum = computeReportChecksum(report);
  assert.equal(validateReport(report).passed, false);
  const duplicate = generateReport(profile, sourcePack().opportunities, { asOf: "2026-10-02", fixture: false });
  duplicate.opportunities[1] = { ...duplicate.opportunities[0], id: "different-id-same-event" }; duplicate.checksum = computeReportChecksum(duplicate);
  assert.ok(validateReport(duplicate).errors.some((error) => error.includes("Duplicate event evidence")));
});

test("hosted delivery submits only identity/hash and never a forged approval", async () => {
  const report = { reportId: "mock-active-customer-2026-10-02", checksum: "hash" };
  const env = { REPORT_SYNC_URL: "https://mock-hosted-service.co/api/internal/reports", REPORT_SYNC_SECRET: "mock-not-real" };
  const result = await requestHostedDelivery({ report, env, fetchImpl: async (url, options) => {
    assert.equal(url, "https://mock-hosted-service.co/api/internal/automation/deliver");
    assert.deepEqual(JSON.parse(options.body), report);
    return Response.json({ status: "PENDING_OWNER_APPROVAL" });
  } });
  assert.equal(result.status, "PENDING_OWNER_APPROVAL");
  await assert.rejects(readHostedCustomers({ env, fetchImpl: async () => Response.json({ untrusted: [] }) }), /customers array/);
});
