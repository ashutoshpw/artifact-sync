CREATE TABLE `team_slug_change_locks` (
	`team_id` text PRIMARY KEY NOT NULL,
	`last_changed_at` integer NOT NULL,
	`claim_id` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `team_slugs` (
	`slug` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`is_current` integer NOT NULL,
	`created_at` integer NOT NULL,
	`changed_at` integer,
	`changed_by_user_id` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `team_slugs_team_idx` ON `team_slugs` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_slugs_current_unique` ON `team_slugs` (`team_id`) WHERE "team_slugs"."is_current" = 1;--> statement-breakpoint
INSERT INTO `team_slugs` (`slug`, `team_id`, `is_current`, `created_at`, `changed_at`, `changed_by_user_id`)
SELECT `slug`, `id`, 1, `created_at`, NULL, NULL FROM `teams`;--> statement-breakpoint
WITH `ranked_admins` AS (
  SELECT `rowid` AS `membership_rowid`, ROW_NUMBER() OVER (
    PARTITION BY `team_id` ORDER BY `created_at` ASC, `user_id` ASC
  ) AS `position`
  FROM `team_memberships`
  WHERE `role` = 'admin'
)
UPDATE `team_memberships`
SET `role` = 'owner'
WHERE `rowid` IN (SELECT `membership_rowid` FROM `ranked_admins` WHERE `position` = 1);--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `device_name` text;--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `client_version` text;--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `claim_id` text;--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `device_authorizations` ADD `delivered_at` integer;