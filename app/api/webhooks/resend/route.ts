import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {applyEmailReceipt,receiptRanks} from '@/lib/email-receipts';
import {readBoundedBody,sha256,verifyResendSignature} from '@/lib/resend-signature';
export async function POST(request:Request){
 const env=getRuntimeEnv();
 if(env.RESEND_WEBHOOK_ENABLED!=='1'||!env.RESEND_WEBHOOK_SECRET)return Response.json({error:'Webhook unavailable'},{status:503});
 let raw,eventId;
 try{raw=await readBoundedBody(request);eventId=await verifyResendSignature(raw,request.headers,env.RESEND_WEBHOOK_SECRET);}catch{return Response.json({error:'Invalid webhook'},{status:400});}
 let value;try{value=JSON.parse(raw);}catch{return Response.json({error:'Invalid webhook'},{status:400});}
 const event=typeof value?.type==='string'?value.type.replace(/^email\./,''):'';
 if(typeof value?.type!=='string'||!value.type.startsWith('email.')||!Object.hasOwn(receiptRanks,event))return Response.json({status:'ignored'});
 const id=value?.data?.email_id,to=value?.data?.to,at=value?.created_at;
 if(Array.isArray(to)&&to.length>1)return Response.json({status:'ignored'}); // This app only sends single-recipient mail.
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!Array.isArray(to)||to.length!==1||typeof to[0]!=='string'||to[0].length>320||!/^\S+@\S+\.\S+$/.test(to[0])||typeof at!=='string'||at.length>32||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+300000)return Response.json({error:'Invalid receipt identity'},{status:400});
 try{
  const db=await ensureDatabase();
  const result=await applyEmailReceipt(db,{eventId:'svix:'+eventId,providerId:id,recipient:to[0],event,eventTime:Date.parse(at),payloadHash:await sha256(raw),source:'resend_signed_webhook'});
  if(result.status==='unmatched'){
   // Account-wide unrelated messages must not exhaust provider retry budgets.
   // Retry only a short local acceptance race, without adopting the provider ID.
   const pending=await db.prepare(`SELECT a.id FROM delivery_attempts a JOIN reports r ON r.id=a.report_id
    WHERE a.recipient=? AND a.status='claimed' AND a.provider_message_id IS NULL
    AND julianday(a.created_at)>=julianday('now','-5 minutes')
    AND json_valid(r.report_json) AND json_extract(r.report_json,'$.report.checksum')=a.checksum
    AND json_extract(r.report_json,'$.report.reportId')=a.report_id
    AND json_extract(r.report_json,'$.report.customer.slug')=r.customer_slug
    AND json_extract(r.report_json,'$.report.customer.deliveryMode') IN ('owner_review_only','customer')
    AND r.customer_slug NOT LIKE 'qa-%' AND COALESCE(json_extract(r.report_json,'$.report.customer.isTest'),0)=0
    AND NOT EXISTS(SELECT 1 FROM customers q WHERE q.id=r.customer_slug AND (q.status='test' OR q.payment_status LIKE 'test_%' OR CASE WHEN json_valid(q.profile_json) THEN COALESCE(json_extract(q.profile_json,'$.isTest'),0) ELSE 1 END=1))
    AND json_extract(r.report_json,'$.report.fixture')=0 LIMIT 1`).bind(to[0]).first();
   return Response.json({status:pending?'awaiting_acceptance':'ignored'},{status:pending?409:200});
  }
  return Response.json(result,{status:result.status==='conflict'||result.status==='invalid_time'?409:200});
 }catch{return Response.json({error:'Receipt storage unavailable'},{status:503});}
}
