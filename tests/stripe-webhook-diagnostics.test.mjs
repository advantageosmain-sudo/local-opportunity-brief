import test from 'node:test';
import assert from 'node:assert/strict';
import {PaymentError} from '../lib/stripe-payments.mjs';
import {stripeWebhookFailure} from '../lib/stripe-webhook-diagnostics.mjs';

const context={stage:'reconcile',mode:'test',event:{id:'evt_verified123',type:'invoice.paid',data:{object:{email:'private@example.com'}}}};
test('webhook diagnostics distinguish lock contention and expiry without changing retry semantics',()=>{
 for(const code of ['PAYMENT_LOCK_BUSY','PAYMENT_LEASE_EXPIRED']) {
  const result=stripeWebhookFailure(new PaymentError('private message',503,code),context);
  assert.equal(result.status,503);assert.equal(result.code,code);
  assert.equal(result.record.eventId,'evt_verified123');assert.equal(result.record.eventType,'invoice.paid');
  assert.doesNotMatch(JSON.stringify(result),/private|data|object|email/);
 }
});
test('webhook diagnostics allow only fixed categories and validated provider request IDs',()=>{
 const error=Object.assign(new Error('rk_test_SECRET private@example.com'),{type:'StripePermissionError',requestId:'req_known123',raw:{secret:'whsec_SECRET'},stack:'sensitive stack'});
 const result=stripeWebhookFailure(error,context);
 assert.equal(result.code,'StripePermissionError');assert.equal(result.record.providerRequestId,'req_known123');
 assert.doesNotMatch(JSON.stringify(result),/SECRET|@|stack|raw/);
 const unsafe=stripeWebhookFailure({type:'unsafe type private@example.com',requestId:'req_bad\nsecret'}, {...context,stage:'database',event:{id:'evt_bad@example.com',type:'invoice.paid secret'}});
 assert.deepEqual(unsafe.record,{kind:'stripe_webhook_failure',stage:'database',code:'WEBHOOK_PROCESSING_FAILED',status:503,mode:'test'});
});
test('ordinary rejected reconciliation retains status and never logs its message',()=>{
 const result=stripeWebhookFailure(new PaymentError('Customer identity mismatch.',409),{...context,mode:'live'});
 assert.equal(result.status,409);assert.equal(result.code,'PAYMENT_REJECTED');assert.equal(result.record.mode,'live');
 assert.doesNotMatch(JSON.stringify(result),/Customer identity/);
});
