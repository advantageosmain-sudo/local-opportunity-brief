import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getRuntimeEnv} from '@/db/runtime';
import {processIntake} from '@/app/api/intake/route';
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin) return Response.json({error:'Same-origin owner request required.'},{status:403});
 const user=await getChatGPTUser(),owner=getRuntimeEnv().OWNER_EMAIL;
 if(!user||!owner||user.email.toLowerCase()!==owner.toLowerCase()) return Response.json({error:'Owner authentication required.'},{status:403});
 return processIntake(request,true);
}
