import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {foundingSchema,reserveFoundingPlace,releaseUnpaidPlace} from '../lib/founding-capacity.mjs';
function database(){const db=new DatabaseSync(':memory:');db.exec(foundingSchema);db.exec("CREATE TABLE diagnostics(status TEXT,code TEXT);CREATE TABLE customers(id TEXT,subscription_id TEXT,payment_status TEXT);");return {db,prepare(sql){let args=[];const q={bind(...v){args=v;return q},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},async first(){return db.prepare(sql).get(...args)}};return q}}}
test('ten concurrent reservations, duplicate stable expiry, eleventh denied, expiry frees unpaid',async()=>{
 const d=database(),now=new Date('2026-10-02T06:00:00Z');
 const results=await Promise.all(Array.from({length:11},(_,i)=>reserveFoundingPlace(d,'c'+i,'test',now)));
 assert.equal(results.filter(Boolean).length,10);assert.equal(results[10],null);
 assert.deepEqual(await reserveFoundingPlace(d,'c0','test',new Date(+now+60000)),results[0]);
 assert.ok(await reserveFoundingPlace(d,'c10','test',new Date(+now+31*60000)));
});
test('cancel unpaid releases capacity; paid founder retained after cancellation; test/live separate',async()=>{
 const d=database(),now=new Date('2026-10-02T06:00:00Z');
 for(let i=0;i<10;i++)await reserveFoundingPlace(d,'c'+i,'live',now);
 d.db.prepare("UPDATE founding_reservations SET state='paid' WHERE customer_id='c0'").run();
 await releaseUnpaidPlace(d,'c0','live');assert.equal(d.db.prepare("SELECT state FROM founding_reservations WHERE customer_id='c0'").get().state,'paid');
 assert.equal(await reserveFoundingPlace(d,'c10','live',now),null);
 await releaseUnpaidPlace(d,'c1','live');assert.ok(await reserveFoundingPlace(d,'c10','live',now));
 assert.ok(await reserveFoundingPlace(d,'c0','test',now));
});
