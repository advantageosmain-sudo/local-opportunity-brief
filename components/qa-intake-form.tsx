"use client";
import { FormEvent, useState } from 'react';
export function QaIntakeForm({ownerEmail}:{ownerEmail:string}) {
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); setBusy(true); setResult('Saving owner-only test…');
  try {
   const response=await fetch('/api/owner/qa-intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))});
   const data=await response.json();
   setResult(`HTTP ${response.status}: ${data.message || data.error || 'No result message.'}${typeof data.customerId==='string'?` Test record: ${data.customerId}`:''}`);
  } catch {setResult('The test request could not be completed. Check the dashboard before retrying.');}
  finally {setBusy(false);}
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
 <button className="button button-primary" disabled={busy}>{busy?'Saving test…':'Save owner-only test'}</button>
 <p role="status" style={{overflowWrap:'anywhere'}}>{result}</p>
 </form>;
}
