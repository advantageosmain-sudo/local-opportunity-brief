import { ensureDatabase } from "@/db/runtime";
import { isAutomationRequest } from "@/lib/internal-auth";
import { isQaCustomer, readCustomerProfile } from "@/lib/dashboard-policy.mjs";
export async function GET(request: Request) {
 if (!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const db=await ensureDatabase();
 const rows=(await db.prepare(`SELECT c.*,m.source_registry_json,m.first_approved_at,m.status AS market_status FROM customers c LEFT JOIN markets m ON c.market_id=m.id WHERE c.status='active' AND c.payment_status='active' AND c.onboarding_status='complete' AND c.delivery_status!='suppressed'`).all()).results as Record<string,unknown>[];
 const blockedSources=rows.filter(c=>!isQaCustomer(c)&&c.market_status!=='verified').map(c=>({customerSlug:c.id,marketId:c.market_id,code:c.market_status==null?'MARKET_SOURCE_MISSING':'MARKET_SOURCE_APPROVAL_REQUIRED'}));
 const customers=rows.flatMap(c=>{
  if(isQaCustomer(c)||c.market_status!=='verified') return [];
  const p=readCustomerProfile(c);
  if(!p || !['city','state','products','customers','voice'].every(field=>typeof p[field]==='string'&&p[field].trim()) ||
     !Number.isFinite(p.localRadius) || p.localRadius<=0 || (p.exclusions!==undefined&&typeof p.exclusions!=='string')) return [];
  const products=p.products.split(',').map((x:string)=>x.trim()).filter(Boolean);
  const audiences=p.customers.split(',').map((x:string)=>x.trim()).filter(Boolean);
  if(!products.length || !audiences.length) return [];
  let sourcePacks;
  try { sourcePacks=JSON.parse(String(c.source_registry_json??'[]')); } catch { return []; }
  if(!Array.isArray(sourcePacks) || !sourcePacks.every(pack=>
    pack && typeof pack==='object' && !Array.isArray(pack) && Array.isArray(pack.opportunities) &&
    pack.opportunities.every((opportunity: unknown)=>
      opportunity && typeof opportunity==='object' && !Array.isArray(opportunity)))) return [];
  return [{slug:c.id,customerId:c.id,businessName:c.business_name,deliveryEmail:c.email,deliveryMode:'customer',status:'active',subscriptionStatus:'active',paymentStatus:'active',intakeComplete:true,paused:false,emailSuppressed:false,marketId:c.market_id,location:{city:p.city,state:p.state,radiusMiles:p.localRadius},products,customers:audiences,voice:[p.voice],exclusions:[p.exclusions].filter(Boolean),approvedSourceFiles:[],sourcePacks,ownerApprovalRequired:!c.first_delivered_at||!c.first_approved_at||c.require_every_review!==0}];
 });
 return Response.json({customers,...(blockedSources.length?{blockedSourceCount:blockedSources.length,blockedSources}:{})},{headers:{'cache-control':'no-store'}});
}
