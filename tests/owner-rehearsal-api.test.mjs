// Actual compiled routes + real SQLite. Synthetic provider, with independent socket guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
const {default:worker}=await import('../dist/server/index.js');
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.beforeRun=null;}
 prepare(sql){let args=[];const run=()=>{this.beforeRun?.(sql);const r=this.db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};};const q={bind(...v){args=v;return q;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}
 async batch(stmts){this.db.exec('BEGIN');try{const r=stmts.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const hash=r=>{delete r.checksum;r.checksum=createHash('sha256').update(JSON.stringify(r)).digest('hex');return r;};
function setup(t){
 const db=new D1();t.after(()=>db.db.close());
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})},OWNER_EMAIL:'owner@example.com',REPORT_SYNC_SECRET:'SYNTHETIC',LIVE_DELIVERY:'0',RESEND_API_KEY:'SYNTHETIC',DELIVERY_FROM_EMAIL:'sender@example.com',OWNER_REHEARSAL_ENABLED:'1'};
 const state={calls:[],event:'delivered',receiptId:'synthetic-message',providerFail:false,expectedTo:'owner@example.com'};
 const noNetwork=()=>{throw Error('Independent test guard: real network prohibited');};
 t.mock.method(net.Socket.prototype,'connect',noNetwork);t.mock.method(tls,'connect',noNetwork);t.mock.method(http,'request',noNetwork);t.mock.method(https,'request',noNetwork);
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  state.calls.push({url:String(url),options});
  if(options.method==='POST'){
   assert.equal(String(url),'https://api.resend.com/emails');assert.deepEqual(JSON.parse(options.body).to,[state.expectedTo]);
   if(state.providerFail)throw Error('Synthetic uncertain result');
   return Response.json({id:'synthetic-message'});
  }
  assert.equal(String(url),'https://api.resend.com/emails/synthetic-message');
  return Response.json({id:state.receiptId,last_event:state.event});
 });
 const call=(path,body,auth=true)=>worker.fetch(new Request('https://localhost/api/internal/automation/'+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer SYNTHETIC'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil(){},passThroughOnException(){}});
 const today=new Date().toISOString().slice(0,10),future=new Date(Date.now()+4*864e5).toISOString().slice(0,10);
 const report=hash({schemaVersion:1,reportId:'owner-rehearsal-'+today,generatedAt:new Date().toISOString(),asOf:today,weekOf:today,customer:{slug:'owner-rehearsal',businessName:'Synthetic owner rehearsal',deliveryEmail:'owner@example.com',location:{city:'Olympia',state:'WA',radiusMiles:35},deliveryMode:'owner_review_only',marketId:'unit-market'},fixture:false,status:'PENDING_APPROVAL',lookaheadDays:30,deliveryEligible:false,summary:'Unit test',opportunities:Array.from({length:5},(_,i)=>({id:'unit-'+i,title:'Unit test '+i,score:80,daysAway:4,eventDate:future,prepareBy:today,location:'Olympia, WA',distanceMiles:1,marketId:'unit-market',why:'Unit test',offer:'Unit test',firstAction:'Unit test',caption:'Unit test',emailSubject:'Unit test',emailBody:'Unit test',guidance:'Unit test',evidence:{sourceUrl:'https://www.olympiawa.gov/unit-test-only-'+i,sourceName:'UNIT TEST ONLY',checkedAt:today,authority:'official-government',accessStatus:'verified',confidence:'high'}})),safeguards:{liveDelivery:false,ownerApprovalRequired:true}});
 const packet=()=>JSON.stringify({schemaVersion:1,report,validation:{passed:true,errors:[]}});
 const pin=()=>Object.assign(env,{OWNER_REHEARSAL_REPORT_ID:report.reportId,OWNER_REHEARSAL_CHECKSUM:report.checksum,OWNER_REHEARSAL_RECIPIENT:env.OWNER_EMAIL});
 const payload=()=>({reportId:report.reportId,checksum:report.checksum,expectedRecipient:env.OWNER_EMAIL});
 const seed=async({approved=true}={})=>{
  pin();assert.equal((await call('deliver',payload())).status,404);
  db.db.prepare("INSERT INTO markets(id,city,state,zip) VALUES('unit-market','Olympia','WA','98501')").run();
  db.db.prepare("INSERT INTO customers(id,email,business_name,profile_json,market_id,payment_status,onboarding_status,status) VALUES(?,?,'Synthetic','{\"deliveryConsent\":true}','unit-market','active','complete','active')").run(report.customer.slug,env.OWNER_EMAIL);
  db.db.prepare("INSERT INTO reports(id,customer_slug,business_name,week_of,status,report_json) VALUES(?,?,'Synthetic',?,'owner_approved',?)").run(report.reportId,report.customer.slug,today,packet());
  if(approved)db.db.prepare("INSERT INTO report_decisions VALUES(?,?,'approve','owner@example.com',?,'Synthetic')").run(report.reportId,report.checksum,today);
 };
 return {db,env,state,call,report,pin,payload,seed,packet};
}
for(const [name,change,status] of [
 ['switch missing',s=>delete s.env.OWNER_REHEARSAL_ENABLED,503],['switch off',s=>s.env.OWNER_REHEARSAL_ENABLED='0',503],
 ['wrong report pin',s=>s.env.OWNER_REHEARSAL_REPORT_ID='other-report',409],['wrong hash pin',s=>s.env.OWNER_REHEARSAL_CHECKSUM='0'.repeat(64),409],
 ['wrong recipient pin',s=>s.env.OWNER_REHEARSAL_RECIPIENT='other@example.com',409],['missing recipient pin',s=>delete s.env.OWNER_REHEARSAL_RECIPIENT,409],
 ['missing owner',s=>delete s.env.OWNER_EMAIL,409],['missing provider',s=>delete s.env.RESEND_API_KEY,503],
])test('owner rehearsal blocks '+name,async t=>{const s=setup(t);await s.seed();change(s);assert.equal((await s.call('deliver',s.payload())).status,status);assert.equal(s.state.calls.length,0);});
for(const [name,change] of [
 ['wrong request id',p=>p.reportId='other-report'],['wrong request hash',p=>p.checksum='0'.repeat(64)],['wrong request recipient',p=>p.expectedRecipient='other@example.com'],['missing request recipient',p=>delete p.expectedRecipient]
])test('owner rehearsal rejects '+name,async t=>{const s=setup(t);await s.seed();const p=s.payload();change(p);assert.ok((await s.call('deliver',p)).status>=400);assert.equal(s.state.calls.length,0);});
test('owner rehearsal requires authentication and exact approval',async t=>{const s=setup(t);await s.seed({approved:false});assert.equal((await s.call('deliver',s.payload(),false)).status,401);assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal(s.state.calls.length,0);});
for(const [name,edit] of [
 ['customer mode',r=>{r.customer.deliveryMode='customer';r.deliveryEligible=true;}],
 ['QA slug',r=>r.customer.slug='qa-owner'],['QA report marker',r=>r.customer.isTest=true],
 ['fixture',r=>r.fixture=true],['stale sources',r=>r.opportunities.forEach(o=>o.evidence.checkedAt='2020-01-01')]
])test('owner rehearsal blocks '+name,async t=>{const s=setup(t);edit(s.report);hash(s.report);await s.seed();assert.ok((await s.call('deliver',s.payload())).status>=400);assert.equal(s.state.calls.length,0);});
for(const sql of ["UPDATE customers SET status='test'","UPDATE customers SET payment_status='test_active'","UPDATE customers SET profile_json='{\"isTest\":true,\"deliveryConsent\":true}'"])
 test('QA database guard '+sql,async t=>{const s=setup(t);await s.seed();s.db.db.exec(sql);assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal(s.state.calls.length,0);});
for(const sql of ["DELETE FROM report_decisions","UPDATE reports SET report_json=json_set(report_json,'$.report.customer.deliveryMode','customer')","UPDATE customers SET profile_json='{\"isTest\":true}'"])
 test('atomic owner claim rechecks '+sql,async t=>{const s=setup(t);await s.seed();s.db.beforeRun=q=>{if(q.includes('INSERT OR IGNORE INTO delivery_attempts'))s.db.db.exec(sql);};assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal(s.state.calls.length,0);});
test('exact owner success dedupes; receipt after gate off never activates customer',async t=>{
 const s=setup(t);await s.seed();const response=await s.call('deliver',s.payload());assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ACCEPTED',reportId:s.report.reportId,checksum:s.report.checksum,providerMessageId:'synthetic-message',ownerTest:true});
 assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal(s.state.calls.length,1);
 s.env.OWNER_REHEARSAL_ENABLED='0';
 // Receipt eligibility does not depend on the packet's date or attempt age.
 s.db.db.exec("UPDATE delivery_attempts SET created_at='2020-01-01'");
 const receipt=await s.call('reconcile-delivery',s.payload());assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),{checked:1,confirmed:1,failed:0,reportId:s.report.reportId,checksum:s.report.checksum,deliveryStatus:'delivered',receiptEvent:'delivered'});assert.equal(s.state.calls.length,2);
 assert.equal(s.db.db.prepare('SELECT first_delivered_at FROM customers').get().first_delivered_at,null);assert.equal(s.db.db.prepare('SELECT first_approved_at FROM markets').get().first_approved_at,null);assert.equal(s.env.LIVE_DELIVERY,'0');
});
for(const [name,change] of [
 ['wrong recipient',s=>s.env.OWNER_REHEARSAL_RECIPIENT='wrong@example.com'],['wrong durable checksum',s=>s.db.db.exec("UPDATE delivery_attempts SET checksum='wrong'")],['wrong durable recipient',s=>s.db.db.exec("UPDATE delivery_attempts SET recipient='wrong@example.com'")],['missing approval',s=>s.db.db.exec('DELETE FROM report_decisions')],['customer report',s=>s.db.db.exec("UPDATE reports SET report_json=json_set(report_json,'$.report.customer.deliveryMode','customer')")],['unknown send lock',s=>s.db.db.exec("UPDATE delivery_attempts SET status='unknown'")]
])test('targeted receipt fails closed for '+name,async t=>{const s=setup(t);await s.seed();await s.call('deliver',s.payload());change(s);assert.equal((await s.call('reconcile-delivery',s.payload())).status,409);assert.equal(s.state.calls.length,1);});
test('targeted receipt missing attempt and partial selector never scan batch',async t=>{const s=setup(t);await s.seed();assert.equal((await s.call('reconcile-delivery',s.payload())).status,409);assert.equal((await s.call('reconcile-delivery',{reportId:s.report.reportId})).status,409);assert.equal(s.state.calls.length,0);});
for(const [event,counts,status] of [['sent',{checked:1,confirmed:0,failed:0},'accepted'],['bounced',{checked:1,confirmed:0,failed:1},'failed']])test('targeted receipt distinguishes '+event,async t=>{const s=setup(t);await s.seed();await s.call('deliver',s.payload());s.state.event=event;const r=await s.call('reconcile-delivery',s.payload());assert.equal(r.status,200);assert.deepEqual(await r.json(),{...counts,reportId:s.report.reportId,checksum:s.report.checksum,deliveryStatus:status,receiptEvent:event});assert.equal(s.db.db.prepare('SELECT status FROM delivery_attempts').get().status,status);assert.equal(s.db.db.prepare('SELECT delivery_status FROM customers').get().delivery_status,'pending');});
test('uncertain sends remain locked',async t=>{const s=setup(t);await s.seed();s.state.providerFail=true;assert.equal((await s.call('deliver',s.payload())).status,502);assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal((await s.call('reconcile-delivery',s.payload())).status,409);assert.equal(s.state.calls.length,1);});
test('targeted receipt accepts a now-stale approved packet after sends disabled',async t=>{const s=setup(t);await s.seed();assert.equal((await s.call('deliver',s.payload())).status,200);s.env.OWNER_REHEARSAL_ENABLED='0';t.mock.timers.enable({apis:['Date'],now:Date.now()+60*864e5});const r=await s.call('reconcile-delivery',s.payload());assert.equal(r.status,200);assert.deepEqual(await r.json(),{checked:1,confirmed:1,failed:0,reportId:s.report.reportId,checksum:s.report.checksum,deliveryStatus:'delivered',receiptEvent:'delivered'});});
test('targeted receipt mismatch preserves accepted lock and reports unverified',async t=>{const s=setup(t);await s.seed();await s.call('deliver',s.payload());s.state.receiptId='different-message';const r=await s.call('reconcile-delivery',s.payload());assert.equal(r.status,502);assert.equal((await r.json()).code,'PROVIDER_RECEIPT_ID_MISMATCH');assert.equal(s.db.db.prepare('SELECT status FROM delivery_attempts').get().status,'accepted');assert.equal((await s.call('deliver',s.payload())).status,409);});
test('unknown delivery modes cannot use rehearsal or customer release',async t=>{const s=setup(t);s.report.customer.deliveryMode='unexpected';hash(s.report);await s.seed();s.env.LIVE_DELIVERY='1';assert.equal((await s.call('deliver',s.payload())).status,409);assert.equal(s.state.calls.length,0);});

for(const [name,edit] of [['wrong recipient',p=>p.expectedRecipient='wrong@example.com'],['null recipient',p=>p.expectedRecipient=null]])test('live delivery never ignores supplied '+name,async t=>{const s=setup(t);await s.seed();s.env.LIVE_DELIVERY='1';const p=s.payload();edit(p);assert.equal((await s.call('deliver',p)).status,409);assert.equal(s.state.calls.length,0);});

for(const flag of ['0',undefined])test('explicit owner selector requires rehearsal switch even when live delivery enabled: '+flag,async t=>{const s=setup(t);await s.seed();s.env.LIVE_DELIVERY='1';s.env.OWNER_REHEARSAL_ENABLED=flag;assert.equal((await s.call('deliver',s.payload())).status,503);assert.equal(s.state.calls.length,0);});
test('legacy owner send without selector remains permitted by live gate',async t=>{const s=setup(t);await s.seed();s.env.LIVE_DELIVERY='1';s.env.OWNER_REHEARSAL_ENABLED='0';const p=s.payload();delete p.expectedRecipient;assert.equal((await s.call('deliver',p)).status,200);assert.equal(s.state.calls.length,1);});

for (const event of ['bounced','complained','failed','suppressed','canceled']) test('exact failed receipt remains readable without resend or batch admission: '+event, async t => {
 const s=setup(t);await s.seed();assert.equal((await s.call('deliver',s.payload())).status,200);
 s.state.event=event;
 const expected={checked:1,confirmed:0,failed:1,reportId:s.report.reportId,checksum:s.report.checksum,deliveryStatus:'failed',receiptEvent:event};
 for(let attempt=0;attempt<2;attempt++){
  const response=await s.call('reconcile-delivery',s.payload());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);
 }
 assert.equal(s.state.calls.length,3,'One send plus two exact provider reads');
 assert.equal(s.db.db.prepare('SELECT status FROM delivery_attempts').get().status,'failed');
 assert.equal((await s.call('deliver',s.payload())).status,409,'Failed receipt preserves the unique send lock');
 for(const body of [undefined,{}]){
  const response=await s.call('reconcile-delivery',body);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{checked:0,confirmed:0,failed:0});
 }
 assert.equal(s.state.calls.length,3,'Failed owner attempts remain excluded from generic batch');
 assert.equal(s.db.db.prepare('SELECT first_delivered_at FROM customers').get().first_delivered_at,null);
 assert.equal(s.db.db.prepare('SELECT first_approved_at FROM markets').get().first_approved_at,null);
 assert.equal(s.db.db.prepare('SELECT delivery_status FROM customers').get().delivery_status,'pending');
});


test('approved alternate rehearsal recipient leaves login ownership unchanged',async t=>{
 const s=setup(t);await s.seed();
 const alternate='approved-destination@example.com';
 s.env.OWNER_REHEARSAL_RECIPIENT=alternate;s.state.expectedTo=alternate;
 const payload={...s.payload(),expectedRecipient:alternate};
 assert.equal((await s.call('deliver',s.payload())).status,409,'Login address cannot replace the approved destination');
 assert.equal((await s.call('deliver',payload)).status,200);
 assert.equal(s.db.db.prepare('SELECT recipient FROM delivery_attempts').get().recipient,alternate);
 assert.equal((await s.call('deliver',payload)).status,409,'Pinned alternate send remains deduplicated');
 s.env.OWNER_REHEARSAL_ENABLED='0';
 const receipt=await s.call('reconcile-delivery',payload);assert.equal(receipt.status,200);assert.equal((await receipt.json()).deliveryStatus,'delivered');
 assert.equal((await s.call('reconcile-delivery',s.payload())).status,409,'Receipt must match durable approved destination');
 assert.equal(s.env.OWNER_EMAIL,'owner@example.com');assert.equal(s.env.LIVE_DELIVERY,'0');
 assert.equal(s.db.db.prepare('SELECT first_delivered_at FROM customers').get().first_delivered_at,null);
 assert.equal(s.db.db.prepare('SELECT first_approved_at FROM markets').get().first_approved_at,null);
 const {REJECTED_CHECKOUT}=await import('../lib/stripe-checkout-recovery.mjs');
 const authCheck=email=>worker.fetch(new Request(REJECTED_CHECKOUT.origin+'/api/owner/stripe-checkout-recovery',{method:'POST',headers:{'content-type':'application/json',origin:REJECTED_CHECKOUT.origin,'oai-authenticated-user-email':email},body:'{}'}),s.env,{waitUntil(){},passThroughOnException(){}});
 assert.equal((await authCheck(alternate)).status,403,'Recipient pin grants no owner access');
 assert.equal((await authCheck('owner@example.com')).status,400,'Original owner remains authenticated; invalid recovery payload fails before work');
 assert.equal(s.state.calls.length,2,'Only the mocked send and exact receipt were called');
});
for(const recipient of ['', 'invalid', 'Name <person@example.com>', 'person@example.com\n'])test('malformed alternate recipient pin fails closed: '+JSON.stringify(recipient),async t=>{const s=setup(t);await s.seed();s.env.OWNER_REHEARSAL_RECIPIENT=recipient;const p={...s.payload(),expectedRecipient:recipient};assert.equal((await s.call('deliver',p)).status,409);assert.equal((await s.call('reconcile-delivery',p)).status,409);assert.equal(s.state.calls.length,0);});
