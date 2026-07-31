export async function GET() {
  return Response.json({
    business: "Local Opportunity Brief",
    status: "ok",
    liveDelivery: false,
    version: "0.1.0",
  });
}
