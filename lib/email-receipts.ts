import type {D1Database} from '@/types/cloudflare-d1';
export const receiptRanks:Record<string,number>={sent:1,scheduled:1,delivery_delayed:1,delivered:2,opened:2,clicked:2,bounced:3,complained:3,failed:3,suppressed:3};
export type ReceiptInput={eventId:string;providerId:string;recipient:string;event:string;eventTime:number;payloadHash:string;source:'resend_signed_webhook'|'external_owner_verified';actor?:string;evidenceRef?:string;reportId?:string;checksum?:string};
const identitySql=`FROM delivery_attempts a JOIN reports r ON r.id=a.report_id
 WHERE a.provider_message_id=? AND a.recipient=?
 AND (SELECT COUNT(*) FROM delivery_attempts unique_attempt WHERE unique_attempt.provider_message_id=a.provider_message_id)=1 AND a.status IN ('accepted','delivered','failed')
 AND json_valid(r.report_json) AND json_extract(r.report_json,'$.report.reportId')=a.report_id
 AND json_extract(r.report_json,'$.report.checksum')=a.checksum
 AND json_extract(r.report_json,'$.report.fixture')=0
 AND json_extract(r.report_json,'$.report.customer.slug')=r.customer_slug
 AND json_extract(r.report_json,'$.report.customer.deliveryMode') IN ('owner_review_only','customer')
 AND r.customer_slug NOT LIKE 'qa-%'
 AND NOT EXISTS(SELECT 1 FROM customers q WHERE q.id=r.customer_slug AND
   (q.status='test' OR q.payment_status LIKE 'test_%' OR CASE WHEN json_valid(q.profile_json) THEN COALESCE(json_extract(q.profile_json,'$.isTest'),0) ELSE 1 END=1))
 AND COALESCE(json_extract(r.report_json,'$.report.customer.isTest'),0)=0
 AND (?='' OR (a.report_id=? AND a.checksum=? AND json_extract(r.report_json,'$.report.customer.deliveryMode')='owner_review_only'
   AND EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=a.report_id AND d.checksum=a.checksum AND d.decision='approve')))`;
export async function applyEmailReceipt(db:D1Database,input:ReceiptInput){
 const identityArgs=[input.providerId,input.recipient,input.reportId??'',input.reportId??'',input.checksum??''];
 const matches=(await db.prepare(`SELECT a.* ${identitySql} LIMIT 2`).bind(...identityArgs).all()).results as Record<string,string>[];
 // Do not adopt unknown sends, match by recipient alone, or resolve uncertain send locks.
 if(matches.length!==1)return {status:'unmatched'};
 const row=matches[0];
 if(input.eventTime<Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(row.created_at)?row.created_at:row.created_at.replace(' ','T')+'Z')-300000)return {status:'invalid_time'};
 const existing=await db.prepare('SELECT payload_hash FROM email_receipt_events WHERE event_id=?').bind(input.eventId).first<{payload_hash:string}>();
 if(existing)return {status:existing.payload_hash===input.payloadHash?'duplicate':'conflict'};
 const rank=receiptRanks[input.event];if(!rank)throw new Error('Unsupported event');
 const token=crypto.randomUUID(),now=new Date().toISOString();
 const effect=`EXISTS(SELECT 1 FROM email_receipt_events e JOIN email_receipt_state s ON s.event_id=e.event_id AND s.attempt_id=e.attempt_id WHERE e.process_token=? AND e.attempt_id=delivery_attempts.id)`;
 const selected=`SELECT e.report_id FROM email_receipt_events e JOIN email_receipt_state s ON s.event_id=e.event_id AND s.attempt_id=e.attempt_id JOIN delivery_attempts a ON a.id=e.attempt_id WHERE e.process_token=? AND a.status='delivered'`;
 // Only real customers with current consent/eligibility can acquire customer history.
 const customer=`id IN (SELECT r.customer_slug FROM reports r WHERE r.id IN (${selected}) AND json_extract(r.report_json,'$.report.customer.deliveryMode')='customer')
 AND email=? AND status='active' AND payment_status='active' AND onboarding_status='complete' AND delivery_status!='suppressed'
 AND json_valid(profile_json) AND json_extract(profile_json,'$.deliveryConsent')=1 AND COALESCE(json_extract(profile_json,'$.isTest'),0)=0`;
 const statements=[
  db.prepare(`INSERT OR IGNORE INTO email_receipt_events(event_id,attempt_id,report_id,checksum,provider_message_id,recipient,source,event_type,event_time,rank,payload_hash,actor,evidence_ref,process_token)
   SELECT ?,a.id,a.report_id,a.checksum,a.provider_message_id,a.recipient,?,?,?,?,?,?,?,? ${identitySql}`).bind(input.eventId,input.source,input.event,input.eventTime,rank,input.payloadHash,input.actor??'',input.evidenceRef??'',token,...identityArgs),
  db.prepare(`INSERT INTO email_receipt_state(attempt_id,event_id,event_time,rank)
   SELECT attempt_id,event_id,event_time,rank FROM email_receipt_events WHERE process_token=?
   ON CONFLICT(attempt_id) DO UPDATE SET event_id=excluded.event_id,event_time=excluded.event_time,rank=excluded.rank
   WHERE excluded.rank>email_receipt_state.rank OR (excluded.rank=email_receipt_state.rank AND (excluded.event_time>email_receipt_state.event_time OR (excluded.event_time=email_receipt_state.event_time AND excluded.event_id>email_receipt_state.event_id)))`).bind(token),
  db.prepare(`UPDATE email_receipt_events SET applied=1 WHERE process_token=? AND EXISTS(SELECT 1 FROM email_receipt_state s WHERE s.event_id=email_receipt_events.event_id)`).bind(token),
 ];
 if(rank>=2){
  statements.push(db.prepare(`UPDATE delivery_attempts SET status=?,updated_at=? WHERE ${effect} AND (?=3 OR status!='failed')`).bind(rank===3?'failed':'delivered',now,token,rank));
 }
 if(rank===2){
  statements.push(db.prepare(`UPDATE reports SET status='delivered',delivered_at=COALESCE(delivered_at,?) WHERE id IN (${selected})`).bind(now,token));
  // Manual historical receipts are deliberately owner-only and never create customer eligibility.
  if(input.source==='resend_signed_webhook'){
   statements.push(db.prepare(`UPDATE customers SET first_delivered_at=COALESCE(first_delivered_at,?) WHERE ${customer}`).bind(now,token,input.recipient));
   statements.push(db.prepare(`UPDATE markets SET first_approved_at=COALESCE(first_approved_at,?) WHERE id IN (SELECT market_id FROM customers WHERE ${customer})`).bind(now,token,input.recipient));
  }
 }else if(rank===3){
  statements.push(db.prepare(`INSERT OR REPLACE INTO diagnostics(id,system,subject_id,code) SELECT 'delivery-'||e.report_id,'email',e.report_id,'PROVIDER_DELIVERY_FAILED' FROM email_receipt_events e JOIN email_receipt_state s ON s.event_id=e.event_id WHERE e.process_token=?`).bind(token));
  statements.push(db.prepare(`UPDATE customers SET delivery_status='suppressed' WHERE email=? AND id IN (SELECT r.customer_slug FROM reports r JOIN email_receipt_events e ON e.report_id=r.id JOIN email_receipt_state s ON s.event_id=e.event_id WHERE e.process_token=? AND json_extract(r.report_json,'$.report.customer.deliveryMode')='customer')`).bind(input.recipient,token));
 }
 // D1 batch is transactional. A later failure rolls back event dedupe as well as effects.
 await db.batch(statements);
 const recorded=await db.prepare('SELECT payload_hash,applied FROM email_receipt_events WHERE event_id=?').bind(input.eventId).first<{payload_hash:string;applied:number}>();
 if(!recorded)return {status:'unmatched'};
 if(recorded.payload_hash!==input.payloadHash)return {status:'conflict'};
 const durable=await db.prepare('SELECT status FROM delivery_attempts WHERE id=?').bind(row.id).first<{status:string}>();
 return {status:'recorded',applied:Boolean(recorded.applied),deliveryStatus:durable?.status,source:input.source};
}
