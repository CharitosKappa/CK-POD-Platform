WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(value)
           ORDER BY created_at, id
         ) AS canonical_id
  FROM app.customer_tags
), duplicates AS (
  SELECT id, canonical_id FROM ranked WHERE id <> canonical_id
)
INSERT INTO app.customer_profile_tags (customer_profile_id, customer_tag_id, created_at)
SELECT relation.customer_profile_id, duplicate.canonical_id, relation.created_at
FROM app.customer_profile_tags relation
JOIN duplicates duplicate ON duplicate.id = relation.customer_tag_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(value)
           ORDER BY created_at, id
         ) AS canonical_id
  FROM app.customer_tags
)
DELETE FROM app.customer_profile_tags relation
USING ranked duplicate
WHERE relation.customer_tag_id = duplicate.id
  AND duplicate.id <> duplicate.canonical_id;
--> statement-breakpoint
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(value)
           ORDER BY created_at, id
         ) AS canonical_id
  FROM app.customer_tags
)
DELETE FROM app.customer_tags tag
USING ranked duplicate
WHERE tag.id = duplicate.id
  AND duplicate.id <> duplicate.canonical_id;
--> statement-breakpoint
CREATE UNIQUE INDEX customer_tags_value_case_insensitive_idx
  ON app.customer_tags(lower(value));
