CREATE TABLE `ai_conversation` (
    `id` VARCHAR(191) NOT NULL,
    `created_by` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `ai_conversation_created_by_idx`(`created_by`),
    INDEX `ai_conversation_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_message` (
    `id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `provider` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_message_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `ai_message_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `message_id` VARCHAR(191) NOT NULL,
    `prompt_tokens` INTEGER NOT NULL,
    `completion_tokens` INTEGER NOT NULL,
    `total_tokens` INTEGER NOT NULL,
    `message_count` INTEGER NOT NULL DEFAULT 1,
    `cost_estimate` DOUBLE NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_ledger_created_at_idx`(`created_at`),
    INDEX `ai_usage_ledger_conversation_id_idx`(`conversation_id`),
    INDEX `ai_usage_ledger_provider_model_idx`(`provider`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_quota` (
    `id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `message_limit` INTEGER NOT NULL,
    `token_limit` INTEGER NOT NULL,
    `message_used` INTEGER NOT NULL DEFAULT 0,
    `token_used` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_usage_quota_period_start_period_end_key`(`period_start`, `period_end`),
    INDEX `ai_usage_quota_period_start_period_end_idx`(`period_start`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_pricing_catalog` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `input_token_cost` DOUBLE NOT NULL,
    `output_token_cost` DOUBLE NOT NULL,
    `effective_from` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `ai_pricing_catalog_provider_model_effective_from_idx`(`provider`, `model`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `metadata` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_audit_log_actor_id_idx`(`actor_id`),
    INDEX `ai_audit_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_idempotency_key` (
    `id` VARCHAR(191) NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `request_hash` VARCHAR(191) NOT NULL,
    `response_payload` LONGTEXT NULL,
    `status_code` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_idempotency_key_actor_id_endpoint_key_key`(`actor_id`, `endpoint`, `key`),
    INDEX `ai_idempotency_key_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_message`
    ADD CONSTRAINT `ai_message_conversation_id_fkey`
    FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_usage_ledger`
    ADD CONSTRAINT `ai_usage_ledger_conversation_id_fkey`
    FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_usage_ledger`
    ADD CONSTRAINT `ai_usage_ledger_message_id_fkey`
    FOREIGN KEY (`message_id`) REFERENCES `ai_message`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
