import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { validateIntake } from "@/lib/intake";
import { marketId } from "@/lib/customer-lifecycle.mjs";

export async function processIntake(request: Request, qa = false) {
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({error:'Use the intake form.'},{status:415});
  const raw = await request.text();
  if (raw.length > 20000) return Response.json({error:'Form too large.'},{status:413});
  let input;
  try { input=JSON.parse(raw); } catch { return Response.json({error:'Invalid form.'},{status:400}); }
  if(!qa && (input?.isTest || input?.qa || input?.syntheticAcknowledgement || input?.qaAcknowledged)) return Response.json({error:'QA intake requires the owner-only test page.'},{status:400});
  if(qa && input?.qaAcknowledged!=='yes') return Response.json({error:'Confirm this is a synthetic owner-only QA record.'},{status:400});
  const checked=validateIntake(input,{qa});
  if (!checked.ok) return Response.json({error:checked.error},{status:400});
  if(qa && checked.data.email!==getRuntimeEnv().OWNER_EMAIL?.toLowerCase()) return Response.json({error:'QA records must use the configured owner email.'},{status:400});
  try {
    const db=await ensureDatabase();
    const data=checked.data;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${qa?"owner-qa|":""}${data.email}|${data.businessName.toLowerCase()}|${data.state}|${data.city.toLowerCase()}`));
    const id=(qa?'qa-':'')+[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    const bucket=`${id}:${new Date().toISOString().slice(0,13)}`;
    await db.prepare('INSERT INTO intake_limits(bucket,attempts) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1').bind(bucket).run();
    const limit=await db.prepare('SELECT attempts FROM intake_limits WHERE bucket=?').bind(bucket).first<{attempts:number}>();
    if ((limit?.attempts??0)>10) return Response.json({error:'Please try again later.'},{status:429});
    const exists=await db.prepare('SELECT id,profile_json FROM customers WHERE id=?').bind(id).first<{id:string;profile_json:string}>();
    if(qa && exists && JSON.parse(exists.profile_json).isTest!==true) return Response.json({error:'QA record identity conflict.'},{status:409});
    if (exists) return Response.json(qa?{message:'Synthetic QA record already exists. No service agreement or purchase created.',customerId:id,isTest:true,duplicate:true}:{message:'Your request is saved. Contact support for changes.'},{status:200});
    const checkoutToken=crypto.randomUUID()+crypto.randomUUID();
    const market=(qa?"qa-":"")+marketId(data);
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO markets(id,city,state,zip) VALUES(?,?,?,?)').bind(market,data.city,data.state,data.zip),
      db.prepare(`INSERT OR IGNORE INTO leads(id,contact_name,email,business_name,website,city,state,category,local_radius,products,customers,voice,exclusions,notes,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,data.contactName,data.email,data.businessName,data.website,data.city,data.state,data.category,data.localRadius,data.products,data.customers,data.voice,data.exclusions,data.notes,qa?'test_qa':'new'),
      db.prepare(`INSERT OR IGNORE INTO customers(id,lead_id,email,business_name,profile_json,market_id,onboarding_status,payment_status,status) VALUES(?,?,?,?,?,?,'complete',?,?)`).bind(id,id,data.email,data.businessName,JSON.stringify(qa?{...data,isTest:true,syntheticAcknowledgement:true,qaCreatedAt:new Date().toISOString(),legalConsentRecorded:false}:{...data,checkoutToken,consentRecordedAt:new Date().toISOString()}),market,qa?'test_qa':'unpaid',qa?'test':'onboarding'),
      db.prepare(`INSERT OR IGNORE INTO diagnostics(id,system,subject_id,code) VALUES(?, 'onboarding', ?, ?)`).bind(`onboard-${id}`,id,qa?'QA_INTAKE_ONLY':'SOURCE_DISCOVERY_REQUIRED')
    ]);
    if(qa) return Response.json({message:'Synthetic QA intake saved. No service agreement, purchase, or delivery consent was created.',customerId:id,isTest:true},{status:201});
    return Response.json({message:'Your business details are saved. We will check local coverage before checkout.',customerId:id,checkoutToken},{status:201});
  } catch { return Response.json({error:'We could not save your request. Nothing was charged.'},{status:503}); }
}

export async function POST(request:Request){return processIntake(request,false);}
