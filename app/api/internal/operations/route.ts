import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { isAutomationRequest } from "@/lib/internal-auth";
import { isQaCustomer, readCustomerProfile } from "@/lib/dashboard-policy.mjs";
export async function GET(request: Request) {
 if (!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 try {
 const db=await ensureDatabase();
 const customers=(await db.prepare('SELECT * FROM customers ORDER BY created_at DESC LIMIT 1000').all()).results as Record<string,unknown>[];
 const realCustomers=customers.filter(c=>!isQaCustomer(c));
 const reports=(await db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200').all()).results;
 const diagnostics=(await db.prepare('SELECT * FROM diagnostics ORDER BY updated_at DESC LIMIT 200').all()).results;
 const env=getRuntimeEnv();
 const safeCustomers=customers.map(c=>{const p={...(readCustomerProfile(c)??{})};delete p.checkoutToken;return {...c,profile_json:JSON.stringify(p)};});
 return Response.json({customers:safeCustomers,reports,diagnostics,fetchedAt:new Date().toISOString(),summary:{monthlyRecurringRevenue:null,liveStatus:'BLOCKED',paymentsMode:env.PAYMENTS_MODE??'disabled',deliveryEnabled:env.LIVE_DELIVERY==='1',activeSubscriptions:realCustomers.filter(c=>c.payment_status==='active').length,foundingCapacity:10,customerCount:realCustomers.length}},{headers:{'cache-control':'no-store'}});
 } catch { return Response.json({error:'Operations snapshot unavailable.'},{status:503}); }
}
