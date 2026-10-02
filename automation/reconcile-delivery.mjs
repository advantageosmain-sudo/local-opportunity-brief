import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { reconcileHostedDelivery } from "./lib/receipt-reconciliation.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
let result;
try { result = await reconcileHostedDelivery(); }
catch (error) {
  const reason = /^RECEIPT_RECONCILIATION_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "RECEIPT_RECONCILIATION_REQUEST_FAILED";
  result = { status: "BLOCKED", reason };
  process.exitCode = 1;
}
await mkdir(path.join(root, "outbox"), { recursive: true });
await writeFile(path.join(root, "outbox/receipt-reconciliation.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
