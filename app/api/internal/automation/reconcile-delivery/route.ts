import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {isAutomationRequest} from '@/lib/internal-auth';
export async function POST(request:Request) {
 if(!isAutomationRequest(request)) return Response.json({error:'Unauthorized'},{status:401});
 const env=getRuntimeEnv();if(!env.RESEND_API_KEY) return Response.json({error:'Provider unavailable'},{status:503});
 const db=await ensureDatabase();
 const rows=(await db.prepare("SELECT * FROM delivery_attempts WHERE status IN ('accepted','delivered') AND created_at >= datetime('now','-30 days') ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, updated_at ASC LIMIT 50").all()).results as Record<string,string>[];
 let confirmed=0;
 for(const row of rows){
  const response=await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_message_id)}`,{headers:{authorization:`Bearer ${env.RESEND_API_KEY}`}});
  if(!response.ok) continue;
  const result=await response.json() as {id?:string;last_event?:string};
  if(result.id!==row.provider_message_id) continue;
  if(['delivered','opened','clicked'].includes(result.last_event??'')) {
   const now=new Date().toISOString();
   await db.batch([db.prepare("UPDATE delivery_attempts SET status='delivered',updated_at=? WHERE id=?").bind(now,row.id),db.prepare("UPDATE reports SET status='delivered',delivered_at=COALESCE(delivered_at,?) WHERE id=?").bind(now,row.report_id),db.prepare("UPDATE customers SET first_delivered_at=COALESCE(first_delivered_at,?) WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?").bind(now,row.report_id,row.recipient),db.prepare("UPDATE markets SET first_approved_at=COALESCE(first_approved_at,?) WHERE id=(SELECT market_id FROM customers WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?)").bind(now,row.report_id,row.recipient)]);if(row.status==='accepted')confirmed++;
  } else if(['bounced','complained','failed'].includes(result.last_event??'')) {
   await db.batch([db.prepare("UPDATE delivery_attempts SET status='failed' WHERE id=?").bind(row.id),db.prepare("UPDATE customers SET delivery_status='suppressed' WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?").bind(row.report_id,row.recipient),db.prepare("INSERT OR REPLACE INTO diagnostics(id,system,subject_id,code) VALUES(?,'email',?,'PROVIDER_DELIVERY_FAILED')").bind(`delivery-${row.report_id}`,row.report_id)]);
  }
 }
 return Response.json({checked:rows.length,confirmed});
}
