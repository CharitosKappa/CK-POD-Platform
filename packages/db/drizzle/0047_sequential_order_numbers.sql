CREATE SEQUENCE app.order_number_sequence AS bigint START WITH 1;
--> statement-breakpoint
WITH numbered_orders AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS sequence_number
  FROM app.orders
)
UPDATE app.orders AS orders
SET order_number = '#' || numbered_orders.sequence_number::text
FROM numbered_orders
WHERE orders.id = numbered_orders.id;
--> statement-breakpoint
SELECT setval(
  'app.order_number_sequence',
  GREATEST((SELECT count(*) FROM app.orders), 1),
  EXISTS(SELECT 1 FROM app.orders)
);
--> statement-breakpoint
ALTER TABLE app.orders
  ALTER COLUMN order_number SET DEFAULT ('#' || nextval('app.order_number_sequence'::regclass)::text);
