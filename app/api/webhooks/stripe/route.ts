import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {PaymentError,stripeConfig,verifyStripeEvent,processStripeEvent} from '@/lib/stripe-payments.mjs';
export async function POST(request:Request) {
 const env=getRuntimeEnv();let config;
 try{config=stripeConfig(env);}catch(error){return Response.json({error:error instanceof PaymentError?error.message:'Stripe disabled.'},{status:503});}
 const raw=await request.text();if(!raw||raw.length>1000000)return Response.json({error:'Invalid webhook payload.'},{status:400});
 let event;try{event=await verifyStripeEvent(raw,request.headers.get('stripe-signature'),config);}catch{return Response.json({error:'Invalid Stripe signature or payment mode.'},{status:400});}
 try{return Response.json(await processStripeEvent(await ensureDatabase(),env,event));}
 catch(error){return Response.json({error:error instanceof PaymentError?error.message:'Payment event could not be reconciled. Stripe may retry safely.'},{status:error instanceof PaymentError?error.status:503});}
}

