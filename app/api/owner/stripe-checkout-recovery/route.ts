import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {PaymentError} from '@/lib/stripe-payments.mjs';
import {recoverRejectedCheckout,REJECTED_CHECKOUT} from '@/lib/stripe-checkout-recovery.mjs';

export async function POST(request:Request) {
 try {
  const env=getRuntimeEnv();
  if(new URL(request.url).origin!==REJECTED_CHECKOUT.origin||request.headers.get('origin')!==REJECTED_CHECKOUT.origin)throw new PaymentError('Same-origin owner request required.',403);
  const user=await getChatGPTUser();
  if(!user||!env.OWNER_EMAIL||user.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())throw new PaymentError('Owner authentication required.',403);
  const raw=await request.text();
  if(raw.length>1024)throw new PaymentError('Request too large.',413);
  let payload;try{payload=JSON.parse(raw);}catch{throw new PaymentError('Invalid request.',400);}
  if(payload?.customerId!==REJECTED_CHECKOUT.customerId||payload?.attemptId!==REJECTED_CHECKOUT.attemptId||payload?.confirmation!=='retire-rejected-test-attempt')throw new PaymentError('Only the reviewed rejected test attempt can be recovered.',400);
  const db=await ensureDatabase();
  const result=await recoverRejectedCheckout(db,env,{customerId:payload.customerId,attemptId:payload.attemptId,actorEmail:user.email});
  return Response.json({...result,message:'The rejected test attempt is archived and retired. Your test customer and reserved place are unchanged. No new checkout was created.'},{headers:{'cache-control':'no-store'}});
 } catch(error) {
  return Response.json({error:error instanceof PaymentError?error.message:'Recovery could not verify every safety check. No recovery was confirmed; contact support before retrying.'},{status:error instanceof PaymentError?error.status:503,headers:{'cache-control':'no-store'}});
 }
}
