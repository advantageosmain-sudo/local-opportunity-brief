// Isolated Worker/SQLite regressions. No provider request or settings changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {reserveFoundingPlace} from '../lib/founding-capacity.mjs';
const {default:worker}=await import('../dist/server/index.js');
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){let args=[];const run=()=>{const r=this.db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};};const q={bind(...v){args=v;return q;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}
 async batch(stmts){this.db.exec('BEGIN');try{const r=stmts.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function setup(t){
 const db=new D1();t.after(()=>db.db.close());
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})},REPORT_SYNC_SECRET:'unit-only',PAYMENTS_PROVIDER:'lemon_squeezy',PAYMENTS_MODE:'test',LEMON_SQUEEZY_CHECKOUT_URL:'https://unit.lemonsqueezy.com/checkout/buy/unit-variant'};
 const ctx={waitUntil(){},passThroughOnException(){}};
 const call=(path,body,headers={},method=body?'POST':'GET')=>worker.fetch(new Request('https://localhost'+path,{method,headers:{'content-type':'application/json',authorization:'Bearer unit-only',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
 await call('/api/internal/operations');
 const customer=id=>{db.db.prepare("INSERT OR IGNORE INTO markets(id,city,state,zip,status) VALUES('unit-market','Olympia','WA','98501','verified')").run();db.db.prepare('INSERT INTO customers(id,email,business_name,profile_json,market_id) VALUES(?,?,?,?,?)').run(id,'unit@example.com','UNIT TEST ONLY',JSON.stringify({checkoutToken:'unit-checkout'}),'unit-market');};
 return {db,env,call,customer};
}
for (const provider of ['', 'Stripe', 'stripe_typo', 'lemon_squeezy_typo', ' lemon_squeezy ', 'unknown', false, {}, []]) {
 test(`unsupported provider ${JSON.stringify(provider)} cannot use legacy POST or DELETE even with legacy settings`,async t=>{
  const {db,env,call,customer}=await setup(t);const id='e'.repeat(64);customer(id);env.PAYMENTS_PROVIDER=provider;
  const response=await call('/api/checkout',{customerId:id,checkoutToken:'unit-checkout'});assert.equal(response.status,503);assert.match((await response.json()).error,/unsupported payment provider/i);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM founding_reservations').get().n,0);
  await reserveFoundingPlace(db,id,'test');
  const release=await call('/api/checkout',{customerId:id,checkoutToken:'unit-checkout'},{},'DELETE');assert.equal(release.status,503);assert.match((await release.json()).error,/unsupported payment provider/i);assert.equal(db.db.prepare('SELECT state FROM founding_reservations WHERE customer_id=?').get(id).state,'reserved');
  assert.equal((await call('/api/checkout',null,{},'POST')).status,503,'Configuration rejection precedes body parsing');
 });
}
test('omitted provider still defaults to Stripe and cannot release its hold through the legacy route',async t=>{
 const {db,env,call,customer}=await setup(t);const id='e'.repeat(64);customer(id);delete env.PAYMENTS_PROVIDER;
 const checkout=await call('/api/checkout',{customerId:id,checkoutToken:'unit-checkout'});assert.equal(checkout.status,503);assert.match((await checkout.json()).error,/Stripe/);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM founding_reservations').get().n,0);
 await reserveFoundingPlace(db,id,'test');assert.equal((await call('/api/checkout',{customerId:id,checkoutToken:'unit-checkout'},{},'DELETE')).status,409);assert.equal(db.db.prepare('SELECT state FROM founding_reservations').get().state,'reserved');
});
