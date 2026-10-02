import { secureStringEqual } from "@/lib/security.mjs";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { parseSubscriptionWebhook, verifyLemonSqueezySignature } from "@/lib/lemon-squeezy.mjs";
export async function POST(request: Request) {
  const env=getRuntimeEnv();
  if (!['test','live'].includes(env.PAYMENTS_MODE??'') || !env.LEMON_SQUEEZY_WEBHOOK_SECRET || (env.PAYMENTS_MODE==='live' && env.LIVE_CHECKOUT_VERIFIED!=='1')) return Response.json({error:'Payments are not enabled.'},{status:503});
  const raw=await request.text();
  if (!raw || raw.length>1000000) return Response.json({error:'Invalid payload.'},{status:400});
  if (!await verifyLemonSqueezySignature(raw,request.headers.get('x-signature'),env.LEMON_SQUEEZY_WEBHOOK_SECRET)) return Response.json({error:'Invalid signature.'},{status:401});
  let event;
  try { event=parseSubscriptionWebhook(raw,request.headers.get('x-event-name'),env.PAYMENTS_MODE); } catch { return Response.json({error:'Unsupported payment event.'},{status:400}); }
  const providerPayload=JSON.parse(raw);
  const isInvoice=event.eventName.startsWith("subscription_payment_");
  if(!env.LEMON_SQUEEZY_VARIANT_ID || (!isInvoice && String(providerPayload.data?.attributes?.variant_id??'')!==env.LEMON_SQUEEZY_VARIANT_ID)) return Response.json({error:'Subscription product is not configured or does not match.'},{status:409});
  try {
    const db=await ensureDatabase();
    const provider=event.testMode?'lemon_squeezy_test':'lemon_squeezy';
    const prior=await db.prepare('SELECT id FROM payment_events WHERE provider=? AND external_id=?').bind(provider,event.externalId).first();
    if (prior) return Response.json({status:'DUPLICATE_IGNORED'});
    let c=await db.prepare('SELECT id,payment_status FROM customers WHERE subscription_id=? LIMIT 1').bind(event.subscriptionId).first<{id:string;payment_status?:string}>();
    if(!c && !isInvoice && event.leadId) {
      const candidate=await db.prepare('SELECT id,profile_json FROM customers WHERE id=? AND subscription_id IS NULL').bind(event.leadId).first<{id:string;profile_json:string}>();
      const token=providerPayload.meta?.custom_data?.checkout_token;
      if(candidate && typeof token==='string' && secureStringEqual(JSON.parse(candidate.profile_json).checkoutToken,token)) c={id:candidate.id};
    }
    if(isInvoice && !c) return Response.json({error:'Unknown subscription invoice.'},{status:409});
    const id=c?.id ?? `payment-${event.subscriptionId}`;
    const proposed=event.testMode ? 'test_'+event.status : event.status;
    const status=isInvoice && ['canceled','expired','test_canceled','test_expired'].includes(c?.payment_status??'') ? c!.payment_status : proposed;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO customers(id,email,business_name,market_id,subscription_id,payment_customer_id) VALUES(?, '', 'Intake required', 'unassigned', ?, ?)`).bind(id,event.subscriptionId,event.paymentCustomerId),
      db.prepare(`UPDATE customers SET subscription_id=?, payment_customer_id=?, payment_status=CASE WHEN ?=1 AND payment_status IN ('canceled','expired','test_canceled','test_expired') THEN payment_status ELSE ? END, payment_updated_at=?, status=CASE WHEN status IN ('paused','canceled') THEN status WHEN ?='active' AND (?=0 OR payment_status NOT IN ('canceled','expired','test_canceled','test_expired')) AND onboarding_status='complete' THEN 'active' ELSE 'onboarding' END, updated_at=CURRENT_TIMESTAMP WHERE id=? AND (payment_updated_at IS NULL OR payment_updated_at<?) AND NOT EXISTS(SELECT 1 FROM payment_events WHERE provider=? AND external_id=?)`).bind(event.subscriptionId,event.paymentCustomerId,isInvoice?1:0,status,event.occurredAt,status,isInvoice?1:0,id,event.occurredAt,provider,event.externalId),
      db.prepare(`INSERT OR IGNORE INTO payment_events(id,provider,event_name,external_id,payload_json) VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(),provider,event.eventName,event.externalId,JSON.stringify(event)),
      db.prepare(`INSERT INTO diagnostics(id,system,subject_id,code) VALUES(?,'payments',?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,updated_at=CURRENT_TIMESTAMP`).bind(`payment-${id}`,id,status==='active'?'FIRST_REPORT_REVIEW_REQUIRED':`SUBSCRIPTION_${status.toUpperCase()}`)
    ]);
    return Response.json({status:'ACCEPTED',testMode:event.testMode});
  } catch { return Response.json({error:'Payment event could not be recorded.'},{status:503}); }
}
