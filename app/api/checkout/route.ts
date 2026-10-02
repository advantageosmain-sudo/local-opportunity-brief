import {getRuntimeEnv,ensureDatabase} from '@/db/runtime';
import {secureStringEqual} from '@/lib/security.mjs';
import {buildTestCheckoutUrl} from '@/lib/lemon-squeezy.mjs';
export async function POST(request:Request) {
 const env=getRuntimeEnv();
 if(!env.LEMON_SQUEEZY_CHECKOUT_URL||!['test','live'].includes(env.PAYMENTS_MODE??'')||(env.PAYMENTS_MODE==='live'&&env.LIVE_CHECKOUT_VERIFIED!=='1')) return Response.json({error:'Checkout awaits provider verification. No payment has been taken.'},{status:503});
 let p;try{p=await request.json();}catch{return Response.json({error:'Invalid request'},{status:400});}
 if(!/^[a-f0-9]{64}$/.test(p.customerId??'')) return Response.json({error:'Complete intake first.'},{status:400});
 const db=await ensureDatabase();
 const c=await db.prepare('SELECT c.id,c.profile_json,m.status AS market_status FROM customers c JOIN markets m ON c.market_id=m.id WHERE c.id=?').bind(p.customerId).first<{id:string;profile_json:string;market_status:string}>();
 if(!c||!secureStringEqual(JSON.parse(c.profile_json).checkoutToken,p.checkoutToken??'')) return Response.json({error:'Checkout session invalid.'},{status:403});
 if(c.market_status!=='verified') return Response.json({error:'Local source coverage needs review before checkout.'},{status:409});
 const count=await db.prepare("SELECT COUNT(*) AS count FROM customers WHERE payment_status='active'").first<{count:number}>();
 if((count?.count??0)>=10) return Response.json({error:'Founding memberships are currently full.'},{status:409});
 const url=new URL(buildTestCheckoutUrl(env.LEMON_SQUEEZY_CHECKOUT_URL,c.id));
 url.searchParams.set('checkout[custom][checkout_token]',p.checkoutToken);
 return Response.json({url:url.toString(),mode:env.PAYMENTS_MODE});
}
