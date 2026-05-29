-- ============================================================================
-- 0011 — Inspection template item description + per-template quick reference
-- ============================================================================
-- Two additions that turn the templates from "list of titles" into actually
-- usable field checklists:
--
--   1. inspection_template_items.description (nullable text)
--      The OOS / Pass-Fail criteria text the tech needs to make the call
--      at each item (e.g. "OOS if lining/pad < 1/4 in (drum)…"). Renders
--      as a small italic helper line under the item title on the runner.
--      Carried through to work_order_items.description on materialization
--      so admins also see it on the review queue.
--
--   2. inspection_templates.quick_reference (nullable text)
--      Per-template cheat sheet of key thresholds (the "Quick Reference"
--      tab in the source Excel files). Renders as a collapsible panel in
--      the inspection runner header.
--
-- Both nullable so existing templates (Reefer Trailer) keep working
-- without backfill. Migration 0012 seeds the new truck + trailer templates
-- and populates these fields.
-- ============================================================================

ALTER TABLE public.inspection_template_items
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.inspection_template_items.description IS
  'Criteria / threshold text shown as a helper line on the runner. Carried through to work_order_items.description on materialization.';

ALTER TABLE public.inspection_templates
  ADD COLUMN IF NOT EXISTS quick_reference text;

COMMENT ON COLUMN public.inspection_templates.quick_reference IS
  'Cheat sheet of key OOS thresholds for this template. Renders as a collapsible panel in the runner header.';
