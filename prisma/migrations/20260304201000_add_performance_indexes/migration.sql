-- CreateIndex
CREATE INDEX `event_mgt_start_date_idx` ON `event_mgt`(`start_date`);

-- CreateIndex
CREATE INDEX `event_mgt_type_status_start_date_idx` ON `event_mgt`(`event_type`, `event_status`, `start_date`);

-- CreateIndex
CREATE INDEX `request_approval_status_idx` ON `request`(`request_approval_status`);

-- CreateIndex
CREATE INDEX `in_app_notification_is_read_idx` ON `in_app_notification`(`is_read`);

-- CreateIndex
CREATE INDEX `follow_up_assignedTo_idx` ON `follow_up`(`assignedTo`);

-- CreateIndex
CREATE INDEX `follow_up_assigned_date_status_idx` ON `follow_up`(`assignedTo`, `date`, `status`);

-- CreateIndex
CREATE INDEX `orders_reference_idx` ON `orders`(`reference`);

-- CreateIndex
CREATE INDEX `orders_payment_status_idx` ON `orders`(`payment_status`);

-- CreateIndex
CREATE INDEX `appointment_user_date_status_idx` ON `appointment`(`userId`, `date`, `status`);

-- CreateIndex
CREATE INDEX `appointment_user_date_time_idx` ON `appointment`(`userId`, `date`, `startTime`, `endTime`);
