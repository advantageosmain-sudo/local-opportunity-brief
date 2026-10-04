import {ensureDatabase} from '@/db/runtime';
import {isAutomationRequest} from '@/lib/internal-auth';
import {assessMarketSources} from '@/lib/source-review.mjs';
export async function POST(request:Request) {
 if(!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const raw=await request.text();if(raw.length>500000)return Response.json({error:'Too large'},{status:413});
 let p;try{p=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 if(!p||typeof p!=='object'||Array.isArray(p)||!(/^[a-z0-9-]{1,160}$/).test(p.marketId??''))return Response.json({error:'Source validation failed'},{status:400});
 const db=await ensureDatabase();
 const market=await db.prepare('SELECT id,city,state FROM markets WHERE id=?').bind(p.marketId).first<{id:string;city:string;state:string}>();
 if(!market)return Response.json({error:'Market not found'},{status:404});
 if(!assessMarketSources({...market,status:'pending_review',source_registry_json:JSON.stringify(p.sourcePacks)}).sourceValid)return Response.json({error:'Source validation failed'},{status:400});
 const updated=await db.prepare("UPDATE markets SET source_registry_json=?,status='pending_review' WHERE id=?").bind(JSON.stringify(p.sourcePacks),p.marketId).run();
 if(updated.meta.changes!==1)return Response.json({error:'Market not found'},{status:404});
 return Response.json({status:'PENDING_OWNER_MARKET_REVIEW'});
}
