import type { D1Database } from "@/types/cloudflare-d1";
import {stripeSchema} from '@/lib/stripe-payments.mjs';
import {foundingSchema} from '@/lib/founding-capacity.mjs';
type RuntimeEnv = {
  PAYMENTS_PROVIDER?: "stripe" | "lemon_squeezy";
  PUBLIC_SITE_URL?: string;
  STRIPE_API_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  DB?: D1Database;
  SURFACE?: "public" | "owner";
  LIVE_CHECKOUT_VERIFIED?: string;
  PROVIDER_CAPACITY_VERIFIED?: string;
  RESEND_API_KEY?: string;
  DELIVERY_FROM_EMAIL?: string;
  LIVE_DELIVERY?: string;
  OWNER_REHEARSAL_ENABLED?: string;
  OWNER_REHEARSAL_REPORT_ID?: string;
  OWNER_REHEARSAL_CHECKSUM?: string;
  OWNER_REHEARSAL_RECIPIENT?: string;
  OWNER_EMAIL?: string;
  RESEND_WEBHOOK_ENABLED?: string;
  RESEND_WEBHOOK_SECRET?: string;
  OWNER_EXTERNAL_RECEIPT_ENABLED?: string;
  REPORT_SYNC_SECRET?: string;
  OPERATOR_SYNC_SECRET?: string;
  REPORT_SYNC_URL?: string;
  LEARNING_SYNC_URL?: string;
  PAYMENTS_MODE?: "disabled" | "test" | "live";
  LEMON_SQUEEZY_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_VARIANT_ID?: string;
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
    database.prepare(foundingSchema),
    ...stripeSchema.map(schema => database.prepare(schema)),
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
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS opportunity_feedback (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          customer_slug TEXT NOT NULL,
          opportunity_id TEXT NOT NULL,
          rating INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          outcome TEXT NOT NULL DEFAULT 'not_tried',
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS opportunity_feedback_report_opportunity_idx ON opportunity_feedback(report_id, opportunity_id)",
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS opportunity_feedback_customer_idx ON opportunity_feedback(customer_slug)",
      ),
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          actor_email TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events(created_at)",
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events(subject_id)",
      ),
  ]);

  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, lead_id TEXT UNIQUE, email TEXT NOT NULL,
      business_name TEXT NOT NULL, profile_json TEXT NOT NULL DEFAULT '{}',
      market_id TEXT NOT NULL, payment_customer_id TEXT, subscription_id TEXT UNIQUE,
      payment_status TEXT NOT NULL DEFAULT 'unpaid', onboarding_status TEXT NOT NULL DEFAULT 'intake_pending',
      status TEXT NOT NULL DEFAULT 'onboarding', delivery_status TEXT NOT NULL DEFAULT 'pending',
      require_every_review INTEGER NOT NULL DEFAULT 1, first_delivered_at TEXT,
      payment_updated_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL,
      source_registry_json TEXT NOT NULL DEFAULT '[]', first_approved_at TEXT,
      status TEXT NOT NULL DEFAULT 'source_discovery_required')`),
    database.prepare(`CREATE TABLE IF NOT EXISTS report_decisions (
      report_id TEXT NOT NULL, checksum TEXT NOT NULL, decision TEXT NOT NULL,
      actor_email TEXT NOT NULL, decided_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(report_id, checksum))`),
    database.prepare(`CREATE TABLE IF NOT EXISTS diagnostics (
      id TEXT PRIMARY KEY, system TEXT NOT NULL, subject_id TEXT NOT NULL, code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS delivery_attempts (
      id TEXT PRIMARY KEY, report_id TEXT UNIQUE NOT NULL, checksum TEXT NOT NULL,
      status TEXT NOT NULL, provider_message_id TEXT, recipient TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS intake_limits (
      bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0)`)
  ]);
  return database;
}

