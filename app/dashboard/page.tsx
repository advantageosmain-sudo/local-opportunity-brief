import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { setLeadPilotStatus } from "@/app/dashboard/actions";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { getDb } from "@/db";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { leads, paymentEvents, reports } from "@/db/schema";
import { buildTestCheckoutUrl } from "@/lib/lemon-squeezy.mjs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner dashboard",
  description: "Owner-only view of founding requests and weekly report operations.",
};

type DashboardLead = {
  businessName: string;
  category: string;
  city: string;
  createdAt: string;
  email: string;
  id: string;
  state: string;
  status: string;
};

type DashboardReport = {
  businessName: string;
  fixture: boolean;
  id: string;
  opportunityCount: number;
  status: string;
  validationPassed: boolean;
  warningCount: number;
  weekOf: string;
};

type DashboardData = {
  activeReports: number;
  leads: DashboardLead[];
  newLeadCount: number;
  pendingReports: number;
  reports: DashboardReport[];
  testPaymentCount: number;
};

async function loadDashboard(): Promise<DashboardData> {
  await ensureDatabase();
  const db = getDb();
  const [recentLeads, newLeads, reportRows, testPayments] = await Promise.all([
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
      .select({
        id: reports.id,
        businessName: reports.businessName,
        weekOf: reports.weekOf,
        status: reports.status,
        reportJson: reports.reportJson,
      })
      .from(reports)
      .orderBy(desc(reports.createdAt))
      .limit(25),
    db
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(eq(paymentEvents.provider, "lemon_squeezy_test")),
  ]);

  const parsedReports = reportRows.map((row) => parseDashboardReport(row));
  return {
    leads: recentLeads,
    newLeadCount: newLeads.length,
    reports: parsedReports,
    pendingReports: parsedReports.filter((report) => report.status.includes("pending_approval")).length,
    activeReports: parsedReports.filter((report) => report.status === "delivered").length,
    testPaymentCount: testPayments.length,
  };
}

function parseDashboardReport(row: {
  businessName: string;
  id: string;
  reportJson: string;
  status: string;
  weekOf: string;
}): DashboardReport {
  try {
    const packet = JSON.parse(row.reportJson);
    return {
      id: row.id,
      businessName: row.businessName,
      weekOf: row.weekOf,
      status: row.status,
      fixture: Boolean(packet.report?.fixture),
      opportunityCount: packet.report?.opportunities?.length ?? 0,
      validationPassed: packet.validation?.passed === true,
      warningCount: packet.validation?.warnings?.length ?? 0,
    };
  } catch {
    return {
      id: row.id,
      businessName: row.businessName,
      weekOf: row.weekOf,
      status: "invalid_record",
      fixture: false,
      opportunityCount: 0,
      validationPassed: false,
      warningCount: 0,
    };
  }
}

function checkoutLinkForLead(lead: DashboardLead): string | null {
  const env = getRuntimeEnv();
  if (
    lead.status !== "approved_for_test_checkout" ||
    env.PAYMENTS_MODE !== "test" ||
    !env.LEMON_SQUEEZY_CHECKOUT_URL
  ) {
    return null;
  }
  try {
    return buildTestCheckoutUrl(env.LEMON_SQUEEZY_CHECKOUT_URL, lead.id);
  } catch {
    return null;
  }
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
                Founding requests, verified report packets, test checkout, and safe delivery status.
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
              <div className="system-lock" role="status">
                <strong>Safe operating mode is on.</strong>
                <span>
                  Public launch, live charges, and automatic customer email remain disabled.
                </span>
              </div>
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
                <article className="metric">
                  <span>Test payment events</span>
                  <strong>{dashboard.testPaymentCount}</strong>
                </article>
              </div>

              <section className="dashboard-panel">
                <h2>Generated report packets</h2>
                {dashboard.reports.length === 0 ? (
                  <p className="dashboard-subtitle">
                    No generated reports have been synchronized yet.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="lead-table">
                      <thead>
                        <tr>
                          <th>Business</th>
                          <th>Week</th>
                          <th>Opportunities</th>
                          <th>Validation</th>
                          <th>Warnings</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.reports.map((report) => (
                          <tr key={report.id}>
                            <td>
                              {report.businessName}
                              {report.fixture && <small className="table-note">Demo data</small>}
                            </td>
                            <td>{report.weekOf}</td>
                            <td>{report.opportunityCount}</td>
                            <td>{report.validationPassed ? "Passed" : "Blocked"}</td>
                            <td>{report.warningCount}</td>
                            <td>
                              <span className="status-pill">{report.status.replaceAll("_", " ")}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="dashboard-panel">
                <h2>Recent founding requests</h2>
                {dashboard.leads.length === 0 ? (
                  <p className="dashboard-subtitle">No requests have arrived yet.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="lead-table">
                      <thead>
                        <tr>
                          <th>Business</th>
                          <th>Location</th>
                          <th>Type</th>
                          <th>Contact</th>
                          <th>Status</th>
                          <th>Received</th>
                          <th>Owner action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.leads.map((lead) => {
                          const checkoutLink = checkoutLinkForLead(lead);
                          return (
                            <tr key={lead.id}>
                              <td>{lead.businessName}</td>
                              <td>
                                {lead.city}, {lead.state}
                              </td>
                              <td>{lead.category.replaceAll("-", " ")}</td>
                              <td>{lead.email}</td>
                              <td>
                                <span className="status-pill">{lead.status.replaceAll("_", " ")}</span>
                              </td>
                              <td>{lead.createdAt.slice(0, 10)}</td>
                              <td>
                                <div className="lead-actions">
                                  <form action={setLeadPilotStatus}>
                                    <input type="hidden" name="leadId" value={lead.id} />
                                    <button className="action-button" name="status" value="research_ready">
                                      Research ready
                                    </button>
                                  </form>
                                  <form action={setLeadPilotStatus}>
                                    <input type="hidden" name="leadId" value={lead.id} />
                                    <button
                                      className="action-button"
                                      name="status"
                                      value="approved_for_test_checkout"
                                    >
                                      Approve test checkout
                                    </button>
                                  </form>
                                  <form action={setLeadPilotStatus}>
                                    <input type="hidden" name="leadId" value={lead.id} />
                                    <button className="action-button action-button-danger" name="status" value="rejected">
                                      Reject
                                    </button>
                                  </form>
                                  {checkoutLink && (
                                    <a className="action-button action-link" href={checkoutLink}>
                                      Open safe test checkout
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="dashboard-footnote">
                  A test checkout appears only after owner approval and only when the
                  payment provider is configured in test mode. This screen cannot create a live charge.
                </p>
              </section>
            </>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
