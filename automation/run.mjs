import process from "node:process";
import { chicagoDate } from "./lib/schedule.mjs";
import { runCustomer } from "./lib/run-customer.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function today() {
  return chicagoDate();
}

const result = await runCustomer({
  customerSlug: arg("--customer", "demo-boutique"),
  asOf: arg("--as-of", today()),
});
console.log(JSON.stringify(result, null, 2));
if (result.status === "BLOCKED") process.exitCode = 1;

