-- ============================================================================
-- Delta — Inspection PM info fields (Phase 9)
-- ----------------------------------------------------------------------------
-- The reefer trailer inspection paper form has a "PM INFORMATION" block at
-- the top of section 3 (PM Information & Operational Test). The tech enters
-- the unit's last PM date and last PM hours so admins reviewing the kardex
-- know when the asset was last serviced. Lalo asked only for "Last" — Next
-- PM scheduling is a separate concern handled by pm_schedules.
--
-- Both fields are nullable so the tech can fill them in any order and
-- the form can save partial state to IndexedDB without server-side errors.
-- ============================================================================

ALTER TABLE public.work_order_inspections
  ADD COLUMN IF NOT EXISTS last_pm_date date,
  ADD COLUMN IF NOT EXISTS last_pm_hours int;

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
