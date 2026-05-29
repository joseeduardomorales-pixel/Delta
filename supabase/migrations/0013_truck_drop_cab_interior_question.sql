-- ============================================================================
-- 0013 — Drop the cab-interior final-assessment question from truck template
-- ============================================================================
-- Per Lalo: the 3rd closing yes/no question on the truck template
-- ("Is the cab interior, mirrors, and lighting up to customer / DOT
-- standards?") doesn't fit the truck inspection use case. Drop it.
--
-- The truck template now ends with 2 closing yes/no questions instead
-- of 3 (Safe to road + Pass DOT). The trailer + reefer templates keep
-- all 3 (their third question is about cargo box / CTPAT, which is
-- meaningful on trailers).
--
-- We also drop any already-materialized work_order_items that point at
-- the deleted template item. The FK is ON DELETE SET NULL but the
-- work_order_items source_consistency CHECK refuses NULL for
-- inspection_template-sourced items, so the row has to go too.
-- ============================================================================

-- 1. Drop any materialized WO items first (otherwise the source_consistency
--    CHECK rejects the ON DELETE SET NULL fallback).
DELETE FROM public.work_order_items
WHERE source_inspection_template_item_id IN (
  SELECT id FROM public.inspection_template_items
  WHERE template_id IN (
    SELECT id FROM public.inspection_templates
    WHERE name = 'Truck Brake & Tire Inspection'
  )
  AND section = 'FINAL ASSESSMENT'
  AND text ILIKE '%cab interior%'
);

-- 2. Now safe to drop the template item.
DELETE FROM public.inspection_template_items
WHERE template_id IN (
  SELECT id FROM public.inspection_templates
  WHERE name = 'Truck Brake & Tire Inspection'
)
AND section = 'FINAL ASSESSMENT'
AND text ILIKE '%cab interior%';
