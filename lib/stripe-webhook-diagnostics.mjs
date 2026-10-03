import {PaymentError} from './stripe-payments.mjs';

const paymentCodes=new Set(['PAYMENT_LOCK_BUSY','PAYMENT_LEASE_EXPIRED','PAYMENT_REJECTED']);
const providerTypes=new Set(['StripePermissionError','StripeAuthenticationError','StripeRateLimitError','StripeConnectionError','StripeAPIError','StripeInvalidRequestError']);
const safeId=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]{1,100}$').test(value)?value:undefined;

// Only a verified event reaches this diagnostic. Never log the raw event,
// signature, credentials, provider message, stack, profile, or hosted URLs.
export function stripeWebhookFailure(error,{stage,event,mode}) {
 const status=error instanceof PaymentError?error.status:503;
 const code=error instanceof PaymentError&&paymentCodes.has(error.code)?error.code:providerTypes.has(error?.type)?error.type:'WEBHOOK_PROCESSING_FAILED';
 const record={kind:'stripe_webhook_failure',stage:stage==='database'?'database':'reconcile',code,status,mode:mode==='live'?'live':'test'};
 const eventId=safeId(event?.id,'evt');if(eventId)record.eventId=eventId;
 if(typeof event?.type==='string'&&/^[a-z_]+(?:\.[a-z_]+){1,4}$/.test(event.type)&&event.type.length<=100)record.eventType=event.type;
 const providerRequestId=safeId(error?.requestId,'req');if(providerRequestId)record.providerRequestId=providerRequestId;
 return {status,code,record};
}
