import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { ingestConfiguredSources } from "./lib/source-ingestion.mjs";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--out-dir") {
  console.error("Usage: node automation/ingest-sources.mjs --config <market-ingestion.json> --out-dir <new-private-output-directory>");
  process.exitCode = 2;
} else {
  try {
    const filename = path.resolve(args[1]);
    if ((await stat(filename)).size > 64_000) throw new Error("CONFIG_TOO_LARGE");
    const config = JSON.parse(await readFile(filename, "utf8"));
    const outputDir = path.resolve(args[3]);
    // Exclusive output directory prevents replacing earlier evidence or reviews.
    await mkdir(outputDir, { recursive: false });
    const result = await ingestConfiguredSources(config);
    await writeFile(path.join(outputDir, "registry-candidates.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    await writeFile(path.join(outputDir, "ingestion-diagnostics.json"), `${JSON.stringify({ marketId: result.marketId, status: result.status, generatedAt: result.generatedAt, diagnostics: result.diagnostics, receipts: result.receipts }, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, candidateCount: result.candidateCount, blockedItemOrSourceCount: result.diagnostics.length, ownerApprovalRequired: true, liveDelivery: false, outputDir }, null, 2));
    if (result.status === "BLOCKED") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "BLOCKED", reason: /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "INGESTION_CONFIGURATION_OR_OUTPUT_FAILED", ownerApprovalRequired: true, liveDelivery: false }));
    process.exitCode = 1;
  }
}
