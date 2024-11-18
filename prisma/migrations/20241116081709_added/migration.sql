/*
  Warnings:

  - A unique constraint covering the columns `[request_id]` on the table `request_approvals` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `request_approvals_request_id_key` ON `request_approvals`(`request_id`);
