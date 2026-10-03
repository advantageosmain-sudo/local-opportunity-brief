import {PaymentError,stripeConfig,stripeClient,acquireStripeLock,assertStripeLock,releaseStripeLock} from './stripe-payments.mjs';

// One reviewed provider rejection, not a general-purpose expired-attempt reset.
export const REJECTED_CHECKOUT=Object.freeze({
 customerId:'qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496',
 attemptId:'71bb3487-c303-4a48-bc7f-9ea91a2f6488',
 accountId:'acct_1UM6eqHIBIrkXtd8',
 priceId:'price_1UM6uAHIBIrkXtd8i8lxXqUX',
 requestId:'req_QmXs0F8hnYQVUU',
 requestTime:'2026-10-02T20:27:59Z',
 expiresAt:'2026-10-02T20:58:59.452Z',
 requestSha256:'4632c00240c7db16af55c70f9fcbc6df54ff0def87b536668558c9fa59bde921',
 origin:'https://local-opportunity-brief.mshipe2022.chatgpt.site',
});
const auditId='stripe-checkout-recovery-'+REJECTED_CHECKOUT.attemptId;
const auditType='stripe_test_rejected_checkout_retired';
const customerColumns=['id','lead_id','email','business_name','profile_json','market_id','payment_customer_id','subscription_id','payment_status','onboarding_status','status','delivery_status','require_every_review','first_delivered_at','payment_updated_at','created_at','updated_at'];
const reservationColumns=['customer_id','mode','state','expires_at','created_at'];
const attemptColumns=['customer_id','mode','attempt_id','request_json','session_id','state','expires_at'];
const fail=()=>{throw new PaymentError('This test checkout needs review; no attempt was removed.');};
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const snapshot=(row,columns,nullable=[],integers=[])=>record(row)&&columns.every(column=>Object.hasOwn(row,column)&&(integers.includes(column)?Number.isSafeInteger(row[column]):typeof row[column]==='string'||(nullable.includes(column)&&row[column]===null)));

async function validateRecoveryArchive(detail) {
 const attempt=detail?.attempt,customer=detail?.customerBefore,reservation=detail?.reservationBefore,evidence=detail?.providerEvidence,check=evidence?.sessionCheck;
 if(!record(detail)||detail.version!==1||!snapshot(attempt,attemptColumns,['session_id'])||!snapshot(customer,customerColumns,['lead_id','payment_customer_id','subscription_id','first_delivered_at','payment_updated_at'],['require_every_review'])||!snapshot(reservation,reservationColumns)||!record(evidence)||!record(check))fail();
 if(attempt.customer_id!==REJECTED_CHECKOUT.customerId||attempt.mode!=='test'||attempt.attempt_id!==REJECTED_CHECKOUT.attemptId||attempt.state!=='creating'||attempt.session_id!==null||attempt.expires_at!==REJECTED_CHECKOUT.expiresAt||await sha256(attempt.request_json)!==REJECTED_CHECKOUT.requestSha256)fail();
 let profile;try{profile=JSON.parse(customer.profile_json);}catch{fail();}
 if(!record(profile)||customer.id!==REJECTED_CHECKOUT.customerId||profile.isTest!==true||profile.deliveryConsent===true||customer.status!=='test'||customer.payment_status!=='test_qa'||customer.subscription_id!==null||customer.payment_customer_id!==null)fail();
 if(reservation.customer_id!==REJECTED_CHECKOUT.customerId||reservation.mode!=='test'||reservation.state!=='reserved'||reservation.expires_at!=='9999-12-31T23:59:59.999Z')fail();
 if(evidence.accountId!==REJECTED_CHECKOUT.accountId||evidence.accountBinding!=='pinned_sandbox_price_same_client'||evidence.priceId!==REJECTED_CHECKOUT.priceId||evidence.livemode!==false||evidence.requestId!==REJECTED_CHECKOUT.requestId||evidence.requestTime!==REJECTED_CHECKOUT.requestTime||evidence.httpStatus!==403||evidence.errorCode!=='more_permissions_required'||evidence.idempotencyKey!=='lob-checkout-'+REJECTED_CHECKOUT.attemptId)fail();
 if(check.complete!==true||check.matchingSessions!==0||!Number.isInteger(check.pages)||check.pages<1||check.pages>20||!Number.isInteger(check.sessionsInspected)||check.sessionsInspected<check.pages-1||check.sessionsInspected>check.pages*100||typeof check.checkedAt!=='string'||!Number.isFinite(Date.parse(check.checkedAt))||Date.parse(check.checkedAt)<Date.parse(attempt.expires_at)||Date.parse(check.checkedAt)>Date.now())fail();
}

export async function recoverRejectedCheckout(db,env,{customerId,attemptId,actorEmail},{client}={}) {
 const cfg=stripeConfig(env);
 if(cfg.mode!=='test'||cfg.origin!==REJECTED_CHECKOUT.origin||cfg.priceId!==REJECTED_CHECKOUT.priceId||env.LIVE_DELIVERY==='1')fail();
 if(customerId!==REJECTED_CHECKOUT.customerId||attemptId!==REJECTED_CHECKOUT.attemptId||!actorEmail||actorEmail.toLowerCase()!==env.OWNER_EMAIL?.toLowerCase())fail();
 const lock=await acquireStripeLock(db,'checkout:'+customerId+':test');
 try {
  const previous=await db.prepare('SELECT * FROM audit_events WHERE id=?').bind(auditId).first();
  if(previous) {
   let detail;try{detail=JSON.parse(previous.detail_json);}catch{fail();}
   if(previous.event_type!==auditType||previous.subject_id!==customerId)fail();
   // Replay proves the retained retirement evidence, independent of later billing.
   await validateRecoveryArchive(detail);
   // An existing archive must never authorize removal of a restored or newer row.
   const remaining=await db.prepare('SELECT attempt_id FROM stripe_checkouts WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
   if(remaining?.attempt_id===attemptId)fail();
   return {status:'already_recovered',attemptId};
  }
  const attempt=await db.prepare('SELECT * FROM stripe_checkouts WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
  const customer=await db.prepare('SELECT * FROM customers WHERE id=?').bind(customerId).first();
  const reservation=await db.prepare('SELECT * FROM founding_reservations WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
  if(!attempt||attempt.attempt_id!==attemptId||attempt.state!=='creating'||attempt.session_id!==null||attempt.expires_at!==REJECTED_CHECKOUT.expiresAt||Date.parse(attempt.expires_at)>=Date.now()||await sha256(attempt.request_json)!==REJECTED_CHECKOUT.requestSha256)fail();
  let profile;try{profile=JSON.parse(customer?.profile_json);}catch{fail();}
  if(!customer||profile?.isTest!==true||profile.deliveryConsent===true||customer.status!=='test'||customer.payment_status!=='test_qa'||customer.subscription_id!==null||customer.payment_customer_id!==null)fail();
  if(!reservation||reservation.state!=='reserved'||reservation.expires_at!=='9999-12-31T23:59:59.999Z')fail();
  const stripe=client??stripeClient(cfg);
  // This immutable Price is independently verified in the approved sandbox.
  // Same client for both reads: no Connect override or new account-read scope.
  const price=await stripe.prices.retrieve(REJECTED_CHECKOUT.priceId);
  if(price.id!==REJECTED_CHECKOUT.priceId||price.livemode!==false||price.active!==true||price.type!=='recurring'||price.currency!=='usd'||price.unit_amount!==4900||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.recurring?.usage_type!=='licensed')fail();
  const seen=new Set();let cursor;let pages=0;let complete=false;
  while(pages<20) {
   await assertStripeLock(db,lock);
   const page=await stripe.checkout.sessions.list({limit:100,...(cursor?{starting_after:cursor}:{})});
   pages++;
   if(page?.object!=='list'||!Array.isArray(page.data)||typeof page.has_more!=='boolean'||page.data.length>100)fail();
   for(const session of page.data) {
    if(!session||session.object!=='checkout.session'||typeof session.id!=='string'||!session.id.startsWith('cs_test_')||session.livemode!==false||seen.has(session.id)||!['open','complete','expired'].includes(session.status))fail();
    if(!Object.hasOwn(session,'client_reference_id')||(session.client_reference_id!==null&&typeof session.client_reference_id!=='string'))fail();
    if(!Object.hasOwn(session,'metadata')||(session.metadata!==null&&(typeof session.metadata!=='object'||Array.isArray(session.metadata)||!Object.values(session.metadata).every(v=>typeof v==='string'))))fail();
    seen.add(session.id);
    if(session.client_reference_id===customerId||session.metadata?.customer_id===customerId||session.metadata?.checkout_attempt===attemptId)fail();
   }
   if(page.has_more===false){complete=true;break;}
   if(!page.data.length)fail();
   cursor=page.data.at(-1).id;
  }
  if(!complete)fail();
  await assertStripeLock(db,lock);
  const evidence={accountId:REJECTED_CHECKOUT.accountId,accountBinding:'pinned_sandbox_price_same_client',priceId:price.id,livemode:false,requestId:REJECTED_CHECKOUT.requestId,requestTime:REJECTED_CHECKOUT.requestTime,httpStatus:403,errorCode:'more_permissions_required',idempotencyKey:'lob-checkout-'+attemptId,sessionCheck:{checkedAt:new Date().toISOString(),pages,sessionsInspected:seen.size,complete:true,matchingSessions:0}};
  const detail=JSON.stringify({version:1,attempt,customerBefore:customer,reservationBefore:reservation,providerEvidence:evidence});
  // The shared checkout lease does not exclude subscription webhooks. Guard
  // every original customer/reservation/attempt field again inside the batch.
  const exact=(alias,columns)=>columns.map(c=>`${alias}.${c} IS ?`).join(' AND ');
  const predicate=`${exact('a',attemptColumns)} AND EXISTS(SELECT 1 FROM customers c WHERE ${exact('c',customerColumns)}) AND EXISTS(SELECT 1 FROM founding_reservations f WHERE ${exact('f',reservationColumns)}) AND EXISTS(SELECT 1 FROM stripe_locks l WHERE l.id=? AND l.token=? AND l.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000+1000)`;
  const values=[...attemptColumns.map(c=>attempt[c]),...customerColumns.map(c=>customer[c]),...reservationColumns.map(c=>reservation[c]),lock.id,lock.token];
  await db.batch([
   db.prepare(`INSERT INTO audit_events(id,event_type,subject_id,actor_email,detail_json) SELECT ?,?,?,?,? FROM stripe_checkouts a WHERE ${predicate}`).bind(auditId,auditType,customerId,actorEmail,detail,...values),
   db.prepare(`DELETE FROM stripe_checkouts AS a WHERE ${predicate} AND changes()=1 AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND event_type=? AND subject_id=? AND detail_json=?)`).bind(...values,auditId,auditType,customerId,detail),
   // Abort and roll back the whole transaction if either guarded write missed.
   db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('checkout recovery guard failed') END")
  ]);
  return {status:'recovered',attemptId};
 } finally {await releaseStripeLock(db,lock);}
}
