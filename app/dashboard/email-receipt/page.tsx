import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {ensureDatabase,getRuntimeEnv} from '@/db/runtime';
import {ownerRehearsalIdentityMatches} from '@/lib/owner-rehearsal';
import {ExternalEmailReceiptForm} from '@/components/external-email-receipt';
export const dynamic='force-dynamic';
export default async function EmailReceiptPage(){
 const env=getRuntimeEnv(),user=await getChatGPTUser();
 if(!env.OWNER_EMAIL||user?.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())return <main><h1>Owner access required</h1><a href={chatGPTSignInPath('/dashboard/email-receipt')}>Sign in with your owner account</a></main>;
 const unavailable=<main><h1>External receipt recording unavailable</h1><p>This action needs an approved, exact owner-only receipt and a separately enabled recording gate.</p><a href="/dashboard">Back to dashboard</a></main>;
 const identity={reportId:env.OWNER_REHEARSAL_REPORT_ID,checksum:env.OWNER_REHEARSAL_CHECKSUM,expectedRecipient:env.OWNER_REHEARSAL_RECIPIENT};
 if(env.OWNER_EXTERNAL_RECEIPT_ENABLED!=='1'||!ownerRehearsalIdentityMatches(env,identity))return unavailable;
 const db=await ensureDatabase();
 const row=await db.prepare(`SELECT a.provider_message_id FROM delivery_attempts a JOIN reports r ON r.id=a.report_id
 WHERE a.report_id=? AND a.checksum=? AND a.recipient=? AND a.status IN ('accepted','delivered')
 AND a.provider_message_id IS NOT NULL AND (SELECT COUNT(*) FROM delivery_attempts u WHERE u.provider_message_id=a.provider_message_id)=1 AND json_valid(r.report_json)
 AND json_extract(r.report_json,'$.report.reportId')=a.report_id AND json_extract(r.report_json,'$.report.checksum')=a.checksum
 AND json_extract(r.report_json,'$.report.customer.deliveryMode')='owner_review_only' AND json_extract(r.report_json,'$.report.fixture')=0
 AND json_extract(r.report_json,'$.report.customer.slug')=r.customer_slug AND COALESCE(json_extract(r.report_json,'$.report.customer.isTest'),0)=0
 AND r.customer_slug NOT LIKE 'qa-%'
 AND NOT EXISTS(SELECT 1 FROM customers q WHERE q.id=r.customer_slug AND (q.status='test' OR q.payment_status LIKE 'test_%' OR CASE WHEN json_valid(q.profile_json) THEN COALESCE(json_extract(q.profile_json,'$.isTest'),0) ELSE 1 END=1))
 AND EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=a.report_id AND d.checksum=a.checksum AND d.decision='approve')`).bind(identity.reportId,identity.checksum,identity.expectedRecipient).first<{provider_message_id:string}>();
 if(!row||!/^[\w-]{1,128}$/.test(row.provider_message_id))return unavailable;
 return <main style={{maxWidth:760,margin:'auto',padding:24}}><h1>Record an external owner-verified receipt</h1><p>This records your review of existing provider evidence. It does not send an email or create a signed webhook event.</p><ExternalEmailReceiptForm reportId={identity.reportId!} checksum={identity.checksum!} recipient={identity.expectedRecipient!} providerMessageId={row.provider_message_id}/><p><a href="/dashboard">Back to dashboard</a></p></main>;
}
