// Synthetic Stripe SDK boundary + transactional SQLite. No provider network, keys or charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {stripeSchema,stripeConfig,createStripeCheckout,createStripePortal,processStripeEvent,verifyStripeEvent,subscriptionPaymentStatus,acquireStripeLock,releaseStripeLock} from '../lib/stripe-payments.mjs';
import {foundingSchema} from '../lib/founding-capacity.mjs';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.beforeRun=null;}
 prepare(sql){let args=[];const run=()=>{this.beforeRun?.(sql);const r=this.db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};};const q={bind(...v){args=v;return q;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}
 async batch(stmts){this.db.exec('BEGIN');try{const r=stmts.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const env={PAYMENTS_PROVIDER:'stripe',PAYMENTS_MODE:'test',STRIPE_API_KEY:'rk_test_SYNTHETIC',STRIPE_WEBHOOK_SECRET:'whsec_SYNTHETIC',STRIPE_PRICE_ID:'price_test',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_test',PUBLIC_SITE_URL:'https://brief.example'};
function setup(t){
 const db=new D1();t.after(()=>db.db.close());
 db.db.exec([...stripeSchema,foundingSchema,`CREATE TABLE customers(id TEXT PRIMARY KEY,profile_json TEXT,email TEXT,market_status TEXT,onboarding_status TEXT,status TEXT,payment_status TEXT,subscription_id TEXT UNIQUE,payment_customer_id TEXT,payment_updated_at TEXT,updated_at TEXT)`,`CREATE TABLE diagnostics(id TEXT PRIMARY KEY,system TEXT,subject_id TEXT,code TEXT,detail_json TEXT DEFAULT '{}',status TEXT DEFAULT 'open',updated_at TEXT)`,`CREATE TABLE payment_events(id TEXT,provider TEXT,event_name TEXT,external_id TEXT,payload_json TEXT,UNIQUE(provider,external_id))`].join(';'));
 const id='qa-'+'a'.repeat(64),profile={isTest:true,deliveryConsent:false,termsAccepted:false};
 db.db.prepare('INSERT INTO customers(id,profile_json,email,onboarding_status,status,payment_status) VALUES(?,?,?,?,?,?)').run(id,JSON.stringify(profile),'owner@example.com','complete','test','test_qa');
 const row=()=>db.db.prepare('SELECT * FROM customers WHERE id=?').get(id);
 const state={creates:[],retrieves:0,portal:[],session:null,subscription:null,price:{id:'price_test',livemode:false,active:true,type:'recurring',currency:'usd',unit_amount:4900,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}};
 const client={prices:{retrieve:async()=>state.price},checkout:{sessions:{create:async(params,opts)=>{state.creates.push({params,opts});state.session={id:'cs_test_unit',url:'https://checkout.stripe.com/c/pay/cs_test_unit',status:'open',mode:'subscription',livemode:false,client_reference_id:id,metadata:params.metadata};if(state.loseResponse){state.loseResponse=false;throw Error('synthetic uncertain network');}return state.session;},retrieve:async()=>state.session}},subscriptions:{retrieve:async()=>{state.retrieves++;return state.subscription;}},billingPortal:{sessions:{create:async params=>{state.portal.push(params);return {url:'https://billing.stripe.com/p/session/test'};}}}};
 const checkout=()=>createStripeCheckout(db,env,row(),{ownerTest:true,client});
 const subscribe=async({status='active',paid=true}={})=>{await checkout();state.subscription={id:'sub_test',livemode:false,customer:'cus_test',status,metadata:state.creates[0].params.subscription_data.metadata,items:{data:[{price:{id:'price_test'},quantity:1}]},latest_invoice:{id:'in_test',status:paid?'paid':'open'}};state.session={...state.session,status:'complete',customer:'cus_test',subscription:'sub_test',payment_status:paid?'paid':'unpaid'};};
 const event=(type='customer.subscription.updated',id='evt_unit',created=1)=>({id,type,livemode:false,created,data:{object:type.startsWith('checkout.')?{id:'cs_test_unit'}:type.startsWith('invoice.')?{parent:{subscription_details:{subscription:'sub_test'}}}:{id:'sub_test'}}});
 const process=e=>processStripeEvent(db,env,e,{client});
 return {db,row,state,client,checkout,subscribe,event,process,id};
}
test('configuration defaults closed and prevents key/mode mismatch, unknown origin and unverified live checkout',()=>{
 for(const update of [{PAYMENTS_MODE:'disabled'},{STRIPE_API_KEY:'rk_live_unit'},{STRIPE_PRICE_ID:''},{STRIPE_WEBHOOK_SECRET:''},{PUBLIC_SITE_URL:'http://brief.example'},{PUBLIC_SITE_URL:'https://user@brief.example'},{PAYMENTS_MODE:'live',STRIPE_API_KEY:'rk_live_unit'}])assert.throws(()=>stripeConfig({...env,...update},{checkout:true}));
 assert.equal(stripeConfig(env).mode,'test');
});
test('owner sandbox checkout validates $49 monthly price, stable session reuse, expiry and no profile secrets',async t=>{
 const s=setup(t);const a=await s.checkout(),b=await s.checkout();assert.equal(a.url,b.url);assert.equal(s.state.creates.length,1);
 const params=s.state.creates[0].params;assert.equal(params.mode,'subscription');assert.deepEqual(params.line_items,[{price:'price_test',quantity:1}]);assert.equal(params.subscription_data.billing_mode.type,'flexible');assert.match(params.integration_identifier,/_[a-z]{8}$/);
 assert.equal(params.payment_method_types,undefined);assert.equal(params.automatic_tax,undefined);assert.equal(params.customer_email,undefined);assert.doesNotMatch(JSON.stringify(params),/checkoutToken|owner@example.com|termsAccepted/);
 const reservation=s.db.db.prepare('SELECT * FROM founding_reservations').get();assert.ok(Date.parse(reservation.expires_at)>params.expires_at*1000);assert.ok(params.expires_at*1000>Date.now()+30*60000);
});
test('uncertain checkout retries exact parameters and idempotency key; expired ambiguous request blocks',async t=>{
 const s=setup(t);s.state.loseResponse=true;await assert.rejects(s.checkout());await s.checkout();assert.deepEqual(s.state.creates[0],s.state.creates[1]);
 s.db.db.prepare("UPDATE stripe_checkouts SET session_id=NULL,expires_at='2000-01-01T00:00:00Z'").run();await assert.rejects(s.checkout(),/reconciliation/);assert.equal(s.state.creates.length,2);
});
test('invalid price never consumes capacity or creates Checkout',async t=>{
 const s=setup(t);s.state.price.unit_amount=7900;await assert.rejects(s.checkout(),/49/);assert.equal(s.state.creates.length,0);assert.equal(s.db.db.prepare('SELECT COUNT(*) n FROM founding_reservations').get().n,0);
});
test('provider-confirmed expired session gets a new attempt and fresh full reservation',async t=>{
 const s=setup(t);await s.checkout();const key=s.state.creates[0].opts.idempotencyKey;s.state.session.status='expired';s.db.db.prepare("UPDATE founding_reservations SET expires_at=?").run(new Date(Date.now()+60000).toISOString());await s.checkout();assert.notEqual(key,s.state.creates[1].opts.idempotencyKey);assert.ok(Date.parse(s.db.db.prepare('SELECT expires_at FROM founding_reservations').get().expires_at)>Date.now()+34*60000);
});
test('active/provider-completed existing checkout and prior billing history cannot create a second subscription',async t=>{
 const s=setup(t);await s.checkout();s.state.session.status='complete';await assert.rejects(s.checkout(),/completed/);assert.equal(s.state.creates.length,1);
 s.db.db.prepare("UPDATE customers SET subscription_id='sub_test'").run();await assert.rejects(s.checkout(),/billing history/);
});
test('owner/test/live/ordinary-customer paths remain isolated',async t=>{
 const s=setup(t);await assert.rejects(createStripeCheckout(s.db,env,s.row(),{client:s.client}),/owner-only/);
 const c={...s.row(),profile_json:JSON.stringify({isTest:false,termsAccepted:true,deliveryConsent:true})};await assert.rejects(createStripeCheckout(s.db,env,c,{ownerTest:true,client:s.client}),/owner-only/);
 await assert.rejects(createStripeCheckout(s.db,{...env,PAYMENTS_MODE:'live',STRIPE_API_KEY:'rk_live_unit',LIVE_CHECKOUT_VERIFIED:'1',PROVIDER_CAPACITY_VERIFIED:'1'},s.row(),{ownerTest:true,client:s.client}),/owner-only/);
});
test('transactionally reconciles payment, dedupes by event ID and retains QA isolation',async t=>{
 const s=setup(t);await s.subscribe();assert.equal((await s.process(s.event())).status,'ACCEPTED');assert.equal(s.row().payment_status,'test_active');assert.equal(s.row().status,'test');assert.equal(s.row().subscription_id,'sub_test');assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'paid');
 const count=s.state.retrieves;assert.equal((await s.process(s.event())).status,'DUPLICATE_IGNORED');assert.equal(s.state.retrieves,count);
 assert.doesNotMatch(s.db.db.prepare('SELECT payload_json FROM payment_events').get().payload_json,/owner@example.com|checkout_attempt/);
});
test('event order and equal timestamps never override current subscription; canceled remains canceled',async t=>{
 const s=setup(t);await s.subscribe();await s.process(s.event('customer.subscription.updated','evt_new',200));s.state.subscription.status='canceled';await s.process(s.event('invoice.paid','evt_old',1));assert.equal(s.row().payment_status,'test_canceled');
 await s.process(s.event('customer.subscription.updated','evt_same_time',1));assert.equal(s.row().payment_status,'test_canceled');assert.equal(s.db.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,3);
});
test('cancel-at-period-end preserves paid access; failed renewal, recovery, pause and trial fail closed',async t=>{
 const s=setup(t);await s.subscribe();s.state.subscription.cancel_at_period_end=true;await s.process(s.event('customer.subscription.updated','evt_scheduled'));assert.equal(s.row().payment_status,'test_active');
 for(const [status,paid,expected]of [['past_due',false,'test_past_due'],['active',true,'test_active'],['paused',true,'test_unpaid'],['trialing',true,'test_unpaid'],['active',false,'test_unpaid']]){s.state.subscription.status=status;s.state.subscription.latest_invoice.status=paid?'paid':'open';await s.process(s.event('invoice.paid','evt_'+crypto.randomUUID()));assert.equal(s.row().payment_status,expected);}
});
test('unpaid asynchronous completion holds capacity but never activates; later async success reconciles',async t=>{
 const s=setup(t);await s.subscribe({status:'active',paid:false});await s.process(s.event('checkout.session.completed','evt_async'));assert.equal(s.row().payment_status,'test_unpaid');assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'pending');
 s.state.subscription.latest_invoice.status='paid';s.state.session.payment_status='paid';await s.process(s.event('checkout.session.async_payment_succeeded','evt_success'));assert.equal(s.row().payment_status,'test_active');
});
test('database failure rolls back event dedupe, entitlement and paid allocation; retry succeeds',async t=>{
 const s=setup(t);await s.subscribe();let fail=true;s.db.beforeRun=sql=>{if(fail&&sql.startsWith('INSERT INTO payment_events')){fail=false;throw Error('synthetic write failure');}};await assert.rejects(s.process(s.event()));assert.equal(s.row().subscription_id,null);assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'reserved');assert.equal(s.db.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);await s.process(s.event());assert.equal(s.row().payment_status,'test_active');
});
test('current subscription lookup failure is retryable and never records event success',async t=>{
 const s=setup(t);await s.subscribe();s.client.subscriptions.retrieve=async()=>{throw Error('synthetic outage');};await assert.rejects(s.process(s.event()));assert.equal(s.db.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);assert.equal(s.row().subscription_id,null);
});
test('unknown customer, attempt, product and provider identities cannot bind or grant entitlement',async t=>{
 const s=setup(t);await s.subscribe();const original=structuredClone(s.state.subscription);
 for(const change of [sub=>sub.metadata.customer_id='qa-'+'b'.repeat(64),sub=>sub.metadata.checkout_attempt='wrong',sub=>sub.livemode=true]){s.state.subscription=structuredClone(original);change(s.state.subscription);await assert.rejects(s.process(s.event()));assert.equal(s.row().subscription_id,null);}
});
test('late paid webhook after capacity expiry creates freeze diagnostic',async t=>{
 const s=setup(t);await s.subscribe();s.db.db.prepare("UPDATE founding_reservations SET expires_at='2000-01-01T00:00:00Z'").run();await s.process(s.event());assert.equal(s.db.db.prepare("SELECT code FROM diagnostics WHERE id LIKE 'capacity-%'").get().code,'EXPIRED_RESERVATION_PAYMENT_REVIEW_REQUIRED');
});
test('per-subscription lock serializes concurrent handlers; expired lease can safely recover',async t=>{
 const s=setup(t);await s.subscribe();const l=await acquireStripeLock(s.db,'subscription:sub_test');await assert.rejects(s.process(s.event()),/processing/);await releaseStripeLock(s.db,l);await s.process(s.event());
});
test('signed raw webhook rejects tampering, missing signature, stale replay and wrong mode',async()=>{
 const e={id:'evt_signed',type:'invoice.paid',livemode:false,data:{object:{}}},raw=JSON.stringify(e),cfg=stripeConfig(env),t=Math.floor(Date.now()/1000);
 const sign=(r,at)=>'t='+at+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(at+'.'+r).digest('hex');
 assert.equal((await verifyStripeEvent(raw,sign(raw,t),cfg)).id,e.id);
 await assert.rejects(verifyStripeEvent(raw+' ',sign(raw,t),cfg));await assert.rejects(verifyStripeEvent(raw,null,cfg));await assert.rejects(verifyStripeEvent(raw,sign(raw,t-600),cfg));const live=JSON.stringify({...e,livemode:true});await assert.rejects(verifyStripeEvent(live,sign(live,t),cfg));
});
test('hosted Billing Portal uses persisted customer mapping, config and canonical return URL',async t=>{
 const s=setup(t);await s.subscribe();await s.process(s.event());const r=await createStripePortal(env,s.row(),{ownerTest:true,client:s.client});assert.match(r.url,/^https:\/\/billing.stripe.com\//);assert.deepEqual(s.state.portal[0],{customer:'cus_test',configuration:'bpc_test',return_url:'https://brief.example/dashboard/qa-intake'});
 s.state.subscription.customer='cus_other';await assert.rejects(createStripePortal(env,s.row(),{ownerTest:true,client:s.client}),/mismatch/);assert.equal(s.state.portal.length,1);
});
test('subscription entitlement rejects extra items, quantities and collection pauses',()=>{
 const sub={livemode:false,status:'active',items:{data:[{price:{id:'price_test'},quantity:1}]},latest_invoice:{status:'paid'}};
 assert.equal(subscriptionPaymentStatus({...sub,pause_collection:{behavior:'void'}},stripeConfig(env)),'unpaid');assert.equal(subscriptionPaymentStatus({...sub,items:{data:[...sub.items.data,...sub.items.data]}},stripeConfig(env)),'unpaid');assert.equal(subscriptionPaymentStatus({...sub,items:{data:[{price:{id:'price_test'},quantity:2}]}},stripeConfig(env)),'unpaid');
});
test('provider-side offer changes revoke existing active entitlement, including later cancellation',async t=>{
 const s=setup(t);await s.subscribe();await s.process(s.event());s.state.subscription.items.data[0].price.id='price_other';await s.process(s.event('customer.subscription.updated','evt_product_changed'));assert.equal(s.row().payment_status,'test_unpaid');assert.equal(s.db.db.prepare("SELECT code FROM diagnostics WHERE id=?").get('payment-'+s.id).code,'STRIPE_SUBSCRIPTION_CONFIGURATION_REVIEW_REQUIRED');s.state.subscription.status='canceled';await s.process(s.event('customer.subscription.deleted','evt_canceled_changed'));assert.equal(s.row().payment_status,'test_canceled');
});
test('abandoned or uncertain Stripe holds remain counted beyond local clocks until provider-confirmed expiry',async t=>{
 const s=setup(t);await s.checkout();const first=s.db.db.prepare('SELECT * FROM founding_reservations').get();assert.equal(first.expires_at,'9999-12-31T23:59:59.999Z');
 for(let i=1;i<10;i++)s.db.db.prepare("INSERT INTO founding_reservations VALUES(?,?,'paid',?,?)").run('other-'+i,'test',first.expires_at,first.created_at);
 const {reserveFoundingPlace}=await import('../lib/founding-capacity.mjs');assert.equal(await reserveFoundingPlace(s.db,'eleventh','test',new Date(Date.now()+24*3600000)),null);
 s.state.session.status='expired';await s.process(s.event('checkout.session.expired','evt_expired'));assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations WHERE customer_id=?').get(s.id).state,'released');assert.ok(await reserveFoundingPlace(s.db,'eleventh','test'));
});
test('old expired-session notification cannot release a newer attempt, and expiry respects checkout lock',async t=>{
 const s=setup(t);await s.checkout();s.state.session.status='expired';const old=structuredClone(s.state.session);
 const lock=await acquireStripeLock(s.db,'checkout:'+s.id+':test');await assert.rejects(s.process(s.event('checkout.session.expired','evt_expired_locked')),/processing/);await releaseStripeLock(s.db,lock);
 await s.checkout();assert.notEqual(s.state.session.metadata.checkout_attempt,old.metadata.checkout_attempt);
 s.state.session=old;await s.process(s.event('checkout.session.expired','evt_expired_old'));assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'reserved');
});
test('signed expired notification reconciles an ambiguous create by exact attempt metadata',async t=>{
 const s=setup(t);s.state.loseResponse=true;await assert.rejects(s.checkout());assert.equal(s.db.db.prepare('SELECT session_id FROM stripe_checkouts').get().session_id,null);s.state.session.status='expired';await s.process(s.event('checkout.session.expired','evt_expire_lost'));assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'released');
});
test('sandbox capacity diagnostic cannot freeze live mode; unknown legacy diagnostics stay closed',async t=>{
 const s=setup(t);s.db.db.prepare('INSERT INTO diagnostics(id,status,code,detail_json) VALUES(?,?,?,?)').run('capacity-test','open','UNRESERVED_PAYMENT_REVIEW_REQUIRED',JSON.stringify({mode:'test'}));
 const {reserveFoundingPlace}=await import('../lib/founding-capacity.mjs');assert.equal(await reserveFoundingPlace(s.db,'test-other','test'),null);assert.ok(await reserveFoundingPlace(s.db,'live-other','live'));s.db.db.prepare("UPDATE diagnostics SET detail_json='{}'").run();assert.equal(await reserveFoundingPlace(s.db,'live-two','live'),null);
});
test('recorded scheduled cancellation stops live report eligibility while retaining true paid status and founder place',async t=>{
 const s=setup(t);await s.subscribe();const live={...env,PAYMENTS_MODE:'live',STRIPE_API_KEY:'rk_live_SYNTHETIC'};s.db.db.prepare("UPDATE customers SET profile_json='{}',status='active'").run();s.db.db.prepare("UPDATE stripe_checkouts SET mode='live'").run();s.db.db.prepare("UPDATE founding_reservations SET mode='live'").run();s.state.subscription.livemode=true;s.state.subscription.cancel_at_period_end=true;const e={...s.event(),livemode:true};await processStripeEvent(s.db,live,e,{client:s.client});assert.equal(s.row().payment_status,'active');assert.equal(s.row().status,'canceled');assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'paid');
});
test('subscription-created before async Checkout completion holds one pending slot without freezing all remaining capacity',async t=>{
 const s=setup(t);await s.subscribe({status:'active',paid:false});await s.process(s.event('customer.subscription.created','evt_pending_sub'));assert.equal(s.row().payment_status,'test_unpaid');assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'pending');
 const {reserveFoundingPlace,releaseUnpaidPlace}=await import('../lib/founding-capacity.mjs');await releaseUnpaidPlace(s.db,s.id,'test');assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations').get().state,'pending');for(let i=1;i<10;i++)assert.ok(await reserveFoundingPlace(s.db,'remaining-'+i,'test'));assert.equal(await reserveFoundingPlace(s.db,'eleventh','test'),null);
 s.state.subscription.latest_invoice.status='paid';await s.process(s.event('invoice.paid','evt_pending_paid'));assert.equal(s.db.db.prepare('SELECT state FROM founding_reservations WHERE customer_id=?').get(s.id).state,'paid');
});
