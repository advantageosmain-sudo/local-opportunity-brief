// Companion audit test: local in-memory DB only. No Site edits, billing, email, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {currentReportDateKey} from '../lib/dashboard-policy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const unexpected=[];
const deny=async input=>{unexpected.push(String(input));throw Error('Network prohibited by offline audit');};
globalThis.fetch=deny;
const {default:worker}=await import(process.env.LOB_WORKER_MODULE??pathToFileURL(root+'/dist/server/index.js'));
const {generateReport,validateReport}=await import(pathToFileURL(root+'/automation/lib/engine.mjs'));
const {weeklyScheduleGuard}=await import(pathToFileURL(root+'/automation/lib/schedule.mjs'));
const {validateCurrentReportPacket}=await import(pathToFileURL(root+'/lib/report-sync.mjs'));
class D1{constructor(){this.db=new DatabaseSync(':memory:');}prepare(sql){let args=[];const q={bind(...v){args=v;return q;},_run:()=>({meta:{changes:Number(this.db.prepare(sql).run(...args).changes)}}),run:async()=>q._run(),first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}async batch(stmts){this.db.exec('BEGIN');try{const r=stmts.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}}
const origin='https://offline.example',ownerEmail='owner@example.com';
const owner={'oai-authenticated-user-email':ownerEmail,origin};
const today=currentReportDateKey(),datePlus=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);

test('offline QA intake/payment stays isolated; separate report sync -> exact owner form approval -> disabled delivery -> weekly selection',async t=>{
 const db=new D1();t.after(()=>db.db.close());
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})},OWNER_EMAIL:ownerEmail,REPORT_SYNC_SECRET:'synthetic-offline-sync',PAYMENTS_PROVIDER:'stripe',PAYMENTS_MODE:'test',STRIPE_API_KEY:'rk_test_SYNTHETIC',STRIPE_WEBHOOK_SECRET:'whsec_SYNTHETIC',STRIPE_PRICE_ID:'price_SYNTHETIC',PUBLIC_SITE_URL:origin,LIVE_DELIVERY:'0'};
 const ctx={waitUntil(){},passThroughOnException(){}};
 let customerId,attemptId;
 const providerCalls=[];
 const mockFetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url);providerCalls.push(req.method+' '+url.pathname);
  const json=x=>Response.json(x,{headers:{'request-id':'req_SYNTHETIC'}});
  if(url.origin==='https://api.stripe.com'&&req.method==='GET'&&url.pathname==='/v1/prices/price_SYNTHETIC')return json({id:'price_SYNTHETIC',object:'price',livemode:false,active:true,type:'recurring',currency:'usd',unit_amount:4900,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}});
  if(url.origin==='https://api.stripe.com'&&req.method==='POST'&&url.pathname==='/v1/checkout/sessions'){
   const p=new URLSearchParams(await req.text());attemptId=p.get('metadata[checkout_attempt]');assert.equal(p.get('client_reference_id'),customerId);assert.ok(attemptId);
   return json({id:'cs_test_SYNTHETIC',object:'checkout.session',livemode:false,status:'open',client_reference_id:customerId,metadata:{checkout_attempt:attemptId},url:'https://checkout.stripe.com/c/pay/SYNTHETIC'});
  }
  if(url.origin==='https://api.stripe.com'&&req.method==='GET'&&url.pathname==='/v1/subscriptions/sub_SYNTHETIC')return json({id:'sub_SYNTHETIC',object:'subscription',livemode:false,customer:'cus_SYNTHETIC',status:'active',metadata:{business:'local-opportunity-brief',customer_id:customerId,checkout_attempt:attemptId},items:{data:[{price:{id:'price_SYNTHETIC'},quantity:1}]},latest_invoice:{id:'in_SYNTHETIC',status:'paid'}});
  if(url.origin==='https://api.resend.com'&&req.method==='POST'&&url.pathname==='/emails') {
   const body=await req.json();assert.deepEqual(body.to,[ownerEmail]);assert.match(body.subject,/OFFLINE SYNTHETIC OWNER REVIEW/);return json({id:'email_SYNTHETIC'});
  }
  if(url.origin==='https://api.resend.com'&&req.method==='GET'&&url.pathname==='/emails/email_SYNTHETIC')return json({id:'email_SYNTHETIC',last_event:'delivered'});
  return deny(req.url);
 };
 const call=async(path,{body,headers={},method=body===undefined?'GET':'POST'}={})=>{globalThis.fetch=mockFetch;return worker.fetch(new Request(origin+path,{method,headers:{...(typeof body==='string'?{'content-type':'application/json'}:{}),...headers},...(body===undefined?{}:{body})}),env,ctx);};
 const json=(path,body,headers={})=>call(path,{body:JSON.stringify(body),headers});
 const internal={authorization:'Bearer synthetic-offline-sync'};
 const count=table=>db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
 const qa={contactName:'OWNER QA TEST',businessName:'OFFLINE AUDIT ONLY',email:ownerEmail,city:'Olympia',state:'WA',zip:'98501',category:'boutique',products:'gifts',customers:'adults',voice:'factual',localRadius:'35',qaAcknowledged:'yes'};
 const intake=await json('/api/owner/qa-intake',qa,owner);assert.equal(intake.status,201);customerId=(await intake.json()).customerId;
 const checkout=await json('/api/owner/stripe-checkout',{customerId},owner);assert.equal(checkout.status,200);assert.equal((await checkout.json()).mode,'test');
 const event={id:'evt_SYNTHETIC',object:'event',type:'invoice.paid',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'in_SYNTHETIC',parent:{subscription_details:{subscription:'sub_SYNTHETIC'}}}}};
 const raw=JSON.stringify(event),at=Math.floor(Date.now()/1000),signature='t='+at+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(at+'.'+raw).digest('hex');
 assert.equal((await call('/api/webhooks/stripe',{body:raw,headers:{'stripe-signature':signature}})).status,200);
 const paid=db.db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);assert.equal(paid.status,'test');assert.equal(paid.payment_status,'test_active');assert.equal(JSON.parse(paid.profile_json).deliveryConsent,false);
 assert.equal((await (await call('/api/internal/automation/customers',{headers:internal})).json()).customers.length,0);
 assert.equal(count('reports'),0);assert.equal(count('delivery_attempts'),0);
 // A QA payment cannot supply a customer report. This is a SEPARATE synthetic owner-only research packet.
 const profile={slug:'offline-owner-review',businessName:'OFFLINE SYNTHETIC OWNER REVIEW',deliveryEmail:'unused@local.invalid',deliveryMode:'owner_review_only',marketId:'olympia-wa',location:{city:'Olympia',state:'WA',radiusMiles:12},category:'gift-shop',products:['gifts'],customers:['adults'],voice:['factual'],exclusions:[]};
 const opportunities=[1,2,3,4,5].map(i=>({id:'offline-event-'+i,title:'OFFLINE ONLY Event '+i,eventDate:datePlus(i+1),prepareBy:today,city:'Olympia',state:'WA',geographyMode:'city_match',distanceMiles:null,marketId:'olympia-wa',geographyBasis:'SYNTHETIC same-city proof',sourceName:'SYNTHETIC official source',sourceUrl:'https://www.olympiawa.gov/offline-only-'+i,sourceCheckedAt:today,sourceAuthority:'official-government',sourceAccessStatus:'verified',sourceQuality:5,customerTags:['adults'],productTags:['gifts'],urgency:4,preparationEase:5,offerType:'small display'}));
 const report=generateReport(profile,opportunities,{asOf:today,fixture:false});
 const packet={schemaVersion:1,report,validation:validateReport(report)};
 assert.equal(packet.validation.passed,true);assert.equal((await validateCurrentReportPacket(packet)).passed,true);
 assert.equal((await json('/api/internal/reports',packet)).status,401);
 assert.equal((await json('/api/internal/reports',packet,internal)).status,201);
 assert.equal((await json('/api/internal/reports',packet,internal)).status,200);
 assert.equal(count('report_decisions'),0);
 const html=await (await call('/dashboard',{headers:{...owner,accept:'text/html'}})).text();
 const forms=html.match(/<form\b[\s\S]*?<\/form>/g)??[];
 const form=forms.find(x=>x.includes('value="'+report.reportId+'"')&&x.includes('name="decision"'));
 assert.ok(form,'Report approval form must be rendered');
 const actionName=form.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];assert.ok(actionName,'Use the actual rendered server-action identity');
 const decisionBody=(checksum=report.checksum)=>{const f=new FormData();f.set(actionName,'');f.set('reportId',report.reportId);f.set('checksum',checksum);f.set('decision','approve');f.set('decisionNote','Synthetic offline audit; no real report or provider');return f;};
 // Denied action paths may return 500 through framework error handling; the durable effect must be absent.
 const quiet=t.mock.method(console,'error',()=>{});
 await call('/dashboard',{body:decisionBody(),headers:{origin}});assert.equal(count('report_decisions'),0);
 await call('/dashboard',{body:decisionBody('0'.repeat(64)),headers:owner});assert.equal(count('report_decisions'),0);
 const approved=await call('/dashboard',{body:decisionBody(),headers:owner});assert.equal(approved.status,200);
 const decision=db.db.prepare('SELECT * FROM report_decisions WHERE report_id=?').get(report.reportId);assert.equal(decision.checksum,report.checksum);assert.equal(decision.actor_email,ownerEmail);assert.equal(decision.decision,'approve');
 assert.equal(db.db.prepare('SELECT status FROM reports WHERE id=?').get(report.reportId).status,'owner_approved');
 const callsBefore=providerCalls.length;
 const dry=await json('/api/internal/automation/deliver',{reportId:report.reportId,checksum:report.checksum},internal);assert.equal(dry.status,503);assert.match((await dry.json()).error,/not enabled/);assert.equal(providerCalls.length,callsBefore);assert.equal(count('delivery_attempts'),0);
 // Exercise the complete send/readback chain only against the deny-by-default mock.
 Object.assign(env,{LIVE_DELIVERY:'1',RESEND_API_KEY:'synthetic-email-only',DELIVERY_FROM_EMAIL:'sender@example.com'});
 const sent=await json('/api/internal/automation/deliver',{reportId:report.reportId,checksum:report.checksum},internal);
 assert.equal(sent.status,200);assert.equal((await sent.json()).status,'ACCEPTED');
 assert.equal(db.db.prepare('SELECT status FROM delivery_attempts').get().status,'accepted');
 assert.equal((await json('/api/internal/automation/deliver',{reportId:report.reportId,checksum:report.checksum},internal)).status,409);
 env.LIVE_DELIVERY='0';
 const receipt=await json('/api/internal/automation/reconcile-delivery',{},internal);assert.equal(receipt.status,200);
 assert.equal(db.db.prepare('SELECT status FROM delivery_attempts').get().status,'delivered');
 assert.equal(db.db.prepare('SELECT first_delivered_at FROM customers WHERE id=?').get(customerId).first_delivered_at,null,'Owner-only receipt never makes the QA customer deliverable');
 for(const [date,cron] of [['2026-10-05','17 14 * * 1'],['2026-11-02','17 15 * * 1']]){const guards=['17 14 * * 1','17 15 * * 1'].map(scheduledCron=>weeklyScheduleGuard({now:new Date(date+'T16:45:00Z'),eventName:'schedule',scheduledCron}));assert.equal(guards.filter(x=>x.enabled).length,1);assert.equal(guards.find(x=>x.enabled).expectedCron,cron);}
 assert.equal((await (await call('/api/internal/automation/customers',{headers:internal})).json()).customers.length,0);
 assert.deepEqual(unexpected,[]);assert.deepEqual(providerCalls,['GET /v1/prices/price_SYNTHETIC','POST /v1/checkout/sessions','GET /v1/subscriptions/sub_SYNTHETIC','POST /emails','GET /emails/email_SYNTHETIC']);
 quiet.mock.restore();
 console.log(JSON.stringify({offlineOnly:true,externalNetworkCalls:0,liveMutations:0,qaPayment:'test_active',qaScheduleEligible:false,reportId:report.reportId,exactOwnerApproval:true,delivery:'DISABLED_NO_ATTEMPT_THEN_MOCK_ACCEPTED_DELIVERED',dstGuard:'PASS'}));
});
