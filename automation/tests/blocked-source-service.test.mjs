import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,mkdir,symlink,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {blockedSourceResults,readHostedCustomers} from '../lib/hosted-client.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const blocked={customerSlug:'a'.repeat(64),marketId:'synthetic-market',code:'MARKET_SOURCE_APPROVAL_REQUIRED'};
const payload={customers:[],blockedSourceCount:1,blockedSources:[blocked]};

test('blocked-source protocol validates counts, rejects malformed rows and strips extraneous data',async()=>{
 const result=blockedSourceResults({...payload,blockedSources:[{...blocked,email:'PRIVATE@example.com',profile:{private:true}}]});
 assert.deepEqual(result,[{status:'BLOCKED',customerSlug:blocked.customerSlug,marketId:blocked.marketId,reason:blocked.code,liveDelivery:false}]);
 assert.deepEqual(blockedSourceResults(payload,'b'.repeat(64)),[]);assert.deepEqual(blockedSourceResults({customers:[]}),[]);
 for(const invalid of [{blockedSourceCount:0,blockedSources:[blocked]},{blockedSourceCount:1},{blockedSources:[blocked]},{blockedSourceCount:0,blockedSources:null},{blockedSourceCount:1,blockedSources:[null]},...['customerSlug','marketId','code'].map(key=>({blockedSourceCount:1,blockedSources:[{...blocked,[key]:'PRIVATE invalid/value'}]})),{blockedSourceCount:1,blockedSources:[{...blocked,customerSlug:'qa-synthetic'}]}]){
  await assert.rejects(readHostedCustomers({env:{REPORT_SYNC_URL:'https://offline.example/api/internal/reports',REPORT_SYNC_SECRET:'synthetic-only'},fetchImpl:async()=>Response.json({customers:[],...invalid})}),/invalid blocked-source/);
 }
});

async function harness(t,exported){
 const temp=await mkdtemp(path.join(tmpdir(),'lob-source-service-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const automation=path.join(temp,'automation');await mkdir(automation);
 await copyFile(path.join(root,'automation/run-all.mjs'),path.join(automation,'run-all.mjs'));
 await copyFile(path.join(root,'automation/sync-dashboard.mjs'),path.join(automation,'sync-dashboard.mjs'));
 await symlink(path.join(root,'automation/lib'),path.join(automation,'lib'));
 const preload=path.join(temp,'offline.mjs'),capture=path.join(temp,'requests.json');
 await writeFile(preload,`import {writeFileSync} from 'node:fs';
const requests=[];
globalThis.fetch=async(input,init)=>{const request=new Request(input,init);const url=new URL(request.url);if(url.origin!=='https://offline.example')throw Error('Network prohibited');requests.push({method:request.method,path:url.pathname,...(request.method==='POST'?{body:await request.json()}:{})});if(request.method==='GET'&&url.pathname==='/api/internal/automation/customers')return Response.json(JSON.parse(process.env.OFFLINE_EXPORT));if(request.method==='POST'&&url.pathname==='/api/internal/diagnostics')return Response.json({status:'RECORDED'});throw Error('Unexpected offline operation');};
process.on('exit',()=>writeFileSync(process.env.OFFLINE_CAPTURE,JSON.stringify(requests)));
`);
 const env={PATH:process.env.PATH,REPORT_SYNC_URL:'https://offline.example/api/internal/reports',REPORT_SYNC_SECRET:'synthetic-only',OFFLINE_EXPORT:JSON.stringify(exported),OFFLINE_CAPTURE:capture};
 const run=(script,args=[])=>spawnSync(process.execPath,['--import',preload,path.join(automation,script),...args],{cwd:temp,env,encoding:'utf8'});
 return {temp,run,capture,summary:path.join(automation,'outbox/run-summary-2026-10-05.json')};
}

for(const code of ['MARKET_SOURCE_APPROVAL_REQUIRED','MARKET_SOURCE_FRESHNESS_EXPIRED','MARKET_SOURCE_INVALID']) test('paid blocked market produces weekly diagnostics without generating a report: '+code,async t=>{
 const currentPayload={...payload,blockedSources:[{...blocked,code}]};
 const h=await harness(t,currentPayload),run=h.run('run-all.mjs',['--hosted','--as-of','2026-10-05']);
 assert.equal(run.status,1,run.stderr);const summary=JSON.parse(await readFile(h.summary,'utf8'));
 assert.equal(summary.status,'BLOCKED');assert.equal(summary.blockedSourceCount,1);assert.equal(summary.blockedCount,1);assert.equal(summary.readyCount,0);assert.deepEqual(summary.dashboardPackets,[]);assert.deepEqual(summary.results,blockedSourceResults(currentPayload));
 const sync=h.run('sync-dashboard.mjs',['--summary',h.summary]);assert.equal(sync.status,0,sync.stderr);
 const requests=JSON.parse(await readFile(h.capture,'utf8'));assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/internal/diagnostics');assert.equal(requests[0].body.code,code);assert.equal(requests[0].body.subjectId,blocked.customerSlug);assert.doesNotMatch(JSON.stringify(requests),/PRIVATE|email|profile/);
 const workflow=await readFile(path.join(root,'.github/workflows/weekly-brief.yml'),'utf8');assert.match(workflow,/if: always\(\).*steps\.clock\.outputs\.enabled/);assert.match(workflow,/if: failure\(\).*steps\.clock\.outputs\.enabled/);assert.match(workflow,/github\.rest\.issues\.create/);
});

for(const [label,exported,customer]of [['genuinely empty',{customers:[]},'all'],['different requested customer',payload,'b'.repeat(64)]])test('normal empty weekly success remains for '+label,async t=>{
 const h=await harness(t,exported),run=h.run('run-all.mjs',['--hosted','--as-of','2026-10-05','--customer',customer]);assert.equal(run.status,0,run.stderr);const summary=JSON.parse(await readFile(h.summary,'utf8'));assert.equal(summary.status,'NO_ELIGIBLE_CUSTOMERS');assert.equal(summary.blockedSourceCount,0);assert.deepEqual(summary.results,[]);
});
