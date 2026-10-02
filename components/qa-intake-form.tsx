"use client";

import { FormEvent, useEffect, useRef, useState } from 'react';

export function QaIntakeForm({ownerEmail}:{ownerEmail:string}) {
 const [busy,setBusy]=useState<'saving'|'checkout'|'portal'|null>(null);
 const [result,setResult]=useState('');
 const [savedCustomerId,setSavedCustomerId]=useState<string|null>(null);
 const inFlight=useRef(false);
 const requestSequence=useRef(0);

 useEffect(() => {
  function leave() { requestSequence.current+=1; }
  function resume(event:PageTransitionEvent) {
   if(event.persisted) {
    leave();
    inFlight.current=false;
    setBusy(null);
    setResult('Returned to the owner-only test. Billing status must be confirmed by a verified Stripe webhook.');
   }
  }
  window.addEventListener('pageshow',resume);
  window.addEventListener('pagehide',leave);
  return () => {
   leave();
   window.removeEventListener('pageshow',resume);
   window.removeEventListener('pagehide',leave);
  };
 },[]);

 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if(inFlight.current)return;
  inFlight.current=true;
  const requestId=++requestSequence.current;
  setBusy('saving');
  setSavedCustomerId(null);
  setResult('Saving owner-only test…');
  try {
   const response=await fetch('/api/owner/qa-intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))});
   const data=await response.json();
   if(requestSequence.current!==requestId)return;
   setResult(`HTTP ${response.status}: ${data.message || data.error || 'No result message.'}${typeof data.customerId==='string'?` Test record: ${data.customerId}`:''}`);
   if(response.ok && data.isTest===true && typeof data.customerId==='string' && /^qa-[a-f0-9]{64}$/.test(data.customerId)) {
    setSavedCustomerId(data.customerId);
   }
  } catch {if(requestSequence.current===requestId)setResult('The test request could not be completed. Check the dashboard before retrying.');}
  finally {if(requestSequence.current===requestId){inFlight.current=false;setBusy(null);}}
 }

 async function openSandbox(action:'checkout'|'portal') {
  if(!savedCustomerId || inFlight.current)return;
  inFlight.current=true;
  const requestId=++requestSequence.current;
  setBusy(action);
  setResult(action==='checkout'?'Opening sandbox checkout with fake money…':'Opening sandbox billing management…');
  let redirected=false;
  try {
   const endpoint=action==='checkout'?'/api/owner/stripe-checkout':'/api/owner/stripe-portal';
   const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerId:savedCustomerId})});
   const data=await response.json();
   if(requestSequence.current!==requestId)return;
   if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Sandbox billing is unavailable.');
   if(typeof data.url!=='string')throw new Error('No sandbox billing link was returned.');
   const url=new URL(data.url);
   const expectedHost=action==='checkout'?'checkout.stripe.com':'billing.stripe.com';
   if(url.protocol!=='https:' || url.hostname!==expectedHost || url.port || url.username || url.password)throw new Error('Sandbox billing address is invalid.');
   window.location.assign(url.href);
   redirected=true;
  } catch(error) {
   if(requestSequence.current!==requestId)return;
   setResult(error instanceof Error?error.message:'Sandbox billing could not be opened.');
  } finally {
   if(requestSequence.current===requestId && !redirected){inFlight.current=false;setBusy(null);}
  }
 }
 return <form className="intake-form" onSubmit={submit}>
 <div className="field-grid">
 <div className="field"><label htmlFor="qa-contact">Test contact name</label><input id="qa-contact" name="contactName" required maxLength={100} defaultValue="Michelle — owner-only test"/></div>
 <div className="field"><label htmlFor="qa-email">Owner email</label><input id="qa-email" name="email" type="email" required maxLength={180} defaultValue={ownerEmail}/></div>
 <div className="field"><label htmlFor="qa-business">Test business name</label><input id="qa-business" name="businessName" required maxLength={140} defaultValue="OWNER-ONLY TEST — Olympia intake QA 2026-10-02"/></div>
 <div className="field"><label htmlFor="qa-city">City</label><input id="qa-city" name="city" required defaultValue="Olympia" maxLength={100}/></div>
 <div className="field"><label htmlFor="qa-state">State</label><input id="qa-state" name="state" required minLength={2} maxLength={2} defaultValue="WA"/></div>
 <div className="field"><label htmlFor="qa-zip">ZIP code</label><input id="qa-zip" name="zip" required pattern="[0-9]{5}(-[0-9]{4})?" defaultValue="98501"/></div>
 <div className="field"><label htmlFor="qa-category">Business type</label><select id="qa-category" name="category" defaultValue="boutique"><option value="boutique">Independent boutique</option><option value="gift-shop">Gift shop</option><option value="apparel-shop">Local apparel shop</option><option value="other-retail">Other independent retail</option></select></div>
 <div className="field"><label htmlFor="qa-radius">Local radius</label><select id="qa-radius" name="localRadius" defaultValue="25"><option value="15">15 miles</option><option value="25">25 miles</option><option value="35">35 miles</option><option value="50">50 miles</option></select></div>
 <div className="field field-full"><label htmlFor="qa-products">Illustrative products</label><textarea id="qa-products" name="products" required maxLength={1500} defaultValue="Synthetic test only: gifts and apparel, $15–$75"/></div>
 <div className="field field-full"><label htmlFor="qa-customers">Illustrative customers</label><textarea id="qa-customers" name="customers" required maxLength={1200} defaultValue="Synthetic adult local shoppers; no real customer data"/></div>
 <div className="field"><label htmlFor="qa-voice">Preferred voice</label><input id="qa-voice" name="voice" required maxLength={300} defaultValue="Warm and factual"/></div>
 <input name="deliveryDay" type="hidden" value="monday"/>
 <input name="notes" type="hidden" value="OWNER-ONLY QA: retained test evidence. No agreement, purchase, customer consent, or delivery authorization."/>
 </div>
 <label className="consent"><input type="checkbox" name="qaAcknowledged" value="yes" required/> I am creating synthetic owner-only test evidence, with no purchase or service agreement.</label>
 <button className="button button-primary" type="submit" disabled={busy !== null}>{busy === 'saving'?'Saving test…':'Save owner-only test'}</button>
 {savedCustomerId && <section className="form-section" aria-label="Sandbox billing for saved owner-only test">
 <h2>Sandbox billing</h2>
 <p>Use fake money only. These actions do not record a real service agreement or delivery consent. Billing management is available after a sandbox customer has been created.</p>
 <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => openSandbox('checkout')}>Sandbox checkout (fake money)</button>
 <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => openSandbox('portal')}>Sandbox billing management</button>
 </section>}
 <p role="status" style={{overflowWrap:'anywhere'}}>{result}</p>
 </form>;
}

