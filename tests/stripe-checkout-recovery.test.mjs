// Transactional SQLite and synthetic Stripe SDK boundaries only: no provider calls or charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {recoverRejectedCheckout,REJECTED_CHECKOUT} from '../lib/stripe-checkout-recovery.mjs';
import {stripeSchema,createStripeCheckout,acquireStripeLock,releaseStripeLock} from '../lib/stripe-payments.mjs';
import {foundingSchema} from '../lib/founding-capacity.mjs';

// Reviewed request bytes contain synthetic QA identifiers and public configuration only.
const attemptFixture = {"customer_id":"qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496","mode":"test","attempt_id":"71bb3487-c303-4a48-bc7f-9ea91a2f6488","request_json":"{\"mode\":\"subscription\",\"line_items\":[{\"price\":\"price_1UM6uAHIBIrkXtd8i8lxXqUX\",\"quantity\":1}],\"client_reference_id\":\"qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496\",\"metadata\":{\"business\":\"local-opportunity-brief\",\"customer_id\":\"qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496\",\"checkout_attempt\":\"71bb3487-c303-4a48-bc7f-9ea91a2f6488\"},\"subscription_data\":{\"metadata\":{\"business\":\"local-opportunity-brief\",\"customer_id\":\"qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496\",\"checkout_attempt\":\"71bb3487-c303-4a48-bc7f-9ea91a2f6488\"},\"billing_mode\":{\"type\":\"flexible\"}},\"integration_identifier\":\"local_opportunity_brief_proyvxuo\",\"expires_at\":1790974739,\"success_url\":\"https://local-opportunity-brief.mshipe2022.chatgpt.site/dashboard/qa-intake?checkout=complete\",\"cancel_url\":\"https://local-opportunity-brief.mshipe2022.chatgpt.site/dashboard/qa-intake?checkout=canceled\"}","session_id":null,"state":"creating","expires_at":"2026-10-02T20:58:59.452Z"};
const CUSTOMER=REJECTED_CHECKOUT.customerId, ATTEMPT=REJECTED_CHECKOUT.attemptId;
const auditId='stripe-checkout-recovery-'+ATTEMPT;
const lockId='checkout:'+CUSTOMER+':test';
const env={OWNER_EMAIL:'owner@example.com',PAYMENTS_PROVIDER:'stripe',PAYMENTS_MODE:'test',STRIPE_API_KEY:'rk_test_SYNTHETIC',STRIPE_WEBHOOK_SECRET:'whsec_SYNTHETIC',STRIPE_PRICE_ID:REJECTED_CHECKOUT.priceId,PUBLIC_SITE_URL:REJECTED_CHECKOUT.origin};
const customerFixture={id:CUSTOMER,lead_id:'synthetic-lead',email:'owner@example.com',business_name:'Synthetic recovery QA',profile_json:'{ "isTest": true, "deliveryConsent": false, "termsAccepted": false, "note": "preserve bytes" }',market_id:'synthetic-market',payment_customer_id:null,subscription_id:null,payment_status:'test_qa',onboarding_status:'complete',status:'test',delivery_status:'pending',require_every_review:1,first_delivered_at:null,payment_updated_at:null,created_at:'2026-10-02 20:00:00',updated_at:'2026-10-02 20:00:00'};
const reservationFixture={customer_id:CUSTOMER,mode:'test',state:'reserved',expires_at:'9999-12-31T23:59:59.999Z',created_at:'2026-10-02T20:27:59.452Z'};
const plain=value=>JSON.parse(JSON.stringify(value));
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.beforeRun=null;this.beforeBatch=null;}
 prepare(sql){let args=[];const run=()=>{this.beforeRun?.(sql);const r=this.db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};};const q={bind(...v){args=v;return q;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}
 async batch(stmts){this.beforeBatch?.();this.db.exec('BEGIN');try{const r=stmts.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const session=(id='cs_test_unrelated',extra={})=>({id,object:'checkout.session',livemode:false,client_reference_id:'qa-unrelated',metadata:{customer_id:'qa-unrelated',checkout_attempt:'unrelated-attempt'},status:'open',...extra});
const page=(data=[],has_more=false)=>({object:'list',data,has_more});
function setup(t){
 const db=new D1();t.after(()=>db.db.close());
 db.db.exec([...stripeSchema,foundingSchema,`CREATE TABLE customers(id TEXT PRIMARY KEY,lead_id TEXT,email TEXT,business_name TEXT,profile_json TEXT,market_id TEXT,payment_customer_id TEXT,subscription_id TEXT,payment_status TEXT,onboarding_status TEXT,status TEXT,delivery_status TEXT,require_every_review INTEGER,first_delivered_at TEXT,payment_updated_at TEXT,created_at TEXT,updated_at TEXT)`,`CREATE TABLE audit_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,subject_id TEXT NOT NULL,actor_email TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,`CREATE TABLE diagnostics(id TEXT PRIMARY KEY,system TEXT,subject_id TEXT,code TEXT,detail_json TEXT DEFAULT '{}',status TEXT DEFAULT 'open',updated_at TEXT)`].join(';'));
 const insert=(table,row)=>db.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
 insert('customers',customerFixture);insert('founding_reservations',reservationFixture);insert('stripe_checkouts',attemptFixture);
 const state={priceCalls:[],lists:[],creates:[],pages:[page()],price:{id:REJECTED_CHECKOUT.priceId,livemode:false,active:true,type:'recurring',currency:'usd',unit_amount:4900,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}},onPrice:null,onList:null};
 const client={prices:{retrieve:async(...args)=>{state.priceCalls.push(args);await state.onPrice?.();return state.price;}},checkout:{sessions:{list:async(...args)=>{state.lists.push(args);await state.onList?.(state.lists.length);return state.pages[Math.min(state.lists.length-1,state.pages.length-1)];},create:async(params,opts)=>{state.creates.push({params,opts});return session('cs_test_fresh',{url:'https://checkout.stripe.com/c/pay/cs_test_fresh',client_reference_id:CUSTOMER,metadata:params.metadata});}}}};
 const recover=(input={},config={})=>recoverRejectedCheckout(db,{...env,...config},{customerId:CUSTOMER,attemptId:ATTEMPT,actorEmail:'owner@example.com',...input},{client});
 const rows=table=>plain(db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
 const snapshot=()=>Object.fromEntries(['customers','founding_reservations','stripe_checkouts','audit_events'].map(table=>[table,rows(table)]));
 const update=(table,column,value)=>db.db.prepare(`UPDATE ${table} SET ${column}=?`).run(value);
 return {db,state,client,recover,rows,snapshot,update,insert};
}
function assertRetained(s,before){assert.deepEqual(s.snapshot(),before);assert.equal(s.state.creates.length,0);}

test('exact reviewed fixture hashes byte-for-byte to the immutable recovery request',()=>{
 assert.equal(createHash('sha256').update(attemptFixture.request_json).digest('hex'),REJECTED_CHECKOUT.requestSha256);
 assert.equal(attemptFixture.attempt_id,ATTEMPT);assert.equal(attemptFixture.customer_id,CUSTOMER);assert.equal(attemptFixture.expires_at,REJECTED_CHECKOUT.expiresAt);
});
test('successful recovery atomically archives every original byte and only removes the exact checkout row',async t=>{
 const s=setup(t);s.insert('customers',{...customerFixture,id:'qa-other',lead_id:'other-lead'});s.insert('founding_reservations',{...reservationFixture,customer_id:'qa-other'});s.insert('stripe_checkouts',{...attemptFixture,customer_id:'qa-other',attempt_id:'other-attempt'});
 const before=s.snapshot();const result=await s.recover();assert.deepEqual(result,{status:'recovered',attemptId:ATTEMPT});
 assert.deepEqual(s.rows('customers'),before.customers);assert.deepEqual(s.rows('founding_reservations'),before.founding_reservations);assert.deepEqual(s.rows('stripe_checkouts'),before.stripe_checkouts.filter(a=>a.attempt_id!==ATTEMPT));
 const [audit]=s.rows('audit_events');assert.equal(audit.id,auditId);assert.equal(audit.event_type,'stripe_test_rejected_checkout_retired');assert.equal(audit.subject_id,CUSTOMER);assert.equal(audit.actor_email,'owner@example.com');
 const detail=JSON.parse(audit.detail_json);assert.equal(detail.version,1);assert.deepEqual(detail.attempt,attemptFixture);assert.equal(Buffer.compare(Buffer.from(detail.attempt.request_json),Buffer.from(attemptFixture.request_json)),0);assert.deepEqual(detail.customerBefore,customerFixture);assert.deepEqual(detail.reservationBefore,reservationFixture);
 assert.deepEqual({...detail.providerEvidence.sessionCheck,checkedAt:undefined},{checkedAt:undefined,pages:1,sessionsInspected:0,complete:true,matchingSessions:0});assert.ok(Number.isFinite(Date.parse(detail.providerEvidence.sessionCheck.checkedAt)));
 assert.deepEqual({...detail.providerEvidence,sessionCheck:undefined},{accountId:REJECTED_CHECKOUT.accountId,accountBinding:'pinned_sandbox_price_same_client',priceId:REJECTED_CHECKOUT.priceId,livemode:false,requestId:REJECTED_CHECKOUT.requestId,requestTime:REJECTED_CHECKOUT.requestTime,httpStatus:403,errorCode:'more_permissions_required',idempotencyKey:'lob-checkout-'+ATTEMPT,sessionCheck:undefined});
 assert.deepEqual(s.state.priceCalls,[[REJECTED_CHECKOUT.priceId]]);assert.deepEqual(s.state.lists,[[{limit:100}]]);assert.equal(s.state.creates.length,0);assert.deepEqual(s.rows('stripe_locks'),[]);
});
test('replay is deterministic, creates no second audit, skips provider reads, and preserves a newer attempt',async t=>{
 const s=setup(t);await s.recover();const archived=s.snapshot();assert.deepEqual(await s.recover(),{status:'already_recovered',attemptId:ATTEMPT});assert.deepEqual(s.snapshot(),archived);
 s.insert('stripe_checkouts',{...attemptFixture,attempt_id:'newer-attempt',request_json:'{ "newer": true }',session_id:'cs_test_newer',state:'open'});const withNew=s.snapshot();
 for(let i=0;i<3;i++)assert.deepEqual(await s.recover(),{status:'already_recovered',attemptId:ATTEMPT});assert.deepEqual(s.snapshot(),withNew);assert.equal(s.state.priceCalls.length,1);assert.equal(s.state.lists.length,1);
});
test('archive replay never removes a restored copy of the retired attempt',async t=>{
 const s=setup(t);await s.recover();s.insert('stripe_checkouts',attemptFixture);const before=s.snapshot();await assert.rejects(s.recover());assertRetained(s,before);
});
for(const [name,change] of [
 ['malformed detail',a=>a.detail_json='{'],['wrong event type',a=>a.event_type='other'],['wrong subject',a=>a.subject_id='other'],
 ['wrong attempt',a=>{const d=JSON.parse(a.detail_json);d.attempt.attempt_id='other';a.detail_json=JSON.stringify(d);}],
 ['wrong archived customer',a=>{const d=JSON.parse(a.detail_json);d.attempt.customer_id='other';a.detail_json=JSON.stringify(d);}],
 ['wrong archived mode',a=>{const d=JSON.parse(a.detail_json);d.attempt.mode='live';a.detail_json=JSON.stringify(d);}],
 ['wrong evidence request',a=>{const d=JSON.parse(a.detail_json);d.providerEvidence.requestId='req_other';a.detail_json=JSON.stringify(d);}],
 ['changed request bytes',a=>{const d=JSON.parse(a.detail_json);d.attempt.request_json+=' ';a.detail_json=JSON.stringify(d);}]
])test('replay rejects '+name,async t=>{const s=setup(t);await s.recover();const a=s.rows('audit_events')[0];change(a);for(const k of ['event_type','subject_id','detail_json'])s.update('audit_events',k,a[k]);const before=s.snapshot();await assert.rejects(s.recover());assertRetained(s,before);});

for(const [name,input,config] of [
 ['wrong customer',{customerId:'qa-other'},{}],['wrong attempt',{attemptId:'other'},{}],['wrong actor',{actorEmail:'intruder@example.com'},{}],['missing actor',{actorEmail:''},{}],['missing owner',{}, {OWNER_EMAIL:undefined}],
 ['live mode',{}, {PAYMENTS_MODE:'live',STRIPE_API_KEY:'rk_live_SYNTHETIC'}],['live delivery',{}, {LIVE_DELIVERY:'1'}],['wrong pinned price',{}, {STRIPE_PRICE_ID:'price_wrongaccount'}],['wrong canonical origin',{}, {PUBLIC_SITE_URL:'https://other.example'}],['disabled payments',{}, {PAYMENTS_MODE:'disabled'}]
])test('recovery fails closed before provider reads for '+name,async t=>{const s=setup(t),before=s.snapshot();await assert.rejects(s.recover(input,config));assertRetained(s,before);assert.equal(s.state.priceCalls.length,0);assert.deepEqual(s.rows('stripe_locks'),[]);});
test('owner email comparison is case insensitive',async t=>{const s=setup(t);assert.equal((await s.recover({actorEmail:'OWNER@EXAMPLE.COM'})).status,'recovered');});

for(const [table,column,value] of [
 ['stripe_checkouts','attempt_id','other'],['stripe_checkouts','state','open'],['stripe_checkouts','session_id','cs_test_known'],['stripe_checkouts','request_json',attemptFixture.request_json+' '],['stripe_checkouts','expires_at','2026-10-02T20:58:59.451Z'],['stripe_checkouts','mode','live'],
 ['customers','profile_json','{'],['customers','profile_json','{"isTest":false,"deliveryConsent":false}'],['customers','profile_json','{"isTest":true,"deliveryConsent":true}'],['customers','status','active'],['customers','payment_status','test_active'],['customers','subscription_id','sub_existing'],['customers','payment_customer_id','cus_existing'],
 ['founding_reservations','state','paid'],['founding_reservations','state','pending'],['founding_reservations','state','released'],['founding_reservations','expires_at','2099-01-01T00:00:00Z'],['founding_reservations','mode','live']
])test(`preflight rejects altered ${table}.${column}=${String(value).slice(0,70)}`,async t=>{const s=setup(t);s.update(table,column,value);const before=s.snapshot();await assert.rejects(s.recover());assertRetained(s,before);assert.equal(s.state.priceCalls.length,0);});
for(const table of ['customers','stripe_checkouts','founding_reservations'])test('missing '+table+' record fails closed',async t=>{const s=setup(t);s.db.db.exec('DELETE FROM '+table);const before=s.snapshot();await assert.rejects(s.recover());assertRetained(s,before);});

for(const [name,change] of [
 ['wrong account price identity',p=>p.id='price_otheraccount'],['live price',p=>p.livemode=true],['missing mode',p=>delete p.livemode],['inactive price',p=>p.active=false],['one-time price',p=>p.type='one_time'],['wrong currency',p=>p.currency='eur'],['wrong amount',p=>p.unit_amount=7900],['yearly recurrence',p=>p.recurring.interval='year'],['wrong interval count',p=>p.recurring.interval_count=2],['metered usage',p=>p.recurring.usage_type='metered'],['missing recurrence',p=>delete p.recurring]
])test('provider price verification rejects '+name,async t=>{const s=setup(t),before=s.snapshot();change(s.state.price);await assert.rejects(s.recover());assertRetained(s,before);assert.equal(s.state.lists.length,0);});
for(const [name,where,error] of [
 ['wrong account cannot retrieve pinned price','onPrice',Object.assign(Error('No such price'),{code:'resource_missing',statusCode:404})],
 ['price permission denied','onPrice',Object.assign(Error('more_permissions_required'),{statusCode:403})],
 ['session list permission denied','onList',Object.assign(Error('more_permissions_required'),{statusCode:403})],
 ['session list connection failure','onList',Error('synthetic network failure')]
])test(name+' retains the original checkout and releases only its own lock',async t=>{const s=setup(t),before=s.snapshot();s.state[where]=()=>{throw error;};await assert.rejects(s.recover());assertRetained(s,before);assert.deepEqual(s.rows('stripe_locks'),[]);});
for(const bad of [null,{}, {object:'other',data:[],has_more:false},{object:'list',data:null,has_more:false},{object:'list',data:[],has_more:'false'},page(Array.from({length:101},(_,i)=>session('cs_test_'+i))),page([null]),page([{}]),page([session('cs_live_bad')]),page([session('cs_test_mode',{livemode:true})]),page([session('cs_test_missing',{livemode:undefined})]),page([session('cs_test_duplicate'),session('cs_test_duplicate')]),page([],true)])test('malformed provider page fails closed: '+JSON.stringify(bad).slice(0,110),async t=>{const s=setup(t),before=s.snapshot();s.state.pages=[bad];await assert.rejects(s.recover());assertRetained(s,before);});
for(const [name,extra] of [['client reference',{client_reference_id:CUSTOMER}],['customer metadata',{metadata:{customer_id:CUSTOMER}}],['attempt metadata',{metadata:{checkout_attempt:ATTEMPT}}]])for(const status of ['open','complete','expired'])test(`any ${status} session matching ${name} blocks retirement`,async t=>{const s=setup(t),before=s.snapshot();s.state.pages=[page([session('cs_test_found',{status,...extra})])];await assert.rejects(s.recover());assertRetained(s,before);});
test('later-page matching session blocks retirement after unfiltered full-account scan',async t=>{const s=setup(t),before=s.snapshot();s.state.pages=[page([session('cs_test_page1')],true),page([session('cs_test_match',{metadata:{checkout_attempt:ATTEMPT},status:'expired'})])];await assert.rejects(s.recover());assertRetained(s,before);assert.deepEqual(s.state.lists,[[{limit:100}],[{limit:100,starting_after:'cs_test_page1'}]]);});
test('complete pagination archives inspected counts and exact monotonic cursors',async t=>{const s=setup(t);s.state.pages=[page([session('cs_test_1'),session('cs_test_2')],true),page([session('cs_test_3')],true),page()];await s.recover();const check=JSON.parse(s.rows('audit_events')[0].detail_json).providerEvidence.sessionCheck;assert.equal(check.pages,3);assert.equal(check.sessionsInspected,3);assert.deepEqual(s.state.lists,[[{limit:100}],[{limit:100,starting_after:'cs_test_2'}],[{limit:100,starting_after:'cs_test_3'}]]);});
test('repeated session across pages aborts instead of looping or proving absence',async t=>{const s=setup(t),before=s.snapshot();s.state.pages=[page([session('cs_test_repeat')],true),page([session('cs_test_repeat')],true)];await assert.rejects(s.recover());assertRetained(s,before);assert.equal(s.state.lists.length,2);});
test('pagination limit fails closed without accepting an incomplete scan',async t=>{const s=setup(t),before=s.snapshot();s.state.pages=Array.from({length:21},(_,i)=>page([session('cs_test_page'+i)],i<20));await assert.rejects(s.recover());assertRetained(s,before);assert.equal(s.state.lists.length,20);});
test('last allowed page succeeds only when the provider explicitly ends pagination',async t=>{const s=setup(t);s.state.pages=Array.from({length:20},(_,i)=>page([session('cs_test_page'+i)],i<19));assert.equal((await s.recover()).status,'recovered');assert.equal(s.state.lists.length,20);});

test('active competing checkout lease rejects recovery without provider calls or stealing its lock',async t=>{const s=setup(t),before=s.snapshot();const lock=await acquireStripeLock(s.db,lockId);const locks=s.rows('stripe_locks');await assert.rejects(s.recover(),/processing/);assertRetained(s,before);assert.deepEqual(s.rows('stripe_locks'),locks);assert.equal(s.state.priceCalls.length,0);await releaseStripeLock(s.db,lock);});
test('expired old checkout lease may be taken over and released after successful recovery',async t=>{const s=setup(t);s.db.db.prepare('INSERT INTO stripe_locks VALUES(?,?,?)').run(lockId,'old-token',Date.now()-1);assert.equal((await s.recover()).status,'recovered');assert.deepEqual(s.rows('stripe_locks'),[]);});
for(const stage of ['onPrice','onList','beforeBatch'])for(const theft of [false,true])test(`${theft?'stolen':'expired'} lease at ${stage} prevents archive and deletion`,async t=>{const s=setup(t),before=s.snapshot();const mutate=()=>s.db.db.prepare('UPDATE stripe_locks SET token=?,expires_at=? WHERE id=?').run(theft?'new-owner-token':s.rows('stripe_locks')[0].token,theft?Date.now()+120000:0,lockId);if(stage==='beforeBatch')s.db.beforeBatch=mutate;else s.state[stage]=mutate;await assert.rejects(s.recover());assertRetained(s,before);if(theft){assert.equal(s.rows('stripe_locks')[0].token,'new-owner-token');}else assert.deepEqual(s.rows('stripe_locks'),[]);});

// Mutate each captured field after provider reads, before the transaction begins.
for(const [table,fixture] of [['customers',customerFixture],['founding_reservations',reservationFixture],['stripe_checkouts',attemptFixture]])for(const [column,value] of Object.entries(fixture))test(`transaction rechecks concurrent mutation of ${table}.${column}`,async t=>{
 const s=setup(t);let afterMutation;s.db.beforeBatch=()=>{s.db.beforeBatch=null;s.update(table,column,typeof value==='number'?value+1:value===null?'new-concurrent-value':value+'-concurrent');afterMutation=s.snapshot();};
 await assert.rejects(s.recover());assertRetained(s,afterMutation);assert.equal(s.rows('audit_events').length,0);
});
for(const table of ['customers','founding_reservations','stripe_checkouts'])test('concurrent deletion of '+table+' prevents partial archive',async t=>{const s=setup(t);let afterMutation;s.db.beforeBatch=()=>{s.db.beforeBatch=null;s.db.db.exec('DELETE FROM '+table);afterMutation=s.snapshot();};await assert.rejects(s.recover());assertRetained(s,afterMutation);});
for(const failure of ['archive','delete','final guard'])test(failure+' write error rolls back whole archive/delete batch and permits a clean retry',async t=>{
 const s=setup(t),before=s.snapshot();const match=failure==='archive'?'INSERT INTO audit_events':failure==='delete'?'DELETE FROM stripe_checkouts':'SELECT CASE';
 s.db.beforeRun=sql=>{if(sql.startsWith(match))throw Error('synthetic '+failure+' failure');};await assert.rejects(s.recover(),/synthetic/);assertRetained(s,before);assert.deepEqual(s.rows('stripe_locks'),[]);s.db.beforeRun=null;assert.equal((await s.recover()).status,'recovered');
});
for(const [table,action] of [['audit_events','INSERT'],['stripe_checkouts','DELETE']])test('zero-row '+action+' is detected and rolls back the whole transaction',async t=>{const s=setup(t),before=s.snapshot();s.db.db.exec(`CREATE TRIGGER skip_recovery_write BEFORE ${action} ON ${table} BEGIN SELECT RAISE(IGNORE); END;`);await assert.rejects(s.recover());assertRetained(s,before);s.db.db.exec('DROP TRIGGER skip_recovery_write');assert.equal((await s.recover()).status,'recovered');});

test('recovery unlocks a fresh same-customer checkout with new request and idempotency key while retaining QA and founder place',async t=>{
 const s=setup(t);await assert.rejects(createStripeCheckout(s.db,env,s.rows('customers')[0],{ownerTest:true,client:s.client}),/reconciliation/);assert.equal(s.state.creates.length,0);
 await s.recover();const archived=s.rows('audit_events'),customers=s.rows('customers'),reservations=s.rows('founding_reservations');const result=await createStripeCheckout(s.db,env,s.rows('customers')[0],{ownerTest:true,client:s.client});
 assert.equal(result.mode,'test');assert.match(result.url,/^https:\/\/checkout\.stripe\.com\//);assert.equal(s.state.creates.length,1);const [{params,opts}]=s.state.creates;assert.equal(params.client_reference_id,CUSTOMER);assert.notEqual(params.metadata.checkout_attempt,ATTEMPT);assert.equal(params.metadata.checkout_attempt,s.rows('stripe_checkouts')[0].attempt_id);assert.equal(opts.idempotencyKey,'lob-checkout-'+params.metadata.checkout_attempt);assert.notEqual(opts.idempotencyKey,'lob-checkout-'+ATTEMPT);assert.notEqual(JSON.stringify(params),attemptFixture.request_json);assert.ok(params.expires_at*1000>Date.now()+30*60000);
 assert.deepEqual(s.rows('customers'),customers);assert.deepEqual(s.rows('founding_reservations'),reservations);assert.deepEqual(s.rows('audit_events'),archived);assert.equal(s.rows('stripe_checkouts')[0].session_id,'cs_test_fresh');
 const fresh=s.snapshot();assert.equal((await s.recover()).status,'already_recovered');assert.deepEqual(s.snapshot(),fresh);assert.equal(s.state.creates.length,1);
});
test('generic expired ambiguous attempts remain blocked by both checkout and narrow recovery',async t=>{const s=setup(t);s.update('stripe_checkouts','attempt_id','unreviewed-attempt');const before=s.snapshot();await assert.rejects(s.recover({attemptId:'unreviewed-attempt'}));await assert.rejects(createStripeCheckout(s.db,env,s.rows('customers')[0],{ownerTest:true,client:s.client}),/reconciliation/);assertRetained(s,before);assert.equal(s.state.priceCalls.length,0);});

for(const [name,change] of [
 ['missing object',s=>delete s.object],['wrong object',s=>s.object='customer'],['missing status',s=>delete s.status],['invalid status',s=>s.status='pending'],['missing client reference',s=>delete s.client_reference_id],['numeric client reference',s=>s.client_reference_id=123],['object client reference',s=>s.client_reference_id={}],['missing metadata',s=>delete s.metadata],['string metadata',s=>s.metadata='malformed'],['array metadata',s=>s.metadata=[]],['non-string metadata value',s=>s.metadata={customer_id:123}],['nested metadata value',s=>s.metadata={nested:{}}]
])test('malformed session '+name+' prevents a false absence proof',async t=>{const s=setup(t),before=s.snapshot(),item=session();change(item);s.state.pages=[page([item])];await assert.rejects(s.recover());assertRetained(s,before);});
test('provider session with explicit null customer reference and metadata is valid unrelated evidence',async t=>{const s=setup(t);s.state.pages=[page([session('cs_test_null',{client_reference_id:null,metadata:null})])];assert.equal((await s.recover()).status,'recovered');assert.equal(JSON.parse(s.rows('audit_events')[0].detail_json).providerEvidence.sessionCheck.sessionsInspected,1);});
test('the reviewed request cannot be retired before its original expiry',async t=>{const s=setup(t),before=s.snapshot();t.mock.method(Date,'now',()=>Date.parse(attemptFixture.expires_at)-1);await assert.rejects(s.recover());assertRetained(s,before);assert.equal(s.state.priceCalls.length,0);});
