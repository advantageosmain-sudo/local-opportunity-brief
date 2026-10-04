import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    businessName: text("business_name").notNull(),
    website: text("website").notNull().default(""),
    city: text("city").notNull(),
    state: text("state").notNull(),
    category: text("category").notNull(),
    localRadius: integer("local_radius").notNull().default(35),
    products: text("products").notNull(),
    customers: text("customers").notNull(),
    voice: text("voice").notNull(),
    exclusions: text("exclusions").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("new"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("leads_created_at_idx").on(table.createdAt),
    index("leads_email_idx").on(table.email),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    customerSlug: text("customer_slug").notNull(),
    businessName: text("business_name").notNull(),
    weekOf: text("week_of").notNull(),
    status: text("status").notNull().default("draft"),
    reportJson: text("report_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    approvedAt: text("approved_at"),
    deliveredAt: text("delivered_at"),
  },
  (table) => [
    uniqueIndex("reports_customer_week_idx").on(
      table.customerSlug,
      table.weekOf,
    ),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    eventName: text("event_name").notNull(),
    externalId: text("external_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_events_external_id_idx").on(
      table.provider,
      table.externalId,
    ),
  ],
);

// Additive receipt lineage; existing send attempts remain the authority for identity.
export const emailReceiptEvents = sqliteTable('email_receipt_events', {
  eventId: text('event_id').primaryKey(),
  attemptId: text('attempt_id').notNull(),
  reportId: text('report_id').notNull(),
  checksum: text('checksum').notNull(),
  providerMessageId: text('provider_message_id').notNull(),
  recipient: text('recipient').notNull(),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  eventTime: integer('event_time').notNull(),
  rank: integer('rank').notNull(),
  payloadHash: text('payload_hash').notNull(),
  actor: text('actor').notNull().default(''),
  evidenceRef: text('evidence_ref').notNull().default(''),
  processToken: text('process_token').notNull(),
  applied: integer('applied').notNull().default(0),
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table=>[index('email_receipt_attempt_idx').on(table.attemptId)]);
export const emailReceiptState = sqliteTable('email_receipt_state', {
  attemptId: text('attempt_id').primaryKey(),
  eventId: text('event_id').notNull(),
  eventTime: integer('event_time').notNull(),
  rank: integer('rank').notNull(),
});
