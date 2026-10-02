import { ensureDatabase } from "@/db/runtime";
import { isAutomationRequest } from "@/lib/internal-auth";
export async function GET(request: Request) {
 if (!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const db=await ensureDatabase();
 const rows=await db.prepare(`SELECT c.*,m.source_registry_json,m.first_approved_at FROM customers c LEFT JOIN markets m ON c.market_id=m.id WHERE COALESCE(json_extract(c.profile_json,'$.isTest'),0)=0 AND c.status='active' AND c.payment_status='active' AND c.onboarding_status='complete' AND c.delivery_status!='suppressed'`).all<Record<string,unknown>>();
 const customers=rows.results.map(c=>{ const p=JSON.parse(String(c.profile_json)); return {slug:c.id,customerId:c.id,businessName:c.business_name,deliveryEmail:c.email,deliveryMode:'customer',status:'active',subscriptionStatus:'active',paymentStatus:'active',intakeComplete:true,paused:false,emailSuppressed:false,marketId:c.market_id,location:{city:p.city,state:p.state,radiusMiles:p.localRadius},products:p.products.split(',').map((x:string)=>x.trim()).filter(Boolean),customers:p.customers.split(',').map((x:string)=>x.trim()).filter(Boolean),voice:[p.voice],exclusions:[p.exclusions].filter(Boolean),approvedSourceFiles:[],sourcePacks:JSON.parse(String(c.source_registry_json??'[]')),ownerApprovalRequired:!c.first_delivered_at||!c.first_approved_at||c.require_every_review!==0}; });
 return Response.json({customers},{headers:{'cache-control':'no-store'}});
}
