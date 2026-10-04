import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {ownerRehearsalIdentityMatches} from '@/lib/owner-rehearsal';
import {applyEmailReceipt} from '@/lib/email-receipts';
import {readBoundedBody,sha256} from '@/lib/resend-signature';
export async function POST(request:Request){
 const env=getRuntimeEnv(),user=await getChatGPTUser();
 if(!env.PUBLIC_SITE_URL||new URL(request.url).origin!==env.PUBLIC_SITE_URL||request.headers.get('origin')!==env.PUBLIC_SITE_URL||!env.OWNER_EMAIL||user?.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())return Response.json({error:'Owner authentication required'},{status:403});
 if(env.OWNER_EXTERNAL_RECEIPT_ENABLED!=='1')return Response.json({error:'External receipt recording disabled'},{status:503});
 let input;try{input=JSON.parse(await readBoundedBody(request,4096));}catch{return Response.json({error:'Invalid request'},{status:400});}
 if(!input||typeof input!=='object'||Array.isArray(input)||!ownerRehearsalIdentityMatches(env,input)||input.confirmation!=='record-external-owner-verified-delivery'||input.receiptEvent!=='delivered'||!/^\w[\w-]{0,127}$/.test(input.providerMessageId??'')||!/^[a-f0-9]{64}$/.test(input.evidenceChecksum??'')||typeof input.evidenceReference!=='string'||!/^https:\/\/resend\.com\/emails\/[\w-]{1,128}$/.test(input.evidenceReference)||!input.evidenceReference.endsWith('/'+input.providerMessageId)||typeof input.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.observedAt)||!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>Date.now()+300000)return Response.json({error:'Exact external evidence required'},{status:400});
 const evidence=JSON.stringify({reportId:input.reportId,checksum:input.checksum,providerMessageId:input.providerMessageId,recipient:input.expectedRecipient,receiptEvent:'delivered',observedAt:input.observedAt,evidenceChecksum:input.evidenceChecksum,evidenceReference:input.evidenceReference,actor:user.email.toLowerCase(),source:'external_owner_verified'});
 const digest=await sha256(evidence);
 try{const result=await applyEmailReceipt(await ensureDatabase(),{eventId:'external:'+digest,providerId:input.providerMessageId,recipient:input.expectedRecipient,event:'delivered',eventTime:Date.parse(input.observedAt),payloadHash:digest,source:'external_owner_verified',actor:user.email.toLowerCase(),evidenceRef:JSON.stringify({url:input.evidenceReference,sha256:input.evidenceChecksum}),reportId:input.reportId,checksum:input.checksum});return Response.json({...result,source:'external_owner_verified'},{status:['unmatched','conflict','invalid_time'].includes(result.status)?409:200});}catch{return Response.json({error:'Receipt storage unavailable'},{status:503});}
}
