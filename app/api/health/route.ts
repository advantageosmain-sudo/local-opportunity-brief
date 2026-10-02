import { getRuntimeEnv } from "@/db/runtime";

export async function GET() {
  const paymentsMode = getRuntimeEnv().PAYMENTS_MODE === "test" ? "test" : "disabled";
  return Response.json({
    business: "Local Opportunity Brief",
    status: "ok",
    liveDelivery: false,
    paymentsMode,
    version: "0.5.0",
  });
}

