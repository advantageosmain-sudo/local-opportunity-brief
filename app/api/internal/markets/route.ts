import {ensureDatabase} from '@/db/runtime';
import {isAutomationRequest} from '@/lib/internal-auth';
import {validateSourcePack} from '@/automation/lib/source-validation.mjs';
export async function POST(request:Request) {
 if(!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const raw=await request.text();if(raw.length>500000)return Response.json({error:'Too large'},{status:413});
 let p;try{p=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 if(!/^[a-z0-9-]{1,160}$/.test(p.marketId??'')||!Array.isArray(p.sourcePacks)||!p.sourcePacks.length||p.sourcePacks.some((pack:Record<string,unknown>)=>pack.fixture===true||!validateSourcePack(pack,{asOf:new Date().toISOString().slice(0,10)}).passed))return Response.json({error:'Source validation failed'},{status:400});
 const db=await ensureDatabase();
 await db.prepare("UPDATE markets SET source_registry_json=?,status='pending_review' WHERE id=?").bind(JSON.stringify(p.sourcePacks),p.marketId).run();
 return Response.json({status:'PENDING_OWNER_MARKET_REVIEW'});
}
