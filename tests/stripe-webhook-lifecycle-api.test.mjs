// Real compiled Worker routes + in-memory transactional SQLite + synthetic Stripe HTTP.
// All outbound fetches are intercepted. No real provider, payment, or email is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';

// vinext captures fetch during module initialization and may reinstall its own
// wrapper during SSR. Its captured transport must also be permanently offline.
// This file runs in node:test's isolated process and never retains native fetch.
const blockedNetworkAttempts=[];
globalThis.fetch=async(input)=>{blockedNetworkAttempts.push(input instanceof Request?input.url:String(input));throw Error('Actual network is prohibited by this offline test process');};
const workerModule=process.env.LOB_WORKER_MODULE??new URL('../dist/server/index.js',import.meta.url).href;
const {default:worker}=await import(workerModule);
const origin='https://brief.example';
const owner={'oai-authenticated-user-email':'owner@example.com',origin};
const subId='sub_SYNTHETIC',providerCustomerId='cus_SYNTHETIC',attemptId='attempt-synthetic-lifecycle';
const intake={contactName:'OWNER TEST',businessName:'Synthetic lifecycle QA',email:'owner@example.com',city:'Olympia',state:'WA',zip:'98501',category:'boutique',products:'Synthetic gifts',customers:'Synthetic adult shoppers',voice:'factual',localRadius:'35',qaAcknowledged:'yes'};
const plain=value=>JSON.parse(JSON.stringify(value));

class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.beforeRun=null;}
 prepare(sql){
  let args=[];
  const run=()=>{this.beforeRun?.(sql,args);const result=this.db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};};
  const query={bind(...values){args=values;return query;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};
  return query;
 }
 async batch(statements){this.db.exec('BEGIN');try{const results=statements.map(statement=>statement._run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}

function setup(t){
 const db=new D1();t.after(()=>db.db.close());
 const guardStart=blockedNetworkAttempts.length;
 t.after(()=>assert.equal(blockedNetworkAttempts.length,guardStart,'No request may escape the provider interceptor, even to the deny-all transport'));
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})},OWNER_EMAIL:intake.email,REPORT_SYNC_SECRET:'synthetic-sync-only',PAYMENTS_PROVIDER:'stripe',PAYMENTS_MODE:'test',STRIPE_API_KEY:'rk_test_SYNTHETIC',STRIPE_WEBHOOK_SECRET:'whsec_SYNTHETIC',STRIPE_PRICE_ID:'price_SYNTHETIC',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_SYNTHETIC',PUBLIC_SITE_URL:origin,LIVE_DELIVERY:'0'};
 const state={customerId:null,subscription:null,requests:[],portalRequests:[],unexpected:[],errors:[],providerFailure:false,onRetrieve:null};
 t.mock.method(console,'error',(...args)=>state.errors.push(args));
 state.fetchMock=t.mock.method(globalThis,'fetch',async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  const record={method:request.method,pathname:url.pathname,query:url.search};state.requests.push(record);
  const json=(body,status=200)=>Response.json(body,{status,headers:{'request-id':'req_SYNTHETIC','stripe-should-retry':'false'}});
  if(url.origin!=='https://api.stripe.com'){
   state.unexpected.push(request.url);throw Error('Unexpected outbound request blocked by the offline harness');
  }
  if(request.method==='GET'&&url.pathname==='/v1/subscriptions/'+subId){
   state.onRetrieve?.();
   if(state.providerFailure)return json({error:{type:'invalid_request_error',code:'more_permissions_required',message:'PRIVATE_PROVIDER_TEXT owner@example.com rk_test_PRIVATE'}},403);
   return json(state.subscription);
  }
  if(request.method==='POST'&&url.pathname==='/v1/billing_portal/sessions'){
   state.portalRequests.push(Object.fromEntries(new URLSearchParams(await request.text())));
   return json({id:'bps_SYNTHETIC',object:'billing_portal.session',url:'https://billing.stripe.com/p/session/SYNTHETIC',livemode:false});
  }
  state.unexpected.push(request.method+' '+request.url);throw Error('Unexpected Stripe resource blocked by the offline harness');
 });
 t.after(()=>assert.deepEqual(state.unexpected,[],'No unrecognized outbound operation is permitted'));
 const context={waitUntil(){},passThroughOnException(){}};
 const call=(path,body,headers={},raw)=>{
  // The first Worker request may install vinext's global wrapper even without
  // HTML rendering. Reinstate the explicit mock before each later API call.
  globalThis.fetch=state.fetchMock;
  assert.equal(globalThis.fetch,state.fetchMock,'The strict provider interceptor must be installed before every API request');
  return worker.fetch(new Request(origin+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:raw??JSON.stringify(body)}),env,context);
 };
 const dashboard=()=>worker.fetch(new Request(origin+'/dashboard',{headers:{accept:'text/html',...owner}}),env,context);
 const event=(type,id,created=200)=>({id,object:'event',type,livemode:false,created,data:{object:type.startsWith('invoice.')?{id:'in_SYNTHETIC',object:'invoice',parent:{subscription_details:{subscription:subId}},customer_email:'PRIVATE_EVENT_EMAIL@example.com'}:{id:subId,object:'subscription'}}});
 const signed=(event)=>{const raw=JSON.stringify(event),at=Math.floor(Date.now()/1000),signature='t='+at+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(at+'.'+raw).digest('hex');return call('/api/webhooks/stripe',event,{'stripe-signature':signature},raw);};
 const rows=table=>plain(db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
 const customer=()=>plain(db.db.prepare('SELECT * FROM customers WHERE id=?').get(state.customerId));
 const errors=()=>state.errors.map(args=>{assert.equal(args.length,1);assert.equal(typeof args[0],'string');return JSON.parse(args[0]);});
 const seed=async()=>{
  const response=await call('/api/owner/qa-intake',intake,owner);assert.equal(response.status,201);state.customerId=(await response.json()).customerId;
  db.db.prepare("UPDATE customers SET payment_status='test_active',status='test',subscription_id=?,payment_customer_id=? WHERE id=?").run(subId,providerCustomerId,state.customerId);
  db.db.prepare('INSERT INTO founding_reservations(customer_id,mode,state,expires_at,created_at) VALUES(?,?,?,?,?)').run(state.customerId,'test','paid','9999-12-31T23:59:59.999Z',new Date().toISOString());
  db.db.prepare('INSERT INTO stripe_checkouts(customer_id,mode,attempt_id,request_json,session_id,state,expires_at) VALUES(?,?,?,?,?,?,?)').run(state.customerId,'test',attemptId,'{}','cs_test_SYNTHETIC','complete','9999-12-31T23:59:59.999Z');
  state.subscription={id:subId,object:'subscription',livemode:false,customer:providerCustomerId,status:'active',cancel_at_period_end:false,metadata:{business:'local-opportunity-brief',customer_id:state.customerId,checkout_attempt:attemptId},items:{data:[{price:{id:env.STRIPE_PRICE_ID},quantity:1}]},latest_invoice:{id:'in_SYNTHETIC',status:'paid'}};
  assert.equal(state.requests.length,0);
 };
 return {db,env,state,call,dashboard,event,signed,rows,customer,errors,seed};
}

async function accepted(response){assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ACCEPTED',testMode:true});}
function assertQaIsolation(s,profile){const customer=s.customer();assert.equal(customer.status,'test');assert.equal(customer.profile_json,profile);assert.equal(JSON.parse(profile).deliveryConsent,false);assert.equal(customer.first_delivered_at,null);assert.equal(s.rows('founding_reservations')[0].state,'paid');assert.deepEqual(s.rows('delivery_attempts'),[]);}
function assertSafeRecord(record,expected){
 assert.deepEqual(record,expected);
 assert.doesNotMatch(JSON.stringify(record),/PRIVATE_|owner@example|rk_test_|whsec_|signature|checkoutToken|stack|https:/);
}
async function assertQaDashboard(s,paymentStatus){
 const response=await s.dashboard();assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/^text\/html/);
 const html=await response.text(),main=html.match(/<main\b[\s\S]*?<\/main>/)?.[0];assert.ok(main,'The owner dashboard must render its main content');
 const text=main.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 assert.match(text,/Customers · 0/);assert.match(text,/Active subscriptions: 0/);assert.match(text,/Owner-only QA records · 1/);
 assert.ok(text.includes('TEST ONLY · Sandbox payment: '+paymentStatus+' · No real service agreement or customer delivery'));
 assert.doesNotMatch(text,/No legal consent, checkout/);
}

test('signed Worker lifecycle handles failed renewal, recovery, cancellation, duplicate and delayed events while keeping QA isolated',async t=>{
 const s=setup(t);await s.seed();const profile=s.customer().profile_json;
 s.state.subscription.status='past_due';s.state.subscription.latest_invoice.status='open';
 const failed=s.event('invoice.payment_failed','evt_Failed',300);
 await accepted(await s.signed(failed));assert.equal(s.customer().payment_status,'test_past_due');assertQaIsolation(s,profile);
 assert.equal(s.rows('diagnostics').find(row=>row.id==='payment-'+s.state.customerId).code,'SUBSCRIPTION_TEST_PAST_DUE');
 const beforeDuplicate=s.state.requests.length;
 assert.deepEqual(await (await s.signed(failed)).json(),{status:'DUPLICATE_IGNORED'});assert.equal(s.state.requests.length,beforeDuplicate);
 s.state.subscription.status='active';s.state.subscription.latest_invoice.status='paid';
 await accepted(await s.signed(s.event('invoice.paid','evt_Recovered',400)));assert.equal(s.customer().payment_status,'test_active');assertQaIsolation(s,profile);
 await accepted(await s.signed(s.event('invoice.payment_failed','evt_DelayedFailure',1)));assert.equal(s.customer().payment_status,'test_active','A delayed failure must use current paid subscription truth');
 s.state.subscription.status='canceled';
 const canceled=s.event('customer.subscription.deleted','evt_Canceled',500);
 await accepted(await s.signed(canceled));assert.equal(s.customer().payment_status,'test_canceled');assertQaIsolation(s,profile);
 await accepted(await s.signed(s.event('invoice.paid','evt_DelayedPaid',2)));assert.equal(s.customer().payment_status,'test_canceled','An old paid event cannot reactivate a canceled subscription');
 const requestCount=s.state.requests.length;const duplicate=await s.signed(canceled);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).status,'DUPLICATE_IGNORED');assert.equal(s.state.requests.length,requestCount);
 assert.equal(s.rows('payment_events').length,5);assert.deepEqual(s.errors(),[]);assert.deepEqual(s.rows('stripe_locks'),[]);
 for(const request of s.state.requests){assert.equal(request.method,'GET');assert.equal(request.pathname,'/v1/subscriptions/'+subId);assert.equal(new URLSearchParams(request.query).get('expand[0]'),'latest_invoice');}
});

test('a held subscription lock returns safe 503 without deduping, then the identical signed event retries successfully',async t=>{
 const s=setup(t);await s.seed();const event=s.event('invoice.paid','evt_LockRetry');
 s.db.db.prepare('INSERT INTO stripe_locks(id,token,expires_at) VALUES(?,?,?)').run('subscription:'+subId,'synthetic-other-handler',Date.now()+120000);
 const response=await s.signed(event);assert.equal(response.status,503);assert.equal((await response.json()).code,'PAYMENT_LOCK_BUSY');assert.equal(s.rows('payment_events').length,0);assert.equal(s.state.requests.length,0);
 assertSafeRecord(s.errors()[0],{kind:'stripe_webhook_failure',stage:'reconcile',code:'PAYMENT_LOCK_BUSY',status:503,mode:'test',eventId:event.id,eventType:event.type});
 s.db.db.prepare('DELETE FROM stripe_locks WHERE id=? AND token=?').run('subscription:'+subId,'synthetic-other-handler');
 await accepted(await s.signed(event));assert.equal(s.rows('payment_events').length,1);assert.equal(s.customer().payment_status,'test_active');assert.deepEqual(s.rows('stripe_locks'),[]);
});

test('an expired reconciliation lease returns safe 503 and permits an identical event retry',async t=>{
 const s=setup(t);await s.seed();const event=s.event('invoice.paid','evt_LeaseRetry');
 s.state.onRetrieve=()=>s.db.db.prepare('UPDATE stripe_locks SET expires_at=0 WHERE id=?').run('subscription:'+subId);
 const response=await s.signed(event);assert.equal(response.status,503);assert.equal((await response.json()).code,'PAYMENT_LEASE_EXPIRED');assert.equal(s.rows('payment_events').length,0);assert.deepEqual(s.rows('stripe_locks'),[]);
 assertSafeRecord(s.errors()[0],{kind:'stripe_webhook_failure',stage:'reconcile',code:'PAYMENT_LEASE_EXPIRED',status:503,mode:'test',eventId:event.id,eventType:event.type});
 s.state.onRetrieve=null;await accepted(await s.signed(event));assert.equal(s.rows('payment_events').length,1);
});

test('owner Portal uses only the existing QA billing identity and mocked Stripe HTTP without creating intake or Checkout',async t=>{
 const s=setup(t);await s.seed();const before=Object.fromEntries(['customers','leads','markets','stripe_checkouts','founding_reservations','intake_limits'].map(table=>[table,s.rows(table)]));
 const response=await s.call('/api/owner/stripe-portal',{customerId:s.state.customerId},owner);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{url:'https://billing.stripe.com/p/session/SYNTHETIC',mode:'test'});
 assert.deepEqual(s.state.portalRequests,[{customer:providerCustomerId,configuration:'bpc_SYNTHETIC',return_url:origin+'/dashboard/qa-intake'}]);
 assert.deepEqual(s.state.requests.map(({method,pathname})=>({method,pathname})),[{method:'GET',pathname:'/v1/subscriptions/'+subId},{method:'POST',pathname:'/v1/billing_portal/sessions'}]);
 for(const [table,rows]of Object.entries(before))assert.deepEqual(s.rows(table),rows,table+' must remain unchanged');assert.deepEqual(s.errors(),[]);
});

test('duplicate QA form restore preserves an already test_active profile and billing mapping byte-for-byte',async t=>{
 const s=setup(t);await s.seed();const tables=['customers','leads','markets','stripe_checkouts','founding_reservations','diagnostics'];const before=Object.fromEntries(tables.map(table=>[table,s.rows(table)]));
 const response=await s.call('/api/owner/qa-intake',{...intake,email:'OWNER@EXAMPLE.COM',businessName:intake.businessName.toUpperCase(),state:'wa',city:'olympia',products:'DO NOT OVERWRITE ORIGINAL',deliveryConsent:'yes',termsAccepted:'yes'},owner);
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.customerId,s.state.customerId);assert.equal(body.duplicate,true);assert.equal(body.isTest,true);assert.equal(body.checkoutToken,undefined);
 for(const table of tables)assert.deepEqual(s.rows(table),before[table],table+' must remain unchanged');
 assert.equal(s.rows('intake_limits')[0].attempts,2);assert.equal(s.customer().payment_status,'test_active');assert.equal(s.state.requests.length,0);assert.deepEqual(s.errors(),[]);
});

test('invalid signatures produce no diagnostic or database activity; verified schema failure produces only a safe database-stage record',async t=>{
 const s=setup(t);const event=s.event('invoice.payment_failed','evt_DatabaseFailure');
 s.db.beforeRun=()=>{throw Error('PRIVATE_DATABASE_MESSAGE owner@example.com');};
 const unsigned=await s.call('/api/webhooks/stripe',event,{'stripe-signature':'invalid'});assert.equal(unsigned.status,400);assert.deepEqual(s.errors(),[]);assert.equal(s.state.requests.length,0);
 const response=await s.signed(event);assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'WEBHOOK_PROCESSING_FAILED');assert.doesNotMatch(JSON.stringify(body),/PRIVATE_DATABASE_MESSAGE|owner@example.com/);
 assertSafeRecord(s.errors()[0],{kind:'stripe_webhook_failure',stage:'database',code:'WEBHOOK_PROCESSING_FAILED',status:503,mode:'test',eventId:event.id,eventType:event.type});assert.equal(s.state.requests.length,0);
 s.db.beforeRun=null;
});

test('transaction failure rolls back signed-event dedupe and customer changes, logs safe reconcile context, and retries',async t=>{
 const s=setup(t);await s.seed();const before=s.customer(),event=s.event('invoice.payment_failed','evt_TransactionRetry');
 s.state.subscription.status='past_due';s.state.subscription.latest_invoice.status='open';
 s.db.beforeRun=sql=>{if(sql.startsWith('INSERT INTO payment_events'))throw Error('PRIVATE_TRANSACTION_MESSAGE owner@example.com');};
 const response=await s.signed(event);assert.equal(response.status,503);assert.equal((await response.json()).code,'WEBHOOK_PROCESSING_FAILED');assert.deepEqual(s.customer(),before);assert.equal(s.rows('payment_events').length,0);assert.deepEqual(s.rows('stripe_locks'),[]);
 assertSafeRecord(s.errors()[0],{kind:'stripe_webhook_failure',stage:'reconcile',code:'WEBHOOK_PROCESSING_FAILED',status:503,mode:'test',eventId:event.id,eventType:event.type});
 s.db.beforeRun=null;await accepted(await s.signed(event));assert.equal(s.customer().payment_status,'test_past_due');assert.equal(s.rows('payment_events').length,1);
});

test('Stripe permission failure logs only allowlisted type and request ID, never provider text or event personal data',async t=>{
 const s=setup(t);await s.seed();s.state.providerFailure=true;const event=s.event('invoice.payment_failed','evt_ProviderFailure');
 const response=await s.signed(event);assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'StripePermissionError');assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|owner@example|rk_test_/);assert.equal(s.rows('payment_events').length,0);assert.deepEqual(s.rows('stripe_locks'),[]);
 assertSafeRecord(s.errors()[0],{kind:'stripe_webhook_failure',stage:'reconcile',code:'StripePermissionError',status:503,mode:'test',eventId:event.id,eventType:event.type,providerRequestId:'req_SYNTHETIC'});
 s.state.providerFailure=false;await accepted(await s.signed(event));assert.equal(s.rows('payment_events').length,1);
});

// Keep SSR separate from SDK routes: vinext's first render installs a fetch
// wrapper. Its original transport is the fail-closed guard installed above.
test('rendered owner dashboard distinguishes active and canceled sandbox billing while excluding QA from customer totals',async t=>{
 const s=setup(t);await s.seed();await assertQaDashboard(s,'test_active');
 s.db.db.prepare("UPDATE customers SET payment_status='test_canceled' WHERE id=?").run(s.state.customerId);
 await assertQaDashboard(s,'test_canceled');
 assert.equal(s.state.requests.length,0);assert.deepEqual(s.errors(),[]);
});
