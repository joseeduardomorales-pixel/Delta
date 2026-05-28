-- ============================================================================
-- Delta — action_photos.work_order_item_id (Phase 8)
-- ----------------------------------------------------------------------------
-- Photos currently live keyed only by work_order_id. That's enough for the
-- kardex view, but the inspection-runner UI needs to know "which photos
-- belong to THIS line item" so the tech can edit a failed item without
-- losing existing photos.
--
-- Adds an optional work_order_item_id FK. Existing rows keep
-- work_order_item_id = NULL (they were attached to the WO, not a
-- specific item). Future inspection-fail uploads set both columns.
-- ============================================================================

ALTER TABLE public.action_photos
  ADD COLUMN IF NOT EXISTS work_order_item_id uuid
    REFERENCES public.work_order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_photos_item
  ON public.action_photos (work_order_item_id)
  WHERE work_order_item_id IS NOT NULL;

-- Sanity check — RLS coverage unchanged.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname NOT LIKE 'pg_%'
      AND c.relname NOT IN ('schema_migrations');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Tables missing RLS: %', bad;
  END IF;
END $$;
