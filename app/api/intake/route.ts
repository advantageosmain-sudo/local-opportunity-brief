import { ensureDatabase } from "@/db/runtime";
import { validateIntake } from "@/lib/intake";
import { marketId } from "@/lib/customer-lifecycle.mjs";

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({error:'Use the intake form.'},{status:415});
  const raw = await request.text();
  if (raw.length > 20000) return Response.json({error:'Form too large.'},{status:413});
  let input;
  try { input=JSON.parse(raw); } catch { return Response.json({error:'Invalid form.'},{status:400}); }
  const checked=validateIntake(input);
  if (!checked.ok) return Response.json({error:checked.error},{status:400});
  try {
    const db=await ensureDatabase();
    const data=checked.data;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${data.email}|${data.businessName.toLowerCase()}|${data.state}|${data.city.toLowerCase()}`));
    const id=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    const bucket=`${id}:${new Date().toISOString().slice(0,13)}`;
    await db.prepare('INSERT INTO intake_limits(bucket,attempts) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1').bind(bucket).run();
    const limit=await db.prepare('SELECT attempts FROM intake_limits WHERE bucket=?').bind(bucket).first<{attempts:number}>();
    if ((limit?.attempts??0)>10) return Response.json({error:'Please try again later.'},{status:429});
    const exists=await db.prepare('SELECT id FROM customers WHERE id=?').bind(id).first();
    if (exists) return Response.json({message:'Your request is saved. Contact support for changes.'},{status:200});
    const checkoutToken=crypto.randomUUID()+crypto.randomUUID();
    const market=marketId(data);
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO markets(id,city,state,zip) VALUES(?,?,?,?)').bind(market,data.city,data.state,data.zip),
      db.prepare(`INSERT OR IGNORE INTO leads(id,contact_name,email,business_name,website,city,state,category,local_radius,products,customers,voice,exclusions,notes,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,data.contactName,data.email,data.businessName,data.website,data.city,data.state,data.category,data.localRadius,data.products,data.customers,data.voice,data.exclusions,data.notes,'new'),
      db.prepare(`INSERT OR IGNORE INTO customers(id,lead_id,email,business_name,profile_json,market_id,onboarding_status) VALUES(?,?,?,?,?,?,'complete')`).bind(id,id,data.email,data.businessName,JSON.stringify({...data,checkoutToken,consentRecordedAt:new Date().toISOString()}),market),
      db.prepare(`INSERT OR IGNORE INTO diagnostics(id,system,subject_id,code) VALUES(?, 'onboarding', ?, 'SOURCE_DISCOVERY_REQUIRED')`).bind(`onboard-${id}`,id)
    ]);
    return Response.json({message:'Your business details are saved. We will check local coverage before checkout.',customerId:id,checkoutToken},{status:201});
  } catch { return Response.json({error:'We could not save your request. Nothing was charged.'},{status:503}); }
}
