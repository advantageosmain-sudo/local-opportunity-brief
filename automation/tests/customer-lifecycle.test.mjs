import test from 'node:test';
import assert from 'node:assert/strict';
import {customerDeliveryGate,paymentTransition} from '../../lib/customer-lifecycle.mjs';
import {parseSubscriptionWebhook} from '../../lib/lemon-squeezy.mjs';
const customer={status:'active',payment_status:'active',onboarding_status:'complete',delivery_status:'pending',profile:{deliveryConsent:true},first_delivered_at:'2026-10-01',require_every_review:0};
test('first customer or market always requires owner review',()=>{
 assert.equal(customerDeliveryGate({...customer,first_delivered_at:null},{marketApproved:true,reportValid:true}).allowed,false);
 assert.equal(customerDeliveryGate(customer,{reportValid:true}).allowed,false);
 assert.equal(customerDeliveryGate(customer,{marketApproved:true,reportValid:true}).allowed,true);
});
test('paused canceled unpaid incomplete and suppression block',()=>{for(const p of [{status:'paused'},{status:'canceled'},{payment_status:'past_due'},{onboarding_status:'intake_pending'},{delivery_status:'suppressed'}])assert.equal(customerDeliveryGate({...customer,...p},{marketApproved:true,reportValid:true,reportApproved:true}).allowed,false);});
test('payment events cannot resume paused customer or apply old events',()=>{
 assert.equal(paymentTransition({...customer,status:'paused'},{status:'active',occurredAt:'2026-10-02T00:00:00Z'}).status,'paused');
 assert.equal(paymentTransition({payment_updated_at:'2026-10-02T00:00:00Z'},{status:'active',occurredAt:'2026-10-01T00:00:00Z'}).apply,false);
});
test('webhook rejects mode mismatch and maps cancellation/failure/resubscription',()=>{
 for(const [name,status] of [['subscription_cancelled','canceled'],['subscription_payment_failed','past_due'],['subscription_resumed','active']]){
 const raw=JSON.stringify({meta:{event_name:name},data:{id:'123',attributes:{test_mode:true,updated_at:'2026-10-02T00:00:00Z'}}});
 assert.equal(parseSubscriptionWebhook(raw,name,'test').status,status);
 assert.throws(()=>parseSubscriptionWebhook(raw,name,'live'));
 }
});
