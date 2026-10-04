import { validateSourcePack, SOURCE_VALIDATION_REASON_CODES } from '../automation/lib/source-validation.mjs';
import { MAX_SOURCE_AGE_DAYS } from '../automation/lib/engine.mjs';

const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const addDays = (value, count) => new Date(Date.parse(value+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);

// Read-only assessment. A queue entry never fetches sources or upgrades evidence.
export function assessMarketSources(market, {asOf=new Date().toISOString().slice(0,10)}={}) {
 const reasons=new Set(), warnings=new Set(), opportunities=[], unique=new Set();
 let packs;
 if(!day(asOf)) throw Error('Invalid source review date.');
 try { packs=JSON.parse(market?.source_registry_json??'[]'); } catch { reasons.add('SOURCE_REGISTRY_INVALID'); }
 if(!Array.isArray(packs)){reasons.add('SOURCE_REGISTRY_INVALID');packs=[];}
 if(!packs.length)reasons.add('SOURCE_PACKS_MISSING');
 for(const pack of packs){
  if(!pack||typeof pack!=='object'||Array.isArray(pack)||!Array.isArray(pack.opportunities)){reasons.add('SOURCE_REGISTRY_INVALID');continue;}
  if(pack.marketId!==market.id)reasons.add('SOURCE_MARKET_MISMATCH');
  if(pack.fixture!==false||pack.candidateOnly===true)reasons.add('SOURCE_VERIFICATION_REQUIRED');
  try {
   const validation=validateSourcePack(pack,{asOf,includeReasonCodes:true});
   if(!validation.passed){
    // Never derive protocol reasons from raw error text or untrusted IDs.
    if(!Array.isArray(validation.reasonCodes)||!validation.reasonCodes.length||!validation.reasonCodes.every(code=>SOURCE_VALIDATION_REASON_CODES.includes(code)))reasons.add('SOURCE_VALIDATION_FAILED');
    else for(const code of validation.reasonCodes)reasons.add(code);
   }
  }catch{reasons.add('SOURCE_REGISTRY_INVALID');}
  for(const opportunity of pack.opportunities){
   if(!opportunity||typeof opportunity!=='object'||Array.isArray(opportunity)){reasons.add('SOURCE_REGISTRY_INVALID');continue;}
   const matchingMarket=opportunity.marketId===market.id;
   if(!matchingMarket)reasons.add('OPPORTUNITY_MARKET_MISMATCH');
   const currentPreparation=day(opportunity.prepareBy)&&day(opportunity.eventDate)&&opportunity.prepareBy>=asOf&&opportunity.prepareBy<=opportunity.eventDate;
   if(!currentPreparation)reasons.add('PREPARATION_WINDOW_INVALID');
   const matchingGeography=opportunity.geographyMode!=='city_match'||(typeof market.city==='string'&&typeof market.state==='string'&&typeof opportunity.city==='string'&&typeof opportunity.state==='string'&&opportunity.city.toLowerCase()===market.city.toLowerCase()&&opportunity.state.toLowerCase()===market.state.toLowerCase());
   if(!matchingGeography)reasons.add('SOURCE_GEOGRAPHY_MISMATCH');
   if(opportunity.candidateOnly===true||opportunity.sourceAccessStatus!=='verified')reasons.add('SOURCE_VERIFICATION_REQUIRED');
   if(!day(opportunity.sourceCheckedAt))reasons.add('SOURCE_CHECK_DATE_REQUIRED');
   else if(opportunity.sourceCheckedAt>asOf)reasons.add('SOURCE_CHECK_DATE_IN_FUTURE');
   else if(addDays(opportunity.sourceCheckedAt,MAX_SOURCE_AGE_DAYS)<=asOf)reasons.add('SOURCE_FRESHNESS_EXPIRED');
   if(matchingMarket&&currentPreparation&&matchingGeography&&day(opportunity.eventDate)&&opportunity.eventDate>=asOf&&opportunity.eventDate<=addDays(asOf,30)){
    const identity=String(opportunity.sourceUrl)+'|'+opportunity.eventDate;
    if(unique.has(identity))reasons.add('DUPLICATE_SOURCE_OPPORTUNITY');
    else{unique.add(identity);opportunities.push(opportunity);}
   }
  }
 }
 if(opportunities.length<5)reasons.add('INSUFFICIENT_CURRENT_OPPORTUNITIES');
 const dates=opportunities.map(item=>item.sourceCheckedAt).filter(day).sort();
 const oldestCheckedAt=dates[0]??null;
 // Last complete UTC day before the hosted fourteen-day timestamp cutoff.
 const validThrough=oldestCheckedAt?addDays(oldestCheckedAt,MAX_SOURCE_AGE_DAYS-1):null;
 if(validThrough&&validThrough>=asOf&&validThrough<=addDays(asOf,2))warnings.add('SOURCE_REFRESH_DUE');
 const sourceValid=reasons.size===0;
 const freshnessOnly=reasons.size===1&&reasons.has('SOURCE_FRESHNESS_EXPIRED');
 if(market.status!=='verified')reasons.add('OWNER_SOURCE_APPROVAL_REQUIRED');
 return {marketId:market.id,asOf,sourceValid,freshnessOnly,canApprove:sourceValid&&market.status==='pending_review',approved:sourceValid&&market.status==='verified',currentOpportunityCount:opportunities.length,oldestCheckedAt,validThrough,reasons:[...reasons],warnings:[...warnings]};
}

export async function sourceRegistryChecksum(raw) {
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(raw??'')));
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function approveExactMarketSources(db,{marketId,sourceChecksum,actor,asOf=new Date().toISOString().slice(0,10)}) {
 const row=await db.prepare('SELECT id,city,state,status,source_registry_json FROM markets WHERE id=?').bind(marketId).first();
 if(!row)throw Error('Market missing.');
 if(!/^[a-f0-9]{64}$/.test(sourceChecksum??'')||sourceChecksum!==await sourceRegistryChecksum(row.source_registry_json))throw Error('Source registry changed since preview. Reload before deciding.');
 const assessment=assessMarketSources(row,{asOf});
 if(!assessment.canApprove)throw Error('Current, verified source evidence and a pending owner review are required.');
 await db.batch([
  db.prepare("UPDATE markets SET status='verified' WHERE id=? AND status='pending_review' AND source_registry_json=?").bind(marketId,row.source_registry_json),
  // The fixed malformed-JSON branch aborts/rolls back a concurrent stale review.
  db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('SOURCE_REGISTRY_CHANGED','$') END"),
  db.prepare('INSERT INTO audit_events(id,event_type,subject_id,actor_email,detail_json) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),'market_sources_approved',marketId,actor,JSON.stringify({sourceChecksum,asOf,currentOpportunityCount:assessment.currentOpportunityCount,oldestCheckedAt:assessment.oldestCheckedAt,validThrough:assessment.validThrough}))
 ]);
 return assessment;
}
