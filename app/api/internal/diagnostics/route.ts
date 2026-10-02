import {ensureDatabase} from '@/db/runtime';
import {isAutomationRequest} from '@/lib/internal-auth';
export async function POST(request:Request) {
 if(!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const raw=await request.text(); if(raw.length>50000) return Response.json({error:'Too large'},{status:413});
 let p;try{p=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(p.id??'')||!['sources','reports','payments','email','dashboard','configuration'].includes(p.system)||typeof p.code!=='string'||p.code.length>160) return Response.json({error:'Invalid diagnostic'},{status:400});
 const db=await ensureDatabase();await db.prepare(`INSERT INTO diagnostics(id,system,subject_id,code,detail_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,detail_json=excluded.detail_json,updated_at=CURRENT_TIMESTAMP`).bind(p.id,p.system,String(p.subjectId??'').slice(0,160),p.code,JSON.stringify(p.details??{})).run();
 return Response.json({status:'RECORDED'});
}
