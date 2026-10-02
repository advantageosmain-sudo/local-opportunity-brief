import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport, renderMarkdown, validateReport, scoreOpportunity } from "./engine.mjs";
import { validateCustomerProfile, validateSourcePack } from "./source-validation.mjs";
import { customerEligibility } from "./customer-policy.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const safeFile = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]*\.json$/.test(value) && !value.includes("..");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

export async function runCustomer({ customerSlug, asOf, customer: providedCustomer, sourcePacks, root = defaultRoot }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customerSlug ?? "")) throw new Error("Customer slug is missing or unsafe.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "") || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) throw new Error("Report date must use YYYY-MM-DD.");
  const outputDir = path.join(root, "outbox", customerSlug, asOf);
  await mkdir(outputDir, { recursive: true });
  const diagnostics = { customer: { passed: false, errors: [], warnings: [] }, sources: [], passed: false, checkedAt: new Date().toISOString() };
  const claimPath = path.join(outputDir, ".generation-claim.json");
  try {
    await writeFile(claimPath, json({ customerSlug, asOf }), { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") return { status: "BLOCKED", reason: "GENERATION_IN_PROGRESS", customerSlug, outputDir, liveDelivery: false };
    throw error;
  }
  try {
    const customer = providedCustomer ?? await readJson(path.join(root, "customers", `${customerSlug}.json`));
    if (customer.slug !== customerSlug) throw new Error("Customer identity differs from requested slug.");
    diagnostics.customer = validateCustomerProfile(sourcePacks ? { ...customer, approvedSourceFiles: [] } : customer);
    if (!["pilot", "demo"].includes(customer.status)) {
      const eligibility = customerEligibility(customer);
      if (!eligibility.eligible) return { status: "SKIPPED", reason: "CUSTOMER_INELIGIBLE", reasons: eligibility.reasons, customerSlug, outputDir, liveDelivery: false };
    } else if (customer.deliveryMode === "customer") {
      throw new Error("Demo and pilot profiles cannot enable customer delivery.");
    }

    let files = customer.approvedSourceFiles ?? [];
    if (customer.marketProfileFile) {
      if (!safeFile(customer.marketProfileFile)) throw new Error("Unsafe market profile filename.");
      const market = await readJson(path.join(root, "markets", customer.marketProfileFile));
      if (market.marketId !== customer.marketId || market.location?.city !== customer.location?.city || market.location?.state !== customer.location?.state) throw new Error("Market profile does not match the customer location.");
      files = market.approvedSourceFiles;
    }
    const packs = sourcePacks ?? await Promise.all((files ?? []).map(async (sourceFile) => {
      if (!safeFile(sourceFile)) throw new Error("Unsafe source filename.");
      return { ...await readJson(path.join(root, "sources", sourceFile)), sourceFile };
    }));
    if (!packs.length) throw new Error("No approved source packs available for this market.");
    const allOpportunities = [];
    const fixtureFlags = new Set();
    for (const source of packs) {
      if (customer.marketId && source.marketId !== customer.marketId) {
        diagnostics.sources.push({ sourceFile: source.sourceFile, passed: false, errors: ["Source pack belongs to another market."], warnings: [] });
        continue;
      }
      const candidates = (source.opportunities ?? []).filter((opportunity) => {
        try { return scoreOpportunity(customer, opportunity, asOf).eligible; } catch { return false; }
      });
      const checked = { ...source, opportunities: candidates };
      const result = validateSourcePack(checked, { asOf });
      diagnostics.sources.push({ sourceFile: source.sourceFile ?? "hosted-market-registry", ...result, excludedCount: (source.opportunities?.length ?? 0) - candidates.length });
      fixtureFlags.add(Boolean(source.fixture));
      if (result.passed) allOpportunities.push(...candidates);
    }
    if (fixtureFlags.size > 1) throw new Error("Fixture and live source packs cannot be mixed in one report.");
    diagnostics.passed = diagnostics.customer.passed && diagnostics.sources.every((result) => result.passed);
    if (!diagnostics.passed) return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics);

    let existing;
    try { existing = await readJson(path.join(outputDir, "report.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const report = generateReport(customer, allOpportunities, { asOf, fixture: fixtureFlags.has(true), generatedAt: existing?.generatedAt });
    const validation = validateReport(report);
    if (!validation.passed) {
      diagnostics.report = validation;
      diagnostics.passed = false;
      return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics);
    }
    const result = { status: "READY_FOR_OWNER_REVIEW", reportId: report.reportId, customerSlug, outputDir, dashboardPacket: path.join(outputDir, "dashboard-sync.json"), opportunities: report.opportunities.length, fixture: report.fixture, deliveryEligible: report.deliveryEligible, validation, liveDelivery: false };
    if (existing) {
      if (existing.checksum !== report.checksum) return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, { ...diagnostics, passed: false, conflict: "An immutable report exists for this customer/date with a different hash. Owner must reconcile a revision; the existing approval and receipts are preserved." }, "GENERATION_HASH_CONFLICT");
      try {
        await Promise.all(["dashboard-sync.json", "validation.json", "approval.json", "source-snapshot.json", "research-validation.json", "report.md", "email-preview.txt"].map((filename) => readFile(path.join(outputDir, filename))));
      } catch {
        return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, { ...diagnostics, passed: false, conflict: "The immutable packet is incomplete. Existing report and approval were preserved." }, "IMMUTABLE_PACKET_INCOMPLETE");
      }
      return { ...result, deduplicated: true };
    }
    const approval = { reportId: report.reportId, checksum: report.checksum, decision: "PENDING", decidedBy: null, decidedAt: null, notes: "Approve this exact report through the owner dashboard; automation cannot approve on the owner’s behalf." };
    const outputs = {
      "research-validation.json": json(diagnostics),
      "source-snapshot.json": json({ asOf, customerSlug, marketId: customer.marketId ?? null, sourcePacks: packs }),
      "report.json": json(report), "report.md": renderMarkdown(report, validation),
      "email-preview.txt": `Subject: Your Local Opportunity Brief — week of ${report.weekOf}\n\n${renderMarkdown(report, validation)}`,
      "validation.json": json(validation), "approval.json": json(approval),
      "dashboard-sync.json": json({ schemaVersion: 1, report, validation }),
    };
    // The generation claim serializes writers. Exclusive writes preserve prior artifacts
    // and prevent a rerun from resetting an approval or provider receipt.
    for (const [filename, content] of Object.entries(outputs)) await writeFile(path.join(outputDir, filename), content, { flag: "wx" });
    return result;
  } catch (error) {
    diagnostics.customer.errors.push(error instanceof Error ? error.message : "Unknown report-generation failure.");
    return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics);
  } finally {
    await unlink(claimPath).catch(() => {});
  }
}

async function writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics, reason = "RESEARCH_OR_GENERATION_VALIDATION_FAILED") {
  const diagnostic = { status: "BLOCKED", customerSlug, asOf, reason, diagnostics, liveDelivery: false };
  await writeFile(path.join(outputDir, "diagnostic.json"), json(diagnostic));
  return { ...diagnostic, outputDir };
}
