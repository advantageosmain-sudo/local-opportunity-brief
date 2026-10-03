"use client";

import {useEffect,useRef,useState} from 'react';

export function CheckoutRecovery() {
 const [busy,setBusy]=useState(false);
 const [done,setDone]=useState(false);
 const [message,setMessage]=useState('');
 const inFlight=useRef(false);
 const sequence=useRef(0);
 useEffect(()=>{
  const leave=()=>{sequence.current++;};
  const resume=(event:PageTransitionEvent)=>{if(event.persisted){leave();inFlight.current=false;setBusy(false);setMessage('Returned to recovery. A repeated check preserves any completed recovery.');}};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',resume);
  return ()=>{leave();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',resume);};
 },[]);
 async function recover() {
  if(inFlight.current||done)return;
  inFlight.current=true;const requestId=++sequence.current;setBusy(true);setMessage('Checking the reviewed sandbox attempt…');
  try {
   const response=await fetch('/api/owner/stripe-checkout-recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerId:'qa-7756c0b278365a5f4055dbf082a25b1cc3b3d8f0f18fce475ffc743a0ce30496',attemptId:'71bb3487-c303-4a48-bc7f-9ea91a2f6488',confirmation:'retire-rejected-test-attempt'})});
   const data=await response.json();
   if(sequence.current!==requestId)return;
   if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Recovery could not be confirmed.');
   if(!['recovered','already_recovered'].includes(data.status)||typeof data.message!=='string')throw new Error('Recovery returned an unexpected result.');
   setDone(true);setMessage(data.message);
  } catch(error) {if(sequence.current===requestId)setMessage(error instanceof Error?error.message:'Recovery could not be confirmed. Check the retained evidence before retrying.');}
  finally {if(sequence.current===requestId){inFlight.current=false;setBusy(false);}}
 }
 return <section className="form-section" aria-label="Reviewed sandbox checkout recovery">
  <h2>Recover the rejected sandbox attempt</h2>
  <p>This applies only to the October 2 test checkout rejected for missing Stripe permissions. It checks for existing sessions, archives the rejected attempt, and preserves the test customer and reserved place. It does not open checkout or change payment permissions.</p>
  <button type="button" className="button button-secondary" disabled={busy||done} onClick={recover}>{busy?'Checking recovery…':done?'Test attempt recovered':'Recover rejected sandbox checkout'}</button>
  <p role="status">{message}</p>
 </section>;
}
