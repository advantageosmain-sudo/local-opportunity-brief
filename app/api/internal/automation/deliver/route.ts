import { renderMarkdown } from "@/automation/lib/engine.mjs";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { isAutomationRequest } from "@/lib/internal-auth";
import { validateCurrentReportPacket } from "@/lib/report-sync.mjs";
import { customerDeliveryGate } from "@/lib/customer-lifecycle.mjs";
export async function POST(request: Request) {
 if (!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const env=getRuntimeEnv();
 if(env.LIVE_DELIVERY!=='1'||!env.RESEND_API_KEY||!env.DELIVERY_FROM_EMAIL) return Response.json({error:'Delivery provider not enabled.'},{status:503});
 let input;
 try {input=await request.json();} catch {return Response.json({error:'Invalid request'},{status:400});}
 if(!/^[a-z0-9-]{1,160}$/.test(input.reportId??'')||!/^[a-f0-9]{64}$/.test(input.checksum??'')) return Response.json({error:'Invalid report identity'},{status:400});
 const db=await ensureDatabase();
 const row=await db.prepare('SELECT * FROM reports WHERE id=?').bind(input.reportId).first<Record<string,unknown>>();
 if(row && !['pending_approval','owner_approved'].includes(String(row.status))) return Response.json({error:'Report is not eligible after owner decision or prior delivery.'},{status:409});
 if(!row) return Response.json({error:'Report missing'},{status:404});
 const packet=JSON.parse(String(row.report_json));
 const r=packet.report;
 if(r.checksum!==input.checksum||r.fixture||! (await validateCurrentReportPacket(packet)).passed) return Response.json({error:'Report validation failed'},{status:409});
 const decision=await db.prepare("SELECT * FROM report_decisions WHERE report_id=? AND checksum=? AND decision='approve'").bind(r.reportId,r.checksum).first();
 const ownerTest=r.customer?.deliveryMode==='owner_review_only';
 let recipient=env.OWNER_EMAIL;
 if(ownerTest) { if(!decision) return Response.json({error:'Owner test report needs exact review'},{status:409}); }
 else {
 const customer=await db.prepare('SELECT c.*,m.first_approved_at FROM customers c LEFT JOIN markets m ON c.market_id=m.id WHERE c.id=?').bind(r.customer.slug).first<Record<string,unknown>>();
 if(!customer||!customerDeliveryGate(customer,{marketApproved:Boolean(customer.first_approved_at),reportApproved:Boolean(decision),reportValid:true}).allowed) return Response.json({error:'Customer delivery gate blocked'},{status:409});
 recipient=String(customer.email);
 }
 if(!recipient||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return Response.json({error:'Recipient invalid'},{status:409});
 const claimed=await db.prepare(`INSERT OR IGNORE INTO delivery_attempts(id,report_id,checksum,status,recipient)
 SELECT ?,r.id,?,'claimed',? FROM reports r
 WHERE r.id=? AND r.status IN ('pending_approval','owner_approved')
 AND json_extract(r.report_json,'$.report.checksum')=?
 AND (
   (?=1 AND EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=r.id AND d.checksum=? AND d.decision='approve'))
   OR (?=0 AND EXISTS(SELECT 1 FROM customers c LEFT JOIN markets m ON c.market_id=m.id
     WHERE c.id=r.customer_slug AND c.status='active' AND c.payment_status='active'
       AND c.onboarding_status='complete' AND c.delivery_status!='suppressed'
       AND json_extract(c.profile_json,'$.deliveryConsent')=1
       AND c.email=?
       AND (EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=r.id AND d.checksum=? AND d.decision='approve')
         OR (c.require_every_review=0 AND c.first_delivered_at IS NOT NULL AND m.first_approved_at IS NOT NULL))
   ))
 )`).bind(crypto.randomUUID(),r.checksum,recipient,r.reportId,r.checksum,ownerTest?1:0,r.checksum,ownerTest?1:0,recipient,r.checksum).run();
 if(claimed.meta.changes!==1) return Response.json({error:'Delivery already claimed, accepted or uncertain; inspect provider before retrying.'},{status:409});
 try {
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':`lob/${r.reportId}`},body:JSON.stringify({from:env.DELIVERY_FROM_EMAIL,to:[recipient],subject:`Local Opportunity Brief — ${r.customer.businessName} — ${r.weekOf}`,text:renderMarkdown(r,packet.validation)+'\n\nSales and traffic are not guaranteed.'})});
 if(!response.ok) throw new Error('Provider rejected or uncertain');
 const result=await response.json() as {id?:string};
 if(!result.id) throw new Error('Message identity missing');
 await db.batch([db.prepare("UPDATE delivery_attempts SET status='accepted',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE report_id=?").bind(result.id,r.reportId),db.prepare("UPDATE reports SET status='email_accepted' WHERE id=?").bind(r.reportId)]);
 // Acceptance is not a delivery confirmation. First-delivered eligibility remains held until verified receipt.
 return Response.json({status:'ACCEPTED',reportId:r.reportId,checksum:r.checksum,providerMessageId:result.id,ownerTest});
 } catch {
 await db.batch([db.prepare("UPDATE delivery_attempts SET status='unknown',updated_at=CURRENT_TIMESTAMP WHERE report_id=?").bind(r.reportId),db.prepare("INSERT OR REPLACE INTO diagnostics(id,system,subject_id,code) VALUES(?,'email',?,'UNKNOWN_DELIVERY_LOCKED')").bind(`delivery-${r.reportId}`,r.reportId)]);
 return Response.json({error:'Provider result uncertain. Automatic retries locked.'},{status:502});
 }
}
