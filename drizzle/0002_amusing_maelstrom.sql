CREATE TABLE `email_receipt_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`report_id` text NOT NULL,
	`checksum` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`recipient` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`event_time` integer NOT NULL,
	`rank` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`actor` text DEFAULT '' NOT NULL,
	`evidence_ref` text DEFAULT '' NOT NULL,
	`process_token` text NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_receipt_attempt_idx` ON `email_receipt_events` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `email_receipt_state` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_time` integer NOT NULL,
	`rank` integer NOT NULL
);
