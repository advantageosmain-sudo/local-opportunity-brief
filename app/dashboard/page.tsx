import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { getDb } from "@/db";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { leads, reports } from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner dashboard",
  description: "Owner-only view of founding requests and weekly report operations.",
};

type DashboardData = {
  activeReports: number;
  leads: Array<{
    businessName: string;
    category: string;
    city: string;
    createdAt: string;
    email: string;
    id: string;
    state: string;
    status: string;
  }>;
  newLeadCount: number;
  pendingReports: number;
};

async function loadDashboard(): Promise<DashboardData> {
  await ensureDatabase();
  const db = getDb();
  const [recentLeads, newLeads, pending, delivered] = await Promise.all([
    db
      .select({
        id: leads.id,
        businessName: leads.businessName,
        email: leads.email,
        city: leads.city,
        state: leads.state,
        category: leads.category,
        status: leads.status,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(25),
    db.select({ id: leads.id }).from(leads).where(eq(leads.status, "new")),
    db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.status, "pending_approval")),
    db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.status, "delivered")),
  ]);

  return {
    leads: recentLeads,
    newLeadCount: newLeads.length,
    pendingReports: pending.length,
    activeReports: delivered.length,
  };
}

export default async function DashboardPage() {
  const user = await getChatGPTUser();
  const ownerEmail = getRuntimeEnv().OWNER_EMAIL?.trim().toLowerCase();
  const isOwner = Boolean(
    user && ownerEmail && user.email.trim().toLowerCase() === ownerEmail,
  );
  let dashboard: DashboardData | null = null;
  let loadError = "";

  if (isOwner) {
    try {
      dashboard = await loadDashboard();
    } catch {
      loadError = "The owner database is not available yet.";
    }
  }

  return (
    <>
      <Header />
      <main className="page-main">
        <section className="shell dashboard-wrap">
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">Owner operations</p>
              <h1 className="dashboard-title">Monday command desk</h1>
              <p className="dashboard-subtitle">
                Founding requests, report approvals, and safe delivery status.
              </p>
            </div>
            {user && (
              <a className="button button-secondary" href={chatGPTSignOutPath("/")}>
                Sign out
              </a>
            )}
          </div>

          {!user && (
            <div className="empty-panel">
              <h2>Owner sign-in required</h2>
              <p>
                Customer information is protected. Sign in with the approved
                owner account to view business operations.
              </p>
              <a
                className="button button-primary"
                href={chatGPTSignInPath("/dashboard")}
                style={{ marginTop: 20 }}
              >
                Sign in with ChatGPT
              </a>
            </div>
          )}

          {user && !ownerEmail && (
            <div className="empty-panel">
              <h2>Owner email must be connected</h2>
              <p>
                Set the protected OWNER_EMAIL value to the email used for this
                ChatGPT account. Until then, no customer records are shown.
              </p>
            </div>
          )}

          {user && ownerEmail && !isOwner && (
            <div className="empty-panel">
              <h2>Access not approved</h2>
              <p>
                This account is signed in, but it is not the designated business
                owner account.
              </p>
            </div>
          )}

          {isOwner && loadError && (
            <div className="empty-panel">
              <h2>Dashboard is waiting for its database</h2>
              <p>{loadError}</p>
            </div>
          )}

          {dashboard && (
            <>
              <div className="metric-grid">
                <article className="metric">
                  <span>New founding requests</span>
                  <strong>{dashboard.newLeadCount}</strong>
                </article>
                <article className="metric">
                  <span>Reports awaiting approval</span>
                  <strong>{dashboard.pendingReports}</strong>
                </article>
                <article className="metric">
                  <span>Reports delivered</span>
                  <strong>{dashboard.activeReports}</strong>
                </article>
              </div>

              <section className="dashboard-panel">
                <h2>Recent founding requests</h2>
                {dashboard.leads.length === 0 ? (
                  <p className="dashboard-subtitle">No requests have arrived yet.</p>
                ) : (
                  <table className="lead-table">
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th>Contact</th>
                        <th>Status</th>
                        <th>Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.leads.map((lead) => (
                        <tr key={lead.id}>
                          <td>{lead.businessName}</td>
                          <td>
                            {lead.city}, {lead.state}
                          </td>
                          <td>{lead.category.replaceAll("-", " ")}</td>
                          <td>{lead.email}</td>
                          <td>
                            <span className="status-pill">{lead.status}</span>
                          </td>
                          <td>{lead.createdAt.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
