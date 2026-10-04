import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assessMarketSources,sourceRegistryChecksum,approveExactMarketSources} from '../lib/source-review.mjs';

const today='2026-10-04',marketId='synthetic-review-market';
const plus=(date,count)=>new Date(Date.parse(date+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
function pack(asOf=today){return {fixture:false,marketId,sourceFile:'synthetic-reviewed.json',opportunities:[1,2,3,4,5].map(i=>({id:'synthetic-source-'+i,title:'SYNTHETIC ONLY '+i,eventDate:plus(asOf,i+1),prepareBy:asOf,city:'Olympia',state:'WA',geographyMode:'city_match',distanceMiles:null,marketId,geographyBasis:'SYNTHETIC same-city fixture',sourceName:'SYNTHETIC official source',sourceUrl:'https://www.olympiawa.gov/synthetic-'+i,sourceCheckedAt:asOf,sourceAuthority:'official-government',sourceAccessStatus:'verified',sourceQuality:5,customerTags:['adults'],productTags:['gifts'],urgency:4,preparationEase:5,offerType:'small display',sourceReceipt:{bodySha256:'a'.repeat(64),fetchedAt:asOf+'T01:00:00Z',configuredUrl:'https://www.olympiawa.gov/synthetic-feed'}}))};}
function market(source=pack(),status='pending_review'){return {id:marketId,city:'Olympia',state:'WA',status,source_registry_json:JSON.stringify([source])};}
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');this.beforeRun=null;}
 prepare(sql){let args=[];const run=()=>{this.beforeRun?.(sql);return {meta:{changes:Number(this.db.prepare(sql).run(...args).changes)}};};const q={bind(...v){args=v;return q;},run:async()=>run(),_run:run,first:async()=>this.db.prepare(sql).get(...args)??null,all:async()=>({results:this.db.prepare(sql).all(...args)})};return q;}
 async batch(statements){this.db.exec('BEGIN');try{const result=statements.map(s=>s._run());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}

test('read-only source queue distinguishes pending, approved and soon-expiring evidence without changing bytes',()=>{
 const row=market(),before=JSON.stringify(row),pending=assessMarketSources(row,{asOf:today});assert.equal(pending.canApprove,true);assert.equal(pending.approved,false);assert.deepEqual(pending.reasons,['OWNER_SOURCE_APPROVAL_REQUIRED']);assert.equal(pending.validThrough,'2026-10-17');assert.equal(JSON.stringify(row),before);
 assert.equal(assessMarketSources({...row,status:'verified'},{asOf:today}).approved,true);
 const later=pack();for(const opportunity of later.opportunities){opportunity.eventDate='2026-10-20';opportunity.prepareBy='2026-10-15';}later.opportunities.forEach((item,i)=>item.sourceUrl+='?unique='+i);
 assert.deepEqual(assessMarketSources(market(later,'verified'),{asOf:'2026-10-15'}).warnings,['SOURCE_REFRESH_DUE']);
});

for(const [label,mutate,code]of [
 ['missing',row=>row.source_registry_json='[]','SOURCE_PACKS_MISSING'],
 ['invalid JSON',row=>row.source_registry_json='{','SOURCE_REGISTRY_INVALID'],
 ['null registry',row=>row.source_registry_json='null','SOURCE_REGISTRY_INVALID'],
 ['wrong market',(_row,p)=>p.marketId='other-market','SOURCE_MARKET_MISMATCH'],
 ['opportunity market',(_row,p)=>p.opportunities.forEach(item=>item.marketId='other-market'),'OPPORTUNITY_MARKET_MISMATCH'],
 ['past preparation',(_row,p)=>p.opportunities.forEach(item=>item.prepareBy='2026-10-03'),'PREPARATION_WINDOW_INVALID'],
 ['preparation after event',(_row,p)=>p.opportunities[0].prepareBy='2026-11-01','PREPARATION_WINDOW_INVALID'],
 ['false city match',(_row,p)=>p.opportunities.forEach(item=>item.city='Seattle'),'SOURCE_GEOGRAPHY_MISMATCH'],
 ['fixture',(_row,p)=>p.fixture=true,'SOURCE_VERIFICATION_REQUIRED'],
 ['candidate',(_row,p)=>p.candidateOnly=true,'SOURCE_VERIFICATION_REQUIRED'],
 ['unverified',(_row,p)=>p.opportunities[0].sourceAccessStatus='pending-owner-validation','SOURCE_VERIFICATION_REQUIRED'],
 ['stale',(_row,p)=>p.opportunities[0].sourceCheckedAt='2026-09-01','SOURCE_FRESHNESS_EXPIRED'],
 ['boundary freshness',(_row,p)=>p.opportunities[0].sourceCheckedAt='2026-09-20','SOURCE_FRESHNESS_EXPIRED'],
 ['future check',(_row,p)=>p.opportunities[0].sourceCheckedAt='2026-11-01','SOURCE_CHECK_DATE_IN_FUTURE'],
 ['missing check',(_row,p)=>p.opportunities[0].sourceCheckedAt=null,'SOURCE_CHECK_DATE_REQUIRED'],
 ['past events',(_row,p)=>p.opportunities.forEach(item=>item.eventDate='2026-10-01'),'INSUFFICIENT_CURRENT_OPPORTUNITIES'],
 ['four events',(_row,p)=>p.opportunities.pop(),'INSUFFICIENT_CURRENT_OPPORTUNITIES'],
 ['duplicate event',(_row,p)=>p.opportunities[1]={...p.opportunities[0],id:'distinct-id'},'DUPLICATE_SOURCE_OPPORTUNITY'],
 ['null opportunity',(_row,p)=>p.opportunities[0]=null,'SOURCE_REGISTRY_INVALID'],
])test('source queue blocks '+label,()=>{const p=pack(),row=market(p);mutate(row,p);if(!['missing','invalid JSON','null registry'].includes(label))row.source_registry_json=JSON.stringify([p]);const result=assessMarketSources(row,{asOf:today});assert.equal(result.canApprove,false);assert.ok(result.reasons.includes(code),JSON.stringify(result));if(['opportunity market','past preparation','false city match'].includes(label))assert.equal(result.currentOpportunityCount,0);});

test('exact source approval records provenance, preserves delivery history, and rejects repeats, stale evidence and concurrent replacement',async t=>{
 const db=new D1();t.after(()=>db.db.close());db.db.exec("CREATE TABLE markets(id TEXT,city TEXT,state TEXT,status TEXT,source_registry_json TEXT,first_approved_at TEXT);CREATE TABLE audit_events(id TEXT,event_type TEXT,subject_id TEXT,actor_email TEXT,detail_json TEXT)");
 const row=market();db.db.prepare('INSERT INTO markets(id,status,source_registry_json,city,state) VALUES(?,?,?,?,?)').run(row.id,row.status,row.source_registry_json,'Olympia','WA');
 const sourceChecksum=await sourceRegistryChecksum(row.source_registry_json),input={marketId,sourceChecksum,actor:'owner@example.com',asOf:today};
 await assert.rejects(approveExactMarketSources(db,{...input,sourceChecksum:'0'.repeat(64)}),/changed/);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
 await approveExactMarketSources(db,input);assert.equal(db.db.prepare('SELECT status FROM markets').get().status,'verified');assert.equal(db.db.prepare('SELECT first_approved_at FROM markets').get().first_approved_at,null);assert.equal(JSON.parse(db.db.prepare('SELECT detail_json FROM audit_events').get().detail_json).sourceChecksum,sourceChecksum);
 await assert.rejects(approveExactMarketSources(db,input),/pending/);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
 db.db.prepare("UPDATE markets SET status='pending_review'").run();await assert.rejects(approveExactMarketSources(db,{...input,asOf:'2026-10-20'}),/Current/);
 db.beforeRun=sql=>{if(sql.startsWith('UPDATE markets'))db.db.prepare("UPDATE markets SET source_registry_json='[]'").run();};
 await assert.rejects(approveExactMarketSources(db,input));assert.equal(db.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);assert.equal(db.db.prepare('SELECT status FROM markets').get().status,'pending_review');assert.equal(db.db.prepare('SELECT source_registry_json FROM markets').get().source_registry_json,row.source_registry_json);
});

// Install a deny-all transport before importing vinext, which captures fetch.
const unexpected=[];const deny=async input=>{unexpected.push(String(input));throw Error('Network prohibited in source review tests');};globalThis.fetch=deny;
const {default:worker}=await import('../dist/server/index.js');
test('actual source upload, owner queue approval and weekly export preserve exact review boundaries offline',async t=>{
 const db=new D1();t.after(()=>db.db.close());const asOf=new Date().toISOString().slice(0,10),origin='https://offline.example',owner={'oai-authenticated-user-email':'owner@example.com',origin},internal={authorization:'Bearer synthetic-only'},env={DB:db,OWNER_EMAIL:'owner@example.com',REPORT_SYNC_SECRET:'synthetic-only',ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};
 const call=(path,{body,headers={},method=body===undefined?'GET':'POST'}={})=>{globalThis.fetch=deny;return worker.fetch(new Request(origin+path,{method,headers:{...(typeof body==='string'?{'content-type':'application/json'}:{}),...headers},...(body===undefined?{}:{body})}),env,ctx);};
 const submit=p=>call('/api/internal/markets',{body:JSON.stringify(p),headers:internal});
 assert.equal((await call('/api/internal/operations',{headers:internal})).status,200);
 const p=pack(asOf),payload={marketId,sourcePacks:[p]};assert.equal((await submit(payload)).status,404);
 db.db.prepare("INSERT INTO markets(id,city,state,zip,status) VALUES(?,'Olympia','WA','98501','source_discovery_required')").run(marketId);
 db.db.prepare("INSERT INTO customers(id,email,business_name,profile_json,market_id,payment_status,onboarding_status,status,require_every_review,first_delivered_at) VALUES(?,'synthetic@retailer.co','SYNTHETIC ONLY',?,?,'active','complete','active',0,?)").run('a'.repeat(64),JSON.stringify({city:'Olympia',state:'WA',localRadius:35,products:'gifts',customers:'adults',voice:'factual',deliveryConsent:true}),marketId,asOf);
 assert.equal((await call('/api/internal/markets',{body:JSON.stringify(payload)})).status,401);
 assert.equal((await submit({...payload,sourcePacks:[{...p,marketId:'other-market'}]})).status,400);
 assert.equal((await submit({...payload,sourcePacks:[{...p,candidateOnly:true}]})).status,400);
 for(const mutate of [item=>item.marketId='wrong-market',item=>item.prepareBy=plus(asOf,-1),item=>item.city='Seattle']){const invalid=structuredClone(payload);invalid.sourcePacks[0].opportunities.forEach(mutate);assert.equal((await submit(invalid)).status,400);}
 assert.equal((await submit(payload)).status,200);const stored=db.db.prepare('SELECT * FROM markets').get();assert.equal(stored.status,'pending_review');assert.equal(stored.source_registry_json,JSON.stringify([p]));
 const exported=async()=>await (await call('/api/internal/automation/customers',{headers:internal})).json();assert.deepEqual(await exported(),{customers:[],blockedSourceCount:1,blockedSources:[{customerSlug:'a'.repeat(64),marketId,code:'MARKET_SOURCE_APPROVAL_REQUIRED'}]});
 const anonymous=await (await call('/dashboard/source-review')).text();assert.match(anonymous,/Owner access required/);assert.doesNotMatch(anonymous,/SYNTHETIC ONLY/);
 const render=async()=>await (await call('/dashboard/source-review',{headers:{...owner,accept:'text/html'}})).text();const html=await render();assert.match(html,/Source freshness and review queue/);assert.match(html,/Exact owner source approval needed/);
 const action=html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];assert.ok(action);
 const hash=await sourceRegistryChecksum(stored.source_registry_json);
 const approve=(checksum=hash)=>{const body=new FormData();body.set(action,'');body.set('marketId',marketId);body.set('sourceChecksum',checksum);return call('/dashboard/source-review',{body,headers:owner});};
 const quiet=t.mock.method(console,'error',()=>{});await approve('0'.repeat(64));assert.equal(db.db.prepare('SELECT status FROM markets').get().status,'pending_review');
 assert.equal((await approve()).status,200);assert.equal(db.db.prepare('SELECT status FROM markets').get().status,'verified');assert.equal((await exported()).customers.length,1);assert.equal(db.db.prepare('SELECT first_approved_at FROM markets').get().first_approved_at,null);
 p.opportunities[0].title+=' reviewed replacement';assert.equal((await submit(payload)).status,200);assert.deepEqual(await exported(),{customers:[],blockedSourceCount:1,blockedSources:[{customerSlug:'a'.repeat(64),marketId,code:'MARKET_SOURCE_APPROVAL_REQUIRED'}]});await approve(hash);assert.equal(db.db.prepare('SELECT status FROM markets').get().status,'pending_review');assert.equal(db.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE event_type='market_sources_approved'").get().n,1);
 quiet.mock.restore();assert.deepEqual(unexpected,[]);
});
