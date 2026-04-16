-- Backfill: add Beginner → Expert level definitions for any competency that has none.
-- Does not modify competencies that already have at least one row in competency_level_definitions.

INSERT INTO public.competency_level_definitions (
  competency_id,
  level_name,
  level_order,
  description,
  is_active
)
SELECT
  c.id,
  v.level_name,
  v.level_order,
  NULL::text,
  true
FROM public.competencies c
CROSS JOIN (
  VALUES
    ('Beginner'::text, 1),
    ('Intermediate', 2),
    ('Advanced', 3),
    ('Expert', 4)
) AS v(level_name, level_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.competency_level_definitions d
  WHERE d.competency_id = c.id
);
