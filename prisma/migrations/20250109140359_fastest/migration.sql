-- This is an empty migration.
-- Add SQL here
CREATE OR REPLACE VIEW requisition_summary AS
SELECT
    r.id AS requisition_id,
    r.request_id AS generated_id,
    JSON_ARRAYAGG(ri.name) AS product_names,
    r.requisition_date AS date_created,
    r.request_approval_status AS approval_status,
    SUM(ri.unitPrice * ri.quantity) AS total_amount,
    r.user_id AS user_id
FROM
    request r
LEFT JOIN
    requested_product_item ri ON r.id = ri.request_id
GROUP BY
    r.request_id, r.requisition_date, r.request_approval_status;
