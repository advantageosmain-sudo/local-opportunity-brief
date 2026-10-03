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
const snapshotColumns={attempt:attemptColumns,customerBefore:customerColumns,reservationBefore:reservationColumns};
const nullableColumns={attempt:['session_id'],customerBefore:['lead_id','payment_customer_id','subscription_id','first_delivered_at','payment_updated_at'],reservationBefore:[]};
function completeSnapshots(detail) {
 return Object.entries(snapshotColumns).every(([name,columns])=>{
  const row=detail?.[name];
  return row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===columns.length&&columns.every(column=>
   Object.hasOwn(row,column)&&(name==='customerBefore'&&column==='require_every_review'?Number.isInteger(row[column]):
    typeof row[column]==='string'||(row[column]===null&&nullableColumns[name].includes(column))));
 });
}
// Version 2 hashes all snapshot fields in fixed object/key order, including the
// exact profile/request JSON strings. This detects snapshot inconsistency; it
// is not authenticity proof against a writer who can replace both data and hash.
const snapshotDigest=detail=>sha256(JSON.stringify(Object.fromEntries(Object.entries(snapshotColumns).map(([name,columns])=>
 [name,Object.fromEntries([...columns].sort().map(column=>[column,detail[name][column]]))]))));

async function validArchive(detail) {
 if(detail?.version!==2||!completeSnapshots(detail)||!/^[a-f0-9]{64}$/.test(detail.snapshotSha256??'')||await snapshotDigest(detail)!==detail.snapshotSha256)return false;
 const a=detail.attempt,c=detail.customerBefore,r=detail.reservationBefore,e=detail.providerEvidence,check=e?.sessionCheck;
 if(a.customer_id!==REJECTED_CHECKOUT.customerId||a.mode!=='test'||a.attempt_id!==REJECTED_CHECKOUT.attemptId||a.state!=='creating'||a.session_id!==null||a.expires_at!==REJECTED_CHECKOUT.expiresAt||typeof a.request_json!=='string'||await sha256(a.request_json)!==REJECTED_CHECKOUT.requestSha256)return false;
 let profile;try{profile=JSON.parse(c.profile_json);}catch{return false;}
 if(c.id!==a.customer_id||c.status!=='test'||c.payment_status!=='test_qa'||c.subscription_id!==null||c.payment_customer_id!==null||profile?.isTest!==true||profile.deliveryConsent===true)return false;
 if(r.customer_id!==a.customer_id||r.mode!=='test'||r.state!=='reserved'||r.expires_at!=='9999-12-31T23:59:59.999Z'||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))return false;
 if(e?.accountId!==REJECTED_CHECKOUT.accountId||e.accountBinding!=='pinned_sandbox_price_same_client'||e.priceId!==REJECTED_CHECKOUT.priceId||e.livemode!==false||e.requestId!==REJECTED_CHECKOUT.requestId||e.requestTime!==REJECTED_CHECKOUT.requestTime||e.httpStatus!==403||e.errorCode!=='more_permissions_required'||e.idempotencyKey!=='lob-checkout-'+a.attempt_id)return false;
 return check?.complete===true&&check.matchingSessions===0&&Number.isInteger(check.pages)&&check.pages>=1&&check.pages<=20&&Number.isInteger(check.sessionsInspected)&&check.sessionsInspected>=check.pages-1&&check.sessionsInspected<=check.pages*100&&typeof check.checkedAt==='string'&&Number.isFinite(Date.parse(check.checkedAt))&&Date.parse(check.checkedAt)>=Date.parse(a.expires_at)&&Date.parse(check.checkedAt)<=Date.now();
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
   // Never backfill a seal from today's legacy bytes or compare them with newer
   // live rows: neither can establish the original snapshot's complete integrity.
   if(detail?.version===1)throw new PaymentError('The historical recovery archive has no full-snapshot integrity checksum and needs review. No recovery record or checkout was changed.',409,'ARCHIVE_INTEGRITY_UNVERIFIED');
   if(!await validArchive(detail))fail();
   // An existing archive must never authorize removal of a restored or newer row.
   const remaining=await db.prepare('SELECT attempt_id FROM stripe_checkouts WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
   if(remaining?.attempt_id===attemptId)fail();
   return {status:'already_recovered',attemptId};
  }
  const attempt=await db.prepare('SELECT * FROM stripe_checkouts WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
  const customer=await db.prepare('SELECT * FROM customers WHERE id=?').bind(customerId).first();
  const reservation=await db.prepare('SELECT * FROM founding_reservations WHERE customer_id=? AND mode=?').bind(customerId,'test').first();
  if(!completeSnapshots({attempt,customerBefore:customer,reservationBefore:reservation}))fail();
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
  const snapshots={attempt,customerBefore:customer,reservationBefore:reservation};
  const detail=JSON.stringify({version:2,...snapshots,snapshotSha256:await snapshotDigest(snapshots),providerEvidence:evidence});
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
