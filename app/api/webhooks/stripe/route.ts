import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {PaymentError,stripeConfig,verifyStripeEvent,processStripeEvent} from '@/lib/stripe-payments.mjs';
import {stripeWebhookFailure} from '@/lib/stripe-webhook-diagnostics.mjs';
export async function POST(request:Request) {
 const env=getRuntimeEnv();let config;
 try{config=stripeConfig(env);}catch(error){return Response.json({error:error instanceof PaymentError?error.message:'Stripe disabled.'},{status:503});}
 const raw=await request.text();if(!raw||raw.length>1000000)return Response.json({error:'Invalid webhook payload.'},{status:400});
 let event;try{event=await verifyStripeEvent(raw,request.headers.get('stripe-signature'),config);}catch{return Response.json({error:'Invalid Stripe signature or payment mode.'},{status:400});}
 let stage='database';
 try{const db=await ensureDatabase();stage='reconcile';return Response.json(await processStripeEvent(db,env,event));}
 catch(error){
  const failure=stripeWebhookFailure(error,{stage,event,mode:config.mode});
  try{console.error(JSON.stringify(failure.record));}catch{/* Logging must not replace the retryable response. */}
  return Response.json({error:error instanceof PaymentError?error.message:'Payment event could not be reconciled. Stripe may retry safely.',code:failure.code},{status:failure.status});
 }
}
