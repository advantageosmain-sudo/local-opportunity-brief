import StripeClient from 'stripe';
import {reserveFoundingPlace,releaseUnpaidPlace} from './founding-capacity.mjs';
export const STRIPE_API_VERSION='2026-08-26.dahlia';
export const STRIPE_EVENTS=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed','invoice.payment_action_required']);
export const stripeSchema=[
 "CREATE TABLE IF NOT EXISTS stripe_checkouts (customer_id TEXT NOT NULL,mode TEXT NOT NULL,attempt_id TEXT NOT NULL UNIQUE,request_json TEXT NOT NULL,session_id TEXT UNIQUE,state TEXT NOT NULL DEFAULT 'creating',expires_at TEXT NOT NULL,PRIMARY KEY(customer_id,mode))",
 "CREATE TABLE IF NOT EXISTS stripe_locks (id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL)"
];
export class PaymentError extends Error {constructor(message,status=409){super(message);this.status=status;}}
export function stripeConfig(env,{checkout=false,portal=false}={}) {
 const mode=env.PAYMENTS_MODE,key=env.STRIPE_API_KEY??'';
 if((env.PAYMENTS_PROVIDER??'stripe')!=='stripe'||!['test','live'].includes(mode)) throw new PaymentError('Stripe payments are disabled.',503);
 if(!new RegExp('^(rk|sk)_'+mode+'_').test(key)||!/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_ID??'')||!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new PaymentError('Stripe awaits secure provider configuration.',503);
 if(checkout&&mode==='live'&&(env.LIVE_CHECKOUT_VERIFIED!=='1'||env.PROVIDER_CAPACITY_VERIFIED!=='1')) throw new PaymentError('Live checkout awaits owner-approved provider verification.',503);
 let origin;try{const u=new URL(env.PUBLIC_SITE_URL);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error();origin=u.origin;}catch{throw new PaymentError('The canonical Site URL is not configured.',503);}
 if(portal&&!/^bpc_[A-Za-z0-9]+$/.test(env.STRIPE_PORTAL_CONFIGURATION_ID??'')) throw new PaymentError('Stripe billing management awaits provider configuration.',503);
 return {mode,key,origin,priceId:env.STRIPE_PRICE_ID,webhookSecret:env.STRIPE_WEBHOOK_SECRET,portalConfigurationId:env.STRIPE_PORTAL_CONFIGURATION_ID};
}
export function stripeClient(config){return new StripeClient(config.key,{apiVersion:STRIPE_API_VERSION,httpClient:StripeClient.createFetchHttpClient(),maxNetworkRetries:1,timeout:10000});}
export function providerUrl(value,host){const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)throw new PaymentError('Stripe returned an invalid hosted address.',503);return u.href;}
export async function acquireStripeLock(db,id){
 const token=crypto.randomUUID(),now=Date.now();
 const r=await db.prepare('INSERT INTO stripe_locks(id,token,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE stripe_locks.expires_at<?').bind(id,token,now+120000,now).run();
 if(!r.meta.changes)throw new PaymentError('This payment request is already processing. Retry shortly.',503);
 return {id,token};
}
export async function releaseStripeLock(db,l){await db.prepare('DELETE FROM stripe_locks WHERE id=? AND token=?').bind(l.id,l.token).run();}
export async function assertStripeLock(db,l){if(!await db.prepare('SELECT id FROM stripe_locks WHERE id=? AND token=? AND expires_at>?').bind(l.id,l.token,Date.now()).first())throw new PaymentError('Payment processing lease expired; retry is safe.',503);}
const metadata=(customerId,attemptId)=>({business:'local-opportunity-brief',customer_id:customerId,checkout_attempt:attemptId});
const objectId=v=>typeof v==='string'?v:v?.id;
export async function createStripeCheckout(db,env,customer,{ownerTest=false,client}={}){
 const cfg=stripeConfig(env,{checkout:true}),stripe=client??stripeClient(cfg),profile=JSON.parse(customer.profile_json);
 if(ownerTest?cfg.mode!=='test'||profile.isTest!==true||!customer.id.startsWith('qa-'):cfg.mode!=='live'||profile.isTest===true)throw new PaymentError('Sandbox checkout is restricted to authenticated owner-only test records.',403);
 if(customer.subscription_id||customer.payment_customer_id)throw new PaymentError('This record already has billing history. Use billing management or contact support.');
 if(!ownerTest&&(customer.market_status!=='verified'||customer.onboarding_status!=='complete'||!profile.termsAccepted||!profile.deliveryConsent))throw new PaymentError('Complete intake and local source review before checkout.');
 const lock=await acquireStripeLock(db,'checkout:'+customer.id+':'+cfg.mode);
 try{
  let attempt=await db.prepare('SELECT * FROM stripe_checkouts WHERE customer_id=? AND mode=?').bind(customer.id,cfg.mode).first();
  if(attempt?.session_id){
   const session=await stripe.checkout.sessions.retrieve(attempt.session_id);
   if(session.livemode!==(cfg.mode==='live')||session.client_reference_id!==customer.id)throw new PaymentError('Stored checkout does not match this customer.',503);
   if(session.status==='open')return {url:providerUrl(session.url,'checkout.stripe.com'),mode:cfg.mode,reservationExpiresAt:attempt.expires_at};
   if(session.status==='complete')throw new PaymentError('Checkout was completed. Payment confirmation is processing.');
   if(session.status!=='expired')throw new PaymentError('Checkout status needs provider review.',503);
   await releaseUnpaidPlace(db,customer.id,cfg.mode);
   await db.prepare('DELETE FROM stripe_checkouts WHERE customer_id=? AND mode=? AND attempt_id=?').bind(customer.id,cfg.mode,attempt.attempt_id).run();attempt=null;
  }
  // Retain an ambiguous create and replay identical parameters/idempotency key only before its fixed expiry.
  if(attempt&&Date.parse(attempt.expires_at)<=Date.now())throw new PaymentError('An unconfirmed checkout needs owner reconciliation before another can be created.');
  if(!attempt){
   const p=await stripe.prices.retrieve(cfg.priceId);
   if(p.livemode!==(cfg.mode==='live')||p.active!==true||p.type!=='recurring'||p.currency!=='usd'||p.unit_amount!==4900||p.recurring?.interval!=='month'||p.recurring?.interval_count!==1||p.recurring?.usage_type!=='licensed')throw new PaymentError('Stripe price must match the approved $49 USD monthly founding membership.',503);
   const reservation=await reserveFoundingPlace(db,customer.id,cfg.mode,new Date(),35);
   if(!reservation||reservation.state==='paid')throw new PaymentError('Founding capacity is full or needs reconciliation.');
   const id=crypto.randomUUID(),expiry=new Date(Date.now()+31*60000).toISOString();
   const suffix=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>String.fromCharCode(97+n%26)).join('');
   const route=ownerTest?'dashboard/qa-intake':'intake';
   const params={mode:'subscription',line_items:[{price:cfg.priceId,quantity:1}],client_reference_id:customer.id,metadata:metadata(customer.id,id),subscription_data:{metadata:metadata(customer.id,id),billing_mode:{type:'flexible'}},integration_identifier:'local_opportunity_brief_'+suffix,expires_at:Math.floor(Date.parse(expiry)/1000),success_url:cfg.origin+'/'+route+'?checkout=complete',cancel_url:cfg.origin+'/'+route+'?checkout=canceled'};
   // No capability token or profile PII is sent in metadata; hosted Checkout collects billing details.
   await db.batch([
    db.prepare('INSERT INTO stripe_checkouts(customer_id,mode,attempt_id,request_json,expires_at) VALUES(?,?,?,?,?)').bind(customer.id,cfg.mode,id,JSON.stringify(params),expiry),
    // Stripe holds never expire by our clock: only a confirmed expired Session can free them.
    db.prepare("UPDATE founding_reservations SET expires_at='9999-12-31T23:59:59.999Z' WHERE customer_id=? AND mode=? AND state='reserved'").bind(customer.id,cfg.mode)
   ]);
   attempt={attempt_id:id,request_json:JSON.stringify(params),expires_at:expiry};
  }
  const session=await stripe.checkout.sessions.create(JSON.parse(attempt.request_json),{idempotencyKey:'lob-checkout-'+attempt.attempt_id});
  if(session.livemode!==(cfg.mode==='live')||session.status!=='open'||session.client_reference_id!==customer.id||session.metadata?.checkout_attempt!==attempt.attempt_id)throw new PaymentError('Stripe returned a mismatched checkout session.',503);
  const url=providerUrl(session.url,'checkout.stripe.com');await assertStripeLock(db,lock);
  await db.prepare("UPDATE stripe_checkouts SET session_id=?,state='open' WHERE customer_id=? AND mode=? AND attempt_id=?").bind(session.id,customer.id,cfg.mode,attempt.attempt_id).run();
  return {url,mode:cfg.mode,reservationExpiresAt:attempt.expires_at};
 }finally{await releaseStripeLock(db,lock);}
}
export async function createStripePortal(env,customer,{ownerTest=false,client}={}){
 const cfg=stripeConfig(env,{portal:true}),profile=JSON.parse(customer.profile_json);
 if(ownerTest?cfg.mode!=='test'||profile.isTest!==true:cfg.mode!=='live'||profile.isTest===true)throw new PaymentError('Billing mode does not match this customer.',403);
 if(!/^cus_[A-Za-z0-9]+$/.test(customer.payment_customer_id??'')||!/^sub_[A-Za-z0-9]+$/.test(customer.subscription_id??''))throw new PaymentError('No confirmed Stripe billing record is available yet.');
 const stripe=client??stripeClient(cfg),sub=await stripe.subscriptions.retrieve(customer.subscription_id);
 if(sub.livemode!==(cfg.mode==='live')||objectId(sub.customer)!==customer.payment_customer_id||sub.metadata?.customer_id!==customer.id||sub.metadata?.business!=='local-opportunity-brief')throw new PaymentError('Billing record mismatch.',403);
 const session=await stripe.billingPortal.sessions.create({customer:customer.payment_customer_id,configuration:cfg.portalConfigurationId,return_url:cfg.origin+'/'+(ownerTest?'dashboard/qa-intake':'intake')});
 return {url:providerUrl(session.url,'billing.stripe.com'),mode:cfg.mode};
}
export async function verifyStripeEvent(raw,signature,cfg,client=stripeClient(cfg)){
 const event=await client.webhooks.constructEventAsync(raw,signature,cfg.webhookSecret,300,StripeClient.createSubtleCryptoProvider());
 if(event.livemode!==(cfg.mode==='live'))throw new PaymentError('Payment mode mismatch.',400);
 return event;
}
export function subscriptionMatchesOffer(sub,cfg){
 const items=sub.items?.data;
 return Array.isArray(items)&&items.length===1&&objectId(items[0].price)===cfg.priceId&&items[0].quantity===1;
}
export function subscriptionPaymentStatus(sub,cfg){
 if(sub.livemode!==(cfg.mode==='live'))throw new PaymentError('Subscription mode mismatch.');
 // Revocation must still apply after a provider-side product/quantity change.
 if(sub.status==='canceled')return 'canceled';
 if(sub.status==='incomplete_expired')return 'expired';
 if(!subscriptionMatchesOffer(sub,cfg))return 'unpaid';
 if(sub.status==='past_due')return 'past_due';
 if(sub.pause_collection||sub.status!=='active'||sub.latest_invoice?.status!=='paid')return 'unpaid';
 return 'active'; // cancel_at_period_end keeps access through the paid period.
}
export async function processStripeEvent(db,env,event,{client}={}){
 const cfg=stripeConfig(env),stripe=client??stripeClient(cfg),provider=cfg.mode==='test'?'stripe_test':'stripe';
 if(!STRIPE_EVENTS.has(event.type))return {status:'IGNORED_UNSUPPORTED'};
 if(event.livemode!==(cfg.mode==='live'))throw new PaymentError('Payment mode mismatch.',400);
 if(await db.prepare('SELECT id FROM payment_events WHERE provider=? AND external_id=?').bind(provider,event.id).first())return {status:'DUPLICATE_IGNORED'};
 const object=event.data.object;let session=null,subscriptionId;
 if(event.type.startsWith('checkout.session.')){
  session=await stripe.checkout.sessions.retrieve(object.id);
  if(session.livemode!==(cfg.mode==='live')||session.mode!=='subscription')throw new PaymentError('Checkout mode mismatch.');
  subscriptionId=objectId(session.subscription);
 }else if(event.type.startsWith('customer.subscription.'))subscriptionId=object.id;
 else subscriptionId=objectId(object.parent?.subscription_details?.subscription??object.subscription);
 if(!subscriptionId){
  if(session?.status==='expired' && session.metadata?.business==='local-opportunity-brief'){
   const customerId=session.client_reference_id,attemptId=session.metadata?.checkout_attempt;
   const expiryLock=await acquireStripeLock(db,'checkout:'+customerId+':'+cfg.mode);
   try {
    const a=await db.prepare('SELECT * FROM stripe_checkouts WHERE customer_id=? AND mode=? AND attempt_id=?').bind(customerId,cfg.mode,attemptId??'').first();
    if(a && (!a.session_id || a.session_id===session.id)) {
     await assertStripeLock(db,expiryLock);
     await db.batch([
      db.prepare("UPDATE stripe_checkouts SET state='expired',session_id=COALESCE(session_id,?) WHERE customer_id=? AND mode=? AND attempt_id=?").bind(session.id,customerId,cfg.mode,attemptId),
      db.prepare("UPDATE founding_reservations SET state='released',expires_at='1970-01-01T00:00:00.000Z' WHERE customer_id=? AND mode=? AND state NOT IN ('paid','pending') AND EXISTS(SELECT 1 FROM stripe_checkouts WHERE customer_id=? AND mode=? AND attempt_id=? AND state='expired')").bind(customerId,cfg.mode,customerId,cfg.mode,attemptId)
     ]);
    }
   } finally {await releaseStripeLock(db,expiryLock);}
  }
  return {status:'NO_SUBSCRIPTION'};
 }
 const lock=await acquireStripeLock(db,'subscription:'+subscriptionId);
 try{
  if(await db.prepare('SELECT id FROM payment_events WHERE provider=? AND external_id=?').bind(provider,event.id).first())return {status:'DUPLICATE_IGNORED'};
  // Retrieve current Stripe state under a per-subscription lease. Event timestamps are NOT ordering keys.
  const sub=await stripe.subscriptions.retrieve(subscriptionId,{expand:['latest_invoice']}),meta=sub.metadata??{},id=meta.customer_id;
  if(meta.business!=='local-opportunity-brief'||!id||!meta.checkout_attempt)throw new PaymentError('Unrecognized subscription metadata.');
  const c=await db.prepare('SELECT * FROM customers WHERE id=?').bind(id).first();
  const a=await db.prepare('SELECT * FROM stripe_checkouts WHERE customer_id=? AND mode=? AND attempt_id=?').bind(id,cfg.mode,meta.checkout_attempt).first();
  const profile=c?JSON.parse(c.profile_json):{};
  if(!c||!a||(cfg.mode==='test')!==Boolean(profile.isTest)||(c.subscription_id&&c.subscription_id!==sub.id)||(c.payment_customer_id&&c.payment_customer_id!==objectId(sub.customer)))throw new PaymentError('Subscription cannot be bound to this customer.');
  if(session&&(session.client_reference_id!==c.id||session.metadata?.checkout_attempt!==a.attempt_id||objectId(session.customer)!==objectId(sub.customer)||(a.session_id&&a.session_id!==session.id)))throw new PaymentError('Checkout identity mismatch.');
  const state=subscriptionPaymentStatus(sub,cfg),paymentStatus=(cfg.mode==='test'?'test_':'')+state,at=new Date().toISOString();
  // A completed asynchronous session holds the place even while unpaid. Failure needs owner review; no auto-release.
  const allocate=true; // A bound subscription owns a pending hold before payment completes.
  const cancellationRequested=sub.cancel_at_period_end===true || (Number.isFinite(sub.cancel_at)&&sub.cancel_at>0);
  const summary={id:event.id,type:event.type,subscriptionId:sub.id,customerId:c.id,status:paymentStatus,cancelAtPeriodEnd:sub.cancel_at_period_end===true};
  await assertStripeLock(db,lock);
  await db.batch([
   db.prepare("INSERT INTO diagnostics(id,system,subject_id,code,detail_json) SELECT ?,'payments',?,'EXPIRED_RESERVATION_PAYMENT_REVIEW_REQUIRED',? WHERE ?=1 AND EXISTS(SELECT 1 FROM founding_reservations WHERE customer_id=? AND mode=? AND state NOT IN ('paid','pending') AND (state!='reserved' OR expires_at<?)) ON CONFLICT(id) DO UPDATE SET status='open',updated_at=CURRENT_TIMESTAMP").bind('capacity-'+c.id,c.id,JSON.stringify({mode:cfg.mode}),allocate?1:0,c.id,cfg.mode,at),
   db.prepare("INSERT INTO diagnostics(id,system,subject_id,code,detail_json) SELECT ?,'payments',?,'UNRESERVED_PAYMENT_REVIEW_REQUIRED',? WHERE ?=1 AND NOT EXISTS(SELECT 1 FROM founding_reservations WHERE customer_id=? AND mode=?) ON CONFLICT(id) DO UPDATE SET status='open',updated_at=CURRENT_TIMESTAMP").bind('capacity-'+c.id,c.id,JSON.stringify({mode:cfg.mode}),allocate?1:0,c.id,cfg.mode),
   db.prepare("UPDATE founding_reservations SET state=CASE WHEN state='paid' OR ?='active' THEN 'paid' ELSE 'pending' END WHERE customer_id=? AND mode=?").bind(state,c.id,cfg.mode),
   db.prepare("UPDATE customers SET subscription_id=?,payment_customer_id=?,payment_status=?,payment_updated_at=?,status=CASE WHEN ?=1 THEN 'test' WHEN status IN ('paused','canceled') THEN status WHEN ?=1 THEN 'canceled' WHEN ?='active' AND onboarding_status='complete' THEN 'active' ELSE 'blocked' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sub.id,objectId(sub.customer),paymentStatus,at,profile.isTest?1:0,cancellationRequested?1:0,state,c.id),
   db.prepare("UPDATE stripe_checkouts SET state='complete',session_id=COALESCE(session_id,?) WHERE customer_id=? AND mode=? AND attempt_id=?").bind(session?.id??null,c.id,cfg.mode,a.attempt_id),
   db.prepare('INSERT INTO payment_events(id,provider,event_name,external_id,payload_json) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),provider,event.type,event.id,JSON.stringify(summary)),
   db.prepare("INSERT INTO diagnostics(id,system,subject_id,code) VALUES(?,'payments',?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,status='open',updated_at=CURRENT_TIMESTAMP").bind('payment-'+c.id,c.id,!subscriptionMatchesOffer(sub,cfg)?'STRIPE_SUBSCRIPTION_CONFIGURATION_REVIEW_REQUIRED':cancellationRequested?'SUBSCRIPTION_CANCELLATION_RECORDED':state==='active'?(cfg.mode==='test'?'SANDBOX_PAYMENT_CONFIRMED':'FIRST_REPORT_REVIEW_REQUIRED'):'SUBSCRIPTION_'+paymentStatus.toUpperCase())
  ]);
  return {status:'ACCEPTED',testMode:cfg.mode==='test'};
 }finally{await releaseStripeLock(db,lock);}
}

