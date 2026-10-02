import {stripeCheckoutRequest} from '@/lib/stripe-routes';
import {reserveFoundingPlace,releaseUnpaidPlace} from '@/lib/founding-capacity.mjs';
import {getRuntimeEnv,ensureDatabase} from '@/db/runtime';
import {secureStringEqual} from '@/lib/security.mjs';
import {buildTestCheckoutUrl} from '@/lib/lemon-squeezy.mjs';
export async function POST(request:Request) {
 const env=getRuntimeEnv();
 const provider=env.PAYMENTS_PROVIDER??'stripe';
 if(provider==='stripe') return stripeCheckoutRequest(request);
 if(provider!=='lemon_squeezy') return Response.json({error:'Unsupported payment provider. Checkout is disabled.'},{status:503});
 if(!env.LEMON_SQUEEZY_CHECKOUT_URL||!['test','live'].includes(env.PAYMENTS_MODE??'')||(env.PAYMENTS_MODE==='live'&&(env.LIVE_CHECKOUT_VERIFIED!=='1'||env.PROVIDER_CAPACITY_VERIFIED!=='1'))) return Response.json({error:'Checkout awaits provider verification. No payment has been taken.'},{status:503});
 let p;try{p=await request.json();}catch{return Response.json({error:'Invalid request'},{status:400});}
 if(!/^[a-f0-9]{64}$/.test(p.customerId??'')) return Response.json({error:'Complete intake first.'},{status:400});
 let url:URL;
 try {url=new URL(buildTestCheckoutUrl(env.LEMON_SQUEEZY_CHECKOUT_URL,p.customerId));url.searchParams.set('checkout[custom][checkout_token]',p.checkoutToken??'');}
 catch {return Response.json({error:'Checkout provider URL is invalid. No place was reserved and no payment was taken.'},{status:503});}
 const db=await ensureDatabase();
 const c=await db.prepare('SELECT c.id,c.profile_json,m.status AS market_status FROM customers c JOIN markets m ON c.market_id=m.id WHERE c.id=?').bind(p.customerId).first<{id:string;profile_json:string;market_status:string}>();
 if(!c||!secureStringEqual(JSON.parse(c.profile_json).checkoutToken,p.checkoutToken??'')) return Response.json({error:'Checkout session invalid.'},{status:403});
 if(JSON.parse(c.profile_json).isTest) return Response.json({error:'Synthetic QA records cannot check out.'},{status:409});
 if(c.market_status!=='verified') return Response.json({error:'Local source coverage needs review before checkout.'},{status:409});
 const capacityAlert=await db.prepare("SELECT id FROM diagnostics WHERE status='open' AND code IN ('UNRESERVED_PAYMENT_REVIEW_REQUIRED','EXPIRED_RESERVATION_PAYMENT_REVIEW_REQUIRED') LIMIT 1").first();
 if(capacityAlert) return Response.json({error:'Founding payment capacity needs reconciliation before checkout.'},{status:409});
 // Existing paid identities must be reconciled before allocating new places.
 const legacy=await db.prepare("SELECT COUNT(*) AS count FROM customers c WHERE c.subscription_id IS NOT NULL AND ((?='test' AND c.payment_status LIKE 'test_%') OR (?='live' AND c.payment_status NOT LIKE 'test_%')) AND NOT EXISTS(SELECT 1 FROM founding_reservations f WHERE f.customer_id=c.id AND f.mode=? AND f.state='paid')").bind(env.PAYMENTS_MODE,env.PAYMENTS_MODE,env.PAYMENTS_MODE).first<{count:number}>();
 if((legacy?.count??0)>0) return Response.json({error:'Existing paid founding memberships require capacity reconciliation before another checkout.'},{status:409});
 const reservation=await reserveFoundingPlace(db,c.id,env.PAYMENTS_MODE!);
 if(!reservation) return Response.json({error:'Founding memberships are currently full.'},{status:409});
 if(reservation.state==='paid') return Response.json({error:'This customer already holds a founding membership.'},{status:409});
 return Response.json({url:url.toString(),mode:env.PAYMENTS_MODE,reservationExpiresAt:reservation.expiresAt});
}

// Releases only an unpaid local reservation. This is not subscription cancellation.
export async function DELETE(request:Request) {
 const provider=getRuntimeEnv().PAYMENTS_PROVIDER??'stripe';
 if(provider!=='stripe' && provider!=='lemon_squeezy') return Response.json({error:'Unsupported payment provider. Checkout is disabled.'},{status:503});
 if(provider==='stripe') return Response.json({error:'Stripe checkout places remain reserved until provider-confirmed expiry. Closing a page does not cancel billing.'},{status:409});
 const mode=getRuntimeEnv().PAYMENTS_MODE;
 if(!mode||!['test','live'].includes(mode)) return Response.json({error:'Checkout disabled.'},{status:503});
 let p;try{p=await request.json();}catch{return Response.json({error:'Invalid request'},{status:400});}
 const db=await ensureDatabase();
 const c=await db.prepare('SELECT profile_json FROM customers WHERE id=?').bind(String(p.customerId??'')).first<{profile_json:string}>();
 if(!c||!secureStringEqual(JSON.parse(c.profile_json).checkoutToken,p.checkoutToken??'')) return Response.json({error:'Checkout session invalid.'},{status:403});
 await releaseUnpaidPlace(db,p.customerId,mode);
 return Response.json({status:'UNPAID_RESERVATION_RELEASED',billingChanged:false});
}

