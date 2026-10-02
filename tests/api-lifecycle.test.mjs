import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;let args=[];const api={bind(...v){args=v;return api;},async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)}}};return api;}
 async batch(stmts){this.db.exec('BEGIN');try{const out=[];for(const x of stmts)out.push(await x.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const {default:worker}=await import('../dist/server/index.js');
const db=new D1();
const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})},OWNER_EMAIL:'owner@example.com',REPORT_SYNC_SECRET:'test-only-sync',PAYMENTS_MODE:'test',LEMON_SQUEEZY_WEBHOOK_SECRET:'test-only-webhook',LEMON_SQUEEZY_VARIANT_ID:'v1'};
const ctx={waitUntil(){},passThroughOnException(){}};
const call=(path,body,headers={})=>worker.fetch(new Request(`https://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
test('hosted intake validates, deduplicates and maps customer/market',async()=>{
 assert.equal((await call('/api/intake',{email:'bad'})).status,400);
 const p={contactName:'Owner',businessName:'Test Boutique',email:'test@example.com',city:'Olympia',state:'WA',zip:'98501',category:'boutique',products:'gifts, apparel',customers:'families',voice:'friendly',localRadius:'35',consent:'yes',deliveryConsent:'yes',termsAccepted:'yes',noGuaranteeAccepted:'yes'};
 const first=await call('/api/intake',p);assert.equal(first.status,201);const result=await first.json();assert.ok(result.checkoutToken);
 const repeat=await call('/api/intake',p);assert.equal(repeat.status,200);assert.equal((await repeat.json()).checkoutToken,undefined);
 assert.equal(db.db.prepare('SELECT count(*) n FROM customers').get().n,1);
});
test('internal APIs reject missing/wrong credentials and do not leak checkout token',async()=>{
 assert.equal((await call('/api/internal/operations')).status,401);
 const res=await call('/api/internal/operations',null,{authorization:'Bearer test-only-sync'});assert.equal(res.status,200);assert.doesNotMatch(await res.text(),/checkoutToken/);
});
test('actual signed webhook handles invoice failures, duplicate and sticky cancel',async()=>{
 const id=db.db.prepare('SELECT id FROM customers').get().id;
 db.db.prepare("UPDATE customers SET subscription_id='sub1',status='canceled' WHERE id=?").run(id);
 const p={meta:{event_name:'subscription_payment_failed'},data:{id:'invoice1',attributes:{subscription_id:'sub1',test_mode:true,updated_at:'2026-10-02T05:00:00Z'}}};
 const raw=JSON.stringify(p);const headers={'x-signature':createHmac('sha256','test-only-webhook').update(raw).digest('hex'),'x-event-name':p.meta.event_name};
 assert.equal((await call('/api/webhooks/lemon-squeezy',p,headers)).status,200);
 assert.equal(db.db.prepare('SELECT status FROM customers').get().status,'canceled');
 assert.equal((await (await call('/api/webhooks/lemon-squeezy',p,headers)).json()).status,'DUPLICATE_IGNORED');
 assert.equal((await call('/api/webhooks/lemon-squeezy',p)).status,401);
});
