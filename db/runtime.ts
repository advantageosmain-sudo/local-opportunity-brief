type RuntimeEnv = {
  DB?: D1Database;
  OWNER_EMAIL?: string;
  REPORT_SYNC_SECRET?: string;
  REPORT_SYNC_URL?: string;
  PAYMENTS_MODE?: "disabled" | "test";
  LEMON_SQUEEZY_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_WEBHOOK_SECRET?: string;
};

export function getRuntimeEnv(): RuntimeEnv {
  return (
    globalThis as typeof globalThis & {
      __LOCAL_OPPORTUNITY_ENV__?: RuntimeEnv;
    }
  ).__LOCAL_OPPORTUNITY_ENV__ ?? {};
}

export async function ensureDatabase() {
  const database = getRuntimeEnv().DB;
  if (!database) {
    throw new Error("The business database is not connected.");
  }

  await database.batch([
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          contact_name TEXT NOT NULL,
          email TEXT NOT NULL,
          business_name TEXT NOT NULL,
          website TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL,
          state TEXT NOT NULL,
          category TEXT NOT NULL,
          local_radius INTEGER NOT NULL DEFAULT 35,
          products TEXT NOT NULL,
          customers TEXT NOT NULL,
          voice TEXT NOT NULL,
          exclusions TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads(created_at)",
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS leads_email_idx ON leads(email)",
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          customer_slug TEXT NOT NULL,
          business_name TEXT NOT NULL,
          week_of TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          approved_at TEXT,
          delivered_at TEXT
        )`,
      ),
    database
      .prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS reports_customer_week_idx ON reports(customer_slug, week_of)",
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS payment_events (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          event_name TEXT NOT NULL,
          external_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS payment_events_external_id_idx ON payment_events(provider, external_id)",
      ),
  ]);

  return database;
}
