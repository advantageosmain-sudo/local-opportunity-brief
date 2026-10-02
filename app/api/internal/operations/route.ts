import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { isAutomationRequest } from "@/lib/internal-auth";
export async function GET(request: Request) {
 if (!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 try {
 const db=await ensureDatabase();
 const customers=(await db.prepare('SELECT * FROM customers ORDER BY created_at DESC LIMIT 1000').all()).results;
 const reports=(await db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200').all()).results;
 const diagnostics=(await db.prepare('SELECT * FROM diagnostics ORDER BY updated_at DESC LIMIT 200').all()).results;
 const env=getRuntimeEnv();
 const safeCustomers=customers.map((c:Record<string,unknown>)=>{const p=JSON.parse(String(c.profile_json));delete p.checkoutToken;return {...c,profile_json:JSON.stringify(p)};});
 return Response.json({customers:safeCustomers,reports,diagnostics,fetchedAt:new Date().toISOString(),summary:{monthlyRecurringRevenue:null,liveStatus:'BLOCKED',paymentsMode:env.PAYMENTS_MODE??'disabled',deliveryEnabled:env.LIVE_DELIVERY==='1',activeSubscriptions:customers.filter(c=>c.payment_status==='active').length,foundingCapacity:10,customerCount:customers.filter(c=>!String(c.payment_status).startsWith('test_')).length}},{headers:{'cache-control':'no-store'}});
 } catch { return Response.json({error:'Operations snapshot unavailable.'},{status:503}); }
}
