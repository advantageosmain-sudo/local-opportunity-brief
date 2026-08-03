import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport, renderMarkdown, validateReport } from "./engine.mjs";
import { validateCustomerProfile, validateSourcePack } from "./source-validation.mjs";

const automationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runCustomer({ customerSlug, asOf, allowInactive = false }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customerSlug)) {
    throw new Error("Customer slug is missing or unsafe.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("Report date must use YYYY-MM-DD.");
  }

  const outputDir = path.join(automationRoot, "outbox", customerSlug, asOf);
  await mkdir(outputDir, { recursive: true });
  const diagnostics = {
    customer: { passed: false, errors: [], warnings: [] },
    sources: [],
    passed: false,
    checkedAt: new Date().toISOString(),
  };

  try {
    const customer = JSON.parse(
      await readFile(path.join(automationRoot, "customers", `${customerSlug}.json`), "utf8"),
    );
    diagnostics.customer = validateCustomerProfile(customer);
    if (customer.status === "inactive" && !allowInactive) {
      diagnostics.customer.errors.push("Customer is inactive.");
      diagnostics.customer.passed = false;
    }

    const allOpportunities = [];
    const fixtureFlags = new Set();
    for (const sourceFile of customer.approvedSourceFiles ?? []) {
      if (!/^[a-z0-9][a-z0-9._-]*\.json$/.test(sourceFile)) {
        diagnostics.sources.push({
          sourceFile,
          passed: false,
          errors: ["Unsafe source filename."],
          warnings: [],
        });
        continue;
      }
      const source = JSON.parse(
        await readFile(path.join(automationRoot, "sources", sourceFile), "utf8"),
      );
      const result = validateSourcePack(source, { asOf });
      diagnostics.sources.push({ sourceFile, ...result });
      fixtureFlags.add(Boolean(source.fixture));
      allOpportunities.push(...(source.opportunities ?? []));
    }
    if (fixtureFlags.size > 1) {
      diagnostics.sources.push({
        sourceFile: "combined-source-check",
        passed: false,
        errors: ["Fixture and live source packs cannot be mixed in one report."],
        warnings: [],
      });
    }

    diagnostics.passed =
      diagnostics.customer.passed && diagnostics.sources.every((result) => result.passed);
    await writeFile(
      path.join(outputDir, "research-validation.json"),
      `${JSON.stringify(diagnostics, null, 2)}\n`,
    );
    if (!diagnostics.passed) {
      return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics);
    }

    const fixture = fixtureFlags.has(true);
    const report = generateReport(customer, allOpportunities, { asOf, fixture });
    const validation = validateReport(report);
    const approval = {
      reportId: report.reportId,
      checksum: report.checksum,
      decision: "PENDING",
      decidedBy: null,
      decidedAt: null,
      notes: "",
    };
    const dashboardPacket = {
      schemaVersion: 1,
      report,
      validation,
    };

    await Promise.all([
      writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
      writeFile(path.join(outputDir, "report.md"), renderMarkdown(report, validation)),
      writeFile(
        path.join(outputDir, "email-preview.txt"),
        `Subject: Your Local Opportunity Brief — week of ${report.weekOf}\n\n${renderMarkdown(report, validation)}`,
      ),
      writeFile(
        path.join(outputDir, "validation.json"),
        `${JSON.stringify(validation, null, 2)}\n`,
      ),
      writeFile(
        path.join(outputDir, "approval.json"),
        `${JSON.stringify(approval, null, 2)}\n`,
      ),
      writeFile(
        path.join(outputDir, "dashboard-sync.json"),
        `${JSON.stringify(dashboardPacket, null, 2)}\n`,
      ),
    ]);

    return {
      status: validation.passed ? "READY_FOR_OWNER_REVIEW" : "BLOCKED",
      reportId: report.reportId,
      customerSlug,
      outputDir,
      dashboardPacket: path.join(outputDir, "dashboard-sync.json"),
      opportunities: report.opportunities.length,
      fixture: report.fixture,
      deliveryEligible: report.deliveryEligible,
      validation,
      liveDelivery: false,
    };
  } catch (error) {
    diagnostics.customer.errors.push(
      error instanceof Error ? error.message : "Unknown report-generation failure.",
    );
    return await writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics);
  }
}

async function writeBlockedDiagnostic(outputDir, customerSlug, asOf, diagnostics) {
  const diagnostic = {
    status: "BLOCKED",
    customerSlug,
    asOf,
    reason: "RESEARCH_OR_GENERATION_VALIDATION_FAILED",
    diagnostics,
    liveDelivery: false,
  };
  await writeFile(
    path.join(outputDir, "diagnostic.json"),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
  );
  return { ...diagnostic, outputDir };
}
