import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getRuntimeEnv } from '@/db/runtime';
import { QaIntakeForm } from '@/components/qa-intake-form';
import { CheckoutRecovery } from '@/components/checkout-recovery';
export const dynamic = 'force-dynamic';
export default async function QaIntakePage() {
 const user = await getChatGPTUser();
 const owner = getRuntimeEnv().OWNER_EMAIL?.toLowerCase();
 if (!user || !owner || user.email.toLowerCase() !== owner) return <main><h1>Owner access required</h1><a href={chatGPTSignInPath('/dashboard/qa-intake')}>Sign in with your owner account</a></main>;
 return <main className="page-shell" style={{maxWidth:900,margin:'auto',padding:24}}><p><a href="/dashboard">Back to owner dashboard</a></p><h1>Owner-only intake test</h1><p>This creates a retained, clearly labeled test record using the intake validation and storage process. No service agreement, purchase, customer consent, or email delivery is created. Test records are excluded from customer and revenue totals.</p><QaIntakeForm ownerEmail={owner}/><CheckoutRecovery/></main>;
}
