import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePacks} from './fixtures/source-packs.mjs';
import {validateSourcePack,SOURCE_VALIDATION_REASON_CODES} from '../automation/lib/source-validation.mjs';
import {assessMarketSources} from '../lib/source-review.mjs';

const asOf='2026-10-18';
function assess(packs,status='verified') {
 return assessMarketSources({id:'market',city:'Olympia',state:'WA',status,source_registry_json:JSON.stringify(packs)},{asOf});
}
for(const [label,expired,invalid,reasons] of [
 ['stale only',true,false,['SOURCE_FRESHNESS_EXPIRED']],
 ['invalid only',false,true,['SOURCE_AUTHORITY_INVALID']],
 ['both stale and invalid',true,true,['SOURCE_FRESHNESS_EXPIRED','SOURCE_AUTHORITY_INVALID']],
 ['current valid',false,false,[]],
])test('assessment retains granular fixed reasons for '+label,()=>{
 const packs=sourcePacks('market',{asOf,checkedAt:expired?'2026-10-04':asOf});
 if(invalid)packs[0].opportunities[0].sourceAuthority='PRIVATE_UNAPPROVED_AUTHORITY';
 const before=JSON.stringify(packs),result=assess(packs);
 assert.deepEqual(result.reasons,reasons);assert.equal(result.freshnessOnly,expired&&!invalid);
 assert.equal(result.sourceValid,!expired&&!invalid);assert.equal(result.approved,!expired&&!invalid);
 assert.equal(JSON.stringify(packs),before);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UNAPPROVED_AUTHORITY/);
});

test('owner review state is separate from the underlying evidence diagnosis',()=>{
 const packs=sourcePacks('market',{asOf,checkedAt:'2026-10-04'});
 const result=assess(packs,'pending_review');assert.equal(result.freshnessOnly,true);
 assert.deepEqual(result.reasons,['SOURCE_FRESHNESS_EXPIRED','OWNER_SOURCE_APPROVAL_REQUIRED']);assert.equal(result.canApprove,false);
 packs[0].opportunities[0].sourceAuthority='invalid';assert.equal(assess(packs,'pending_review').freshnessOnly,false);
});

test('reason codes are allowlisted and raw IDs, URLs and labels never enter assessment reasons',()=>{
 const packs=sourcePacks('market',{asOf,checkedAt:'2026-10-04'}),entry=packs[0].opportunities[0];
 entry.id='PRIVATE unsafe/id';entry.sourceUrl='http://private.invalid/PRIVATE_URL';entry.sourceAuthority='PRIVATE_AUTHORITY';entry.title='PRIVATE_TITLE';
 const legacy=validateSourcePack(packs[0],{asOf}),coded=validateSourcePack(packs[0],{asOf,includeReasonCodes:true});
 assert.deepEqual(Object.keys(legacy),['passed','errors','warnings']);
 const {reasonCodes,...rest}=coded;assert.deepEqual(rest,legacy);
 assert.ok(reasonCodes.includes('SOURCE_OPPORTUNITY_ID_INVALID'));assert.ok(reasonCodes.includes('SOURCE_URL_INVALID'));assert.ok(reasonCodes.includes('SOURCE_AUTHORITY_INVALID'));
 assert.ok(reasonCodes.every(code=>SOURCE_VALIDATION_REASON_CODES.includes(code)));
 const result=assess(packs);assert.equal(result.freshnessOnly,false);assert.doesNotMatch(JSON.stringify(result.reasons),/PRIVATE|unsafe|http/);
});

for(const [label,mutate,code] of [
 ['required field',o=>o.title='', 'SOURCE_REQUIRED_FIELD_MISSING'],
 ['tags',o=>o.productTags=[], 'SOURCE_TAGS_INVALID'],
 ['quality',o=>o.sourceQuality=99, 'SOURCE_QUALITY_INVALID'],
 ['ranking input',o=>o.urgency=0, 'SOURCE_RANKING_INPUT_INVALID'],
 ['verification',o=>o.sourceAccessStatus='unverified', 'SOURCE_VERIFICATION_REQUIRED'],
])test('stale evidence does not mask '+label,()=>{
 const packs=sourcePacks('market',{asOf,checkedAt:'2026-10-04'});mutate(packs[0].opportunities[0]);
 const result=assess(packs);assert.equal(result.freshnessOnly,false);assert.ok(result.reasons.includes(code));assert.ok(result.reasons.includes('SOURCE_FRESHNESS_EXPIRED'));
});
