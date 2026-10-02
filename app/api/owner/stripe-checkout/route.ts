import {stripeCheckoutRequest} from '@/lib/stripe-routes';
export async function POST(request:Request){return stripeCheckoutRequest(request,true);}

