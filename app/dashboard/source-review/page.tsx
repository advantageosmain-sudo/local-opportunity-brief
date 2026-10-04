import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {assessMarketSources,sourceRegistryChecksum} from '@/lib/source-review.mjs';
import {approveMarketSources} from '../actions';

export const dynamic='force-dynamic';
export default async function SourceReviewPage(){
 const user=await getChatGPTUser(),owner=getRuntimeEnv().OWNER_EMAIL?.toLowerCase();
 if(!user||!owner||user.email.toLowerCase()!==owner)return <main><h1>Owner access required</h1><a href={chatGPTSignInPath('/dashboard/source-review')}>Sign in with your owner account</a></main>;
 const db=await ensureDatabase();
 const markets=(await db.prepare("SELECT * FROM markets WHERE id NOT LIKE 'qa-%' ORDER BY city,state,id").all()).results as Record<string,string>[];
 const reviews=await Promise.all(markets.map(async market=>({market,assessment:assessMarketSources(market),checksum:await sourceRegistryChecksum(market.source_registry_json)})));
 return <main style={{maxWidth:1000,margin:'auto',padding:24}}>
  <a href="/dashboard">Back to owner dashboard</a><h1>Source freshness and review queue</h1>
  <p>This is a read-only freshness assessment of stored evidence. It does not research sources, verify claims, or authorize report delivery. Dates use the existing fourteen-day source limit, conservatively ending on the last complete UTC day.</p>
  <p>Review each served market before the Monday 09:17 America/Chicago report run. Collect fresh first-party evidence, submit the reviewed source pack, approve its exact fingerprint here, then review the customer report separately.</p>
  {!reviews.length&&<p>No real markets are configured. Choose the first service area and verify its source coverage before accepting payment.</p>}
  {reviews.map(({market,assessment,checksum})=><article key={market.id} style={{borderTop:'1px solid #ddd',paddingTop:16,marginTop:16}}>
   <h2>{market.city}, {market.state}</h2><p>Market: {market.id} · Stored approval: {market.status}</p>
   <p role="status">{assessment.approved?'Stored evidence passes current source checks':assessment.canApprove?'Exact owner source approval needed':'Fresh research or correction needed'}</p>
   <p>Current opportunities: {assessment.currentOpportunityCount}. Oldest source check: {assessment.oldestCheckedAt??'missing'}. Valid through: {assessment.validThrough??'unknown'} (UTC).</p>
   {[...assessment.reasons,...assessment.warnings].length>0&&<ul>{[...assessment.reasons,...assessment.warnings].map(reason=><li key={reason}>{reason.replaceAll('_',' ').toLowerCase()}</li>)}</ul>}
   <p>Source fingerprint: <code>{checksum}</code></p>
   <details><summary>Exact stored source evidence and provenance</summary><pre style={{whiteSpace:'pre-wrap'}}>{market.source_registry_json}</pre></details>
   <form action={approveMarketSources}><input type="hidden" name="marketId" value={market.id}/><input type="hidden" name="sourceChecksum" value={checksum}/><button disabled={!assessment.canApprove}>Approve exact verified coverage</button></form>
  </article>)}
 </main>;
}
