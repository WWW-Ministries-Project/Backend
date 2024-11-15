-- Add SQL here
CREATE VIEW requisition_summary AS
SELECT
    r.request_id AS requisition_id,
    JSON_ARRAYAGG(ri.name) AS product_names,
    r.requisition_date AS date_created,
    r.request_approval_status AS approval_status,
    SUM(ri.unitPrice * ri.quantity) AS total_amount
FROM
    request r
LEFT JOIN
    requested_product_item ri ON r.id = ri.request_id
GROUP BY
    r.request_id, r.requisition_date, r.request_approval_status;
