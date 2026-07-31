CREATE INDEX `leads_created_at_idx` ON `leads` (`created_at`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_external_id_idx` ON `payment_events` (`provider`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_customer_week_idx` ON `reports` (`customer_slug`,`week_of`);