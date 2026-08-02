import process from "node:process";
import { deliverApprovedReport, DeliveryError } from "./lib/delivery.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const reportPath = arg("--report");
if (!reportPath) {
  console.error("Usage: node automation/deliver.mjs --report <report.json>");
  process.exit(2);
}

try {
  const receipt = await deliverApprovedReport({ reportPath });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const reason = error instanceof DeliveryError ? error.code : "DELIVERY_FAILED";
  console.error(
    JSON.stringify(
      {
        status: "BLOCKED",
        reason,
        details: error instanceof DeliveryError ? error.details : {},
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
