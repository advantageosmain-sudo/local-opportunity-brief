CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`business_name` text NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`category` text NOT NULL,
	`local_radius` integer DEFAULT 35 NOT NULL,
	`products` text NOT NULL,
	`customers` text NOT NULL,
	`voice` text NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_name` text NOT NULL,
	`external_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_slug` text NOT NULL,
	`business_name` text NOT NULL,
	`week_of` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	`delivered_at` text
);
