import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {secureStringEqual} from '@/lib/security.mjs';
import {createStripeCheckout,createStripePortal,PaymentError} from '@/lib/stripe-payments.mjs';
async function authorize(request:Request,ownerTest:boolean) {
 const env=getRuntimeEnv();
 if(request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin) throw new PaymentError('Same-origin request required.',403);
 if(ownerTest) {const user=await getChatGPTUser();if(!user||!env.OWNER_EMAIL||user.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase()) throw new PaymentError('Owner authentication required.',403);}
 const raw=await request.text();if(raw.length>2048) throw new PaymentError('Request too large.',413);
 let payload;try{payload=JSON.parse(raw);}catch{throw new PaymentError('Invalid request.',400);}
 if(!(ownerTest?/^qa-[a-f0-9]{64}$/:/^[a-f0-9]{64}$/).test(payload?.customerId??'')) throw new PaymentError('Save a valid intake record first.',400);
 const db=await ensureDatabase();
 const customer=await db.prepare('SELECT c.*,m.status AS market_status FROM customers c JOIN markets m ON c.market_id=m.id WHERE c.id=?').bind(payload.customerId).first<{profile_json:string}>();
 if(!customer) throw new PaymentError('Billing record not found.',403);
 const profile=JSON.parse(customer.profile_json);
 if(ownerTest ? profile.isTest!==true : !profile.checkoutToken || !secureStringEqual(profile.checkoutToken,payload.checkoutToken??'')) throw new PaymentError('Billing session invalid.',403);
 return {env,db,customer};
}
function failure(error:unknown) {return Response.json({error:error instanceof PaymentError?error.message:'Stripe could not confirm the request. Retry safely or contact support; do not create a second intake.'},{status:error instanceof PaymentError?error.status:503,headers:{'cache-control':'no-store'}});}
export async function stripeCheckoutRequest(request:Request,ownerTest=false) {try{const {env,db,customer}=await authorize(request,ownerTest);return Response.json(await createStripeCheckout(db,env,customer,{ownerTest}),{headers:{'cache-control':'no-store'}});}catch(error){return failure(error);}}
export async function stripePortalRequest(request:Request,ownerTest=false) {try{const {env,customer}=await authorize(request,ownerTest);return Response.json(await createStripePortal(env,customer,{ownerTest}),{headers:{'cache-control':'no-store'}});}catch(error){return failure(error);}}

