import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePacks} from './fixtures/source-packs.mjs';
import {assessMarketSources} from '../lib/source-review.mjs';
import {validateSourcePack} from '../automation/lib/source-validation.mjs';
import {generateReport,validateReport} from '../automation/lib/engine.mjs';
import {validateCurrentReportPacket} from '../lib/report-sync.mjs';

const profile={slug:'synthetic-freshness',businessName:'SYNTHETIC ONLY',deliveryEmail:'owner@example.com',deliveryMode:'owner_review_only',marketId:'synthetic-market',location:{city:'Olympia',state:'WA',radiusMiles:35},products:['gifts'],customers:['adults'],voice:['factual'],exclusions:[]};
const asOf='2026-10-18';
for (const [label, mutate, reason] of [
 ['unapproved authority', p => p[0].opportunities[0].sourceAuthority='unapproved', 'SOURCE_AUTHORITY_UNAPPROVED'],
 ['unsafe evidence URL', p => p[0].opportunities[0].sourceUrl='http://localhost/private', 'SOURCE_URL_INVALID'],
 ['missing product tags', p => p[0].opportunities[0].productTags=[], 'SOURCE_FIELDS_MISSING'],
]) test('mixed stale and '+label+' evidence retains both validation reasons',()=>{
 const packs=sourcePacks(profile.marketId,{asOf,checkedAt:'2026-10-04'});mutate(packs);
 const before=JSON.stringify(packs);
 const result=assessMarketSources({id:profile.marketId,city:'Olympia',state:'WA',status:'verified',source_registry_json:before},{asOf});
 assert.equal(result.approved,false);assert.equal(result.canApprove,false);
 assert.ok(result.reasons.includes('SOURCE_FRESHNESS_EXPIRED'));
 assert.ok(result.reasons.includes(reason),JSON.stringify(result));
 assert.equal(JSON.stringify(packs),before);
});
for(const age of [13,14,15])test(`source queue, source validator and report validators agree at age ${age}`,async()=>{
 const checkedAt=new Date(Date.parse(asOf)-age*86400000).toISOString().slice(0,10),packs=sourcePacks(profile.marketId,{asOf,checkedAt});
 const expected=age<14;
 assert.equal(assessMarketSources({id:profile.marketId,city:'Olympia',state:'WA',status:'verified',source_registry_json:JSON.stringify(packs)},{asOf}).approved,expected);
 assert.equal(validateSourcePack(packs[0],{asOf}).passed,expected);
 const report=generateReport(profile,packs[0].opportunities,{asOf,fixture:false,generatedAt:asOf+'T00:00:00.000Z'});
 const validation=validateReport(report);assert.equal(validation.passed,expected);
 assert.equal((await validateCurrentReportPacket({schemaVersion:1,report,validation},new Date(asOf+'T00:00:00.000Z'))).passed,expected);
});

test('a previously valid immutable packet expires exactly at the fourteen-day UTC instant',async()=>{
 const reportDate='2026-10-17',packs=sourcePacks(profile.marketId,{asOf:reportDate,checkedAt:'2026-10-04'});
 const report=generateReport(profile,packs[0].opportunities,{asOf:reportDate,fixture:false,generatedAt:reportDate+'T00:00:00.000Z'});
 const packet={schemaVersion:1,report,validation:validateReport(report)},before=JSON.stringify(packet);
 assert.equal(packet.validation.passed,true);
 for(const [now,passed] of [['2026-10-17T23:59:59.999Z',true],['2026-10-18T00:00:00.000Z',false],['2026-10-18T00:00:00.001Z',false]]){
  const result=await validateCurrentReportPacket(packet,new Date(now));assert.equal(result.passed,passed,now);
  if(!passed)assert.ok(result.errors.includes('Source freshness invalid.'));
 }
 assert.equal(JSON.stringify(packet),before);
});
