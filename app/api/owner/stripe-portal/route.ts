import {stripePortalRequest} from '@/lib/stripe-routes';
export async function POST(request:Request){return stripePortalRequest(request,true);}

