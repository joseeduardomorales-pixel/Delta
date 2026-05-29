-- ============================================================================
-- 0010 — Photo-optional flag on inspection template items
-- ============================================================================
-- Background. The PATCH /api/inspections/:id/items/:itemId endpoint
-- enforces a blanket rule: any fail (pass_fail='fail' OR a yes_no with
-- the wrong good_answer) requires notes AND ≥1 photo. That's correct
-- for physical defect checks (e.g. "Drain valve not functional" should
-- be photographed) but wrong for the 3 closing summary questions on
-- the Reefer Trailer template:
--
--   - Is this trailer SAFE to go on the road?
--   - If inspected by a highway officer, would this trailer pass?
--   - Is the interior cleanliness, hermeticity, and quality up to
--     customer standards and CTPAT safe?
--
-- These are subjective summary judgments, not specific defects to
-- document. Notes still belong (tech should explain a NO), but a
-- photo doesn't add value.
--
-- This migration adds a per-item opt-out. Default `true` preserves
-- the current strict behavior; only flagged items skip the photo
-- requirement. Then we backfill `false` onto the 3 final-assessment
-- items in the existing Reefer Trailer template so they ship with the
-- correct behavior.
-- ============================================================================

ALTER TABLE public.inspection_template_items
  ADD COLUMN IF NOT EXISTS requires_photo_on_fail boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.inspection_template_items.requires_photo_on_fail IS
  'When true (default): a fail/wrong-yes_no result MUST attach >=1 photo. When false: photo is optional; notes still required.';

-- Backfill: flag the 3 final-assessment items in the existing Reefer
-- Trailer template. Match by their text (the safest identifier — the
-- template id may differ between environments, but the seeded text is
-- stable; if you change the wording, re-run the matching predicate).
UPDATE public.inspection_template_items
SET requires_photo_on_fail = false
WHERE kind = 'yes_no'
  AND template_id IN (
    SELECT id FROM public.inspection_templates
    WHERE scope = 'reefer_trailer'
  )
  AND (
    text ILIKE '%SAFE to go on the road%'
    OR text ILIKE '%highway officer%'
    OR text ILIKE '%interior cleanliness%'
    OR text ILIKE '%CTPAT%'
  );
