-- ============================================================================
-- Delta — Work Order redesign (Phase 5)
-- ----------------------------------------------------------------------------
-- Splits the previously monolithic work_orders table into 5 entities that
-- match how a real shop thinks:
--
--   issues                  reported problems (upstream of work)
--   work_orders             a session of work on an asset (container)
--   work_order_items        line items inside a WO (the actual work units)
--   campaigns               fleet-wide programs (recalls, scheduled blitzes)
--   campaign_assignments    one row per (campaign × applicable asset)
--
-- Every work_order_item links UPSTREAM to its origin:
--   source='issue'                → source_issue_id
--   source='pm_schedule'          → source_pm_schedule_id
--   source='campaign_assignment'  → source_campaign_assignment_id
--   source='ad_hoc'               → none (free-form work)
--
-- And UPSTREAM rows learn about completion via the back-pointers we set
-- when an item is marked done.
--
-- Pre-migration cleanup: all existing work_orders rows are smoke-test
-- artifacts (no real customer data yet). We delete them up front so the
-- schema reshape doesn't have to migrate legacy `type` values.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Cleanup of test data so DROP COLUMN runs without contortions
-- ---------------------------------------------------------------------------
-- All current work_orders are admin smoke tests from foundation development.
-- The cascade chain handles action_photos automatically; pm_schedules and
-- messages back-references are set to NULL via existing ON DELETE rules.
DELETE FROM public.work_orders;

-- ---------------------------------------------------------------------------
-- 1. ISSUES — reported problems (upstream of work)
-- ---------------------------------------------------------------------------
CREATE TABLE public.issues (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                        uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_unit_number               citext NOT NULL,
  reported_by                     uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title                           text NOT NULL,
  description                     text,
  raw_input                       text,
  parsed_data                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                          text NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open','acknowledged','in_progress','resolved','dismissed')),
  resolved_by_work_order_item_id  uuid, -- FK added after work_order_items exists
  dismissed_by                    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  dismissed_at                    timestamptz,
  dismiss_reason                  text,
  reported_at                     timestamptz NOT NULL DEFAULT now(),
  resolved_at                     timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_issues_asset_time      ON public.issues (asset_id, reported_at DESC);
CREATE INDEX idx_issues_unit_time       ON public.issues (asset_unit_number, reported_at DESC);
CREATE INDEX idx_issues_open            ON public.issues (asset_id, reported_at DESC)
                                          WHERE status IN ('open','acknowledged','in_progress');
CREATE INDEX idx_issues_reporter_time   ON public.issues (reported_by, reported_at DESC);

CREATE TRIGGER trg_issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. CAMPAIGNS — fleet-wide programs
-- ---------------------------------------------------------------------------
CREATE TABLE public.campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','closed')),
  -- {"all":true} | {"type":"truck"} | {"type":"trailer"} | {"type":"reefer"}
  --   | {"unit_numbers":["CC01","CC02"]}
  asset_filter    jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status_time ON public.campaigns (status, starts_at DESC);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. CAMPAIGN_ASSIGNMENTS — 1 row per (campaign × applicable asset)
-- ---------------------------------------------------------------------------
CREATE TABLE public.campaign_assignments (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                       uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  asset_id                          uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status                            text NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open','completed','skipped')),
  completed_by_work_order_item_id   uuid, -- FK added after work_order_items
  completed_at                      timestamptz,
  skipped_reason                    text,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, asset_id)
);

CREATE INDEX idx_campaign_assignments_open
  ON public.campaign_assignments (asset_id)
  WHERE status = 'open';

CREATE TRIGGER trg_campaign_assignments_updated_at
  BEFORE UPDATE ON public.campaign_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaign_assignments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. WORK_ORDERS reshape — drop per-job columns, add session-level columns
-- ---------------------------------------------------------------------------
-- Drop policies that reference type/columns we're about to drop.
DROP POLICY IF EXISTS work_orders_insert_tech ON public.work_orders;
DROP POLICY IF EXISTS work_orders_insert_dispatcher ON public.work_orders;

-- Drop columns that move to work_order_items (or are obviated).
ALTER TABLE public.work_orders
  DROP COLUMN IF EXISTS type,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS raw_input,
  DROP COLUMN IF EXISTS parsed_data,
  DROP COLUMN IF EXISTS resolves_work_order_id,
  DROP COLUMN IF EXISTS meter_reading_id,
  DROP COLUMN IF EXISTS pm_schedule_id;

-- Drop the index that referenced the dropped type column.
DROP INDEX IF EXISTS idx_work_orders_type_status;

-- Add session-level columns.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS opening_meter_reading_id uuid
    REFERENCES public.meter_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS summary text;

CREATE INDEX IF NOT EXISTS idx_work_orders_open_status
  ON public.work_orders (asset_id, status)
  WHERE status IN ('open','in_progress');

-- Reinstate the insert policies in the new shape:
-- Tech can insert a WO (no type to gate on). Dispatcher cannot — they
-- file issues instead, via the issues table.
DROP POLICY IF EXISTS work_orders_insert ON public.work_orders;
CREATE POLICY work_orders_insert ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_tech()
  );

-- ---------------------------------------------------------------------------
-- 5. WORK_ORDER_ITEMS — the actual unit-of-work table
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_items (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id                     uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  sequence                          int NOT NULL DEFAULT 0,
  source                            text NOT NULL
                                      CHECK (source IN ('issue','pm_schedule','campaign_assignment','ad_hoc')),
  source_issue_id                   uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  source_pm_schedule_id             uuid REFERENCES public.pm_schedules(id) ON DELETE SET NULL,
  source_campaign_assignment_id     uuid REFERENCES public.campaign_assignments(id) ON DELETE SET NULL,
  type                              text NOT NULL DEFAULT 'other'
                                      CHECK (type IN ('pm','repair','inspection','other')),
  title                             text NOT NULL,
  description                       text,
  raw_input                         text,
  parsed_data                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                            text NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending','done','skipped')),
  skipped_reason                    text,
  notes                             text,
  meter_reading_id                  uuid REFERENCES public.meter_readings(id) ON DELETE SET NULL,
  completed_at                      timestamptz,
  completed_by_user_id              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  -- Exactly one source FK matches the `source` discriminator (except ad_hoc → none).
  CONSTRAINT work_order_items_source_consistency CHECK (
    (source = 'issue'
        AND source_issue_id IS NOT NULL
        AND source_pm_schedule_id IS NULL
        AND source_campaign_assignment_id IS NULL)
    OR (source = 'pm_schedule'
        AND source_pm_schedule_id IS NOT NULL
        AND source_issue_id IS NULL
        AND source_campaign_assignment_id IS NULL)
    OR (source = 'campaign_assignment'
        AND source_campaign_assignment_id IS NOT NULL
        AND source_issue_id IS NULL
        AND source_pm_schedule_id IS NULL)
    OR (source = 'ad_hoc'
        AND source_issue_id IS NULL
        AND source_pm_schedule_id IS NULL
        AND source_campaign_assignment_id IS NULL)
  )
);

CREATE INDEX idx_wo_items_wo_seq        ON public.work_order_items (work_order_id, sequence);
CREATE INDEX idx_wo_items_pending       ON public.work_order_items (work_order_id) WHERE status = 'pending';
CREATE INDEX idx_wo_items_pm_schedule   ON public.work_order_items (source_pm_schedule_id);
CREATE INDEX idx_wo_items_issue         ON public.work_order_items (source_issue_id);
CREATE INDEX idx_wo_items_campaign      ON public.work_order_items (source_campaign_assignment_id);
CREATE INDEX idx_wo_items_completed     ON public.work_order_items (completed_by_user_id, completed_at DESC)
                                          WHERE status = 'done';

CREATE TRIGGER trg_wo_items_updated_at
  BEFORE UPDATE ON public.work_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Cross-references — now that all tables exist, add the FKs we deferred
-- ---------------------------------------------------------------------------
ALTER TABLE public.issues
  ADD CONSTRAINT issues_resolved_by_wo_item_fkey
  FOREIGN KEY (resolved_by_work_order_item_id)
  REFERENCES public.work_order_items(id) ON DELETE SET NULL;

ALTER TABLE public.campaign_assignments
  ADD CONSTRAINT campaign_assignments_completed_by_wo_item_fkey
  FOREIGN KEY (completed_by_work_order_item_id)
  REFERENCES public.work_order_items(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 7. pm_schedules: rename last_completed_work_order_id → _item_id
-- ---------------------------------------------------------------------------
-- Drop the old FK (to work_orders) and column, add the new column with a
-- FK to work_order_items. Existing values are NULL after the cleanup
-- in step 0 (when the parent WOs were deleted, this column was set NULL
-- per the original ON DELETE rule).
ALTER TABLE public.pm_schedules
  DROP CONSTRAINT IF EXISTS pm_schedules_last_completed_wo_fkey,
  DROP COLUMN IF EXISTS last_completed_work_order_id,
  ADD COLUMN IF NOT EXISTS last_completed_work_order_item_id uuid
    REFERENCES public.work_order_items(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 8. RLS POLICIES for the new tables
-- ---------------------------------------------------------------------------

-- ISSUES ---------------------------------------------------------------------
DROP POLICY IF EXISTS issues_select ON public.issues;
CREATE POLICY issues_select ON public.issues
  FOR SELECT TO authenticated
  USING (true);

-- Anyone authenticated can report an issue (tech, dispatcher, admin).
DROP POLICY IF EXISTS issues_insert ON public.issues;
CREATE POLICY issues_insert ON public.issues
  FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid());

-- Own update within 5-min grace, or admin anytime.
DROP POLICY IF EXISTS issues_update_own_grace ON public.issues;
CREATE POLICY issues_update_own_grace ON public.issues
  FOR UPDATE TO authenticated
  USING (reported_by = auth.uid()
         AND reported_at > now() - public.wo_grace_window())
  WITH CHECK (reported_by = auth.uid()
              AND reported_at > now() - public.wo_grace_window());

DROP POLICY IF EXISTS issues_admin_all ON public.issues;
CREATE POLICY issues_admin_all ON public.issues
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- WORK_ORDER_ITEMS -----------------------------------------------------------
DROP POLICY IF EXISTS wo_items_select ON public.work_order_items;
CREATE POLICY wo_items_select ON public.work_order_items
  FOR SELECT TO authenticated
  USING (true);

-- Insert/update gated by ownership of the parent WO (or admin).
DROP POLICY IF EXISTS wo_items_insert_own_wo ON public.work_order_items;
CREATE POLICY wo_items_insert_own_wo ON public.work_order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id AND wo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wo_items_update_own ON public.work_order_items;
CREATE POLICY wo_items_update_own ON public.work_order_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.user_id = auth.uid()
        AND wo.started_at > now() - public.wo_grace_window()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.user_id = auth.uid()
        AND wo.started_at > now() - public.wo_grace_window()
    )
  );

DROP POLICY IF EXISTS wo_items_admin_all ON public.work_order_items;
CREATE POLICY wo_items_admin_all ON public.work_order_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- CAMPAIGNS ------------------------------------------------------------------
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS campaigns_admin_all ON public.campaigns;
CREATE POLICY campaigns_admin_all ON public.campaigns
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- CAMPAIGN_ASSIGNMENTS -------------------------------------------------------
DROP POLICY IF EXISTS campaign_assignments_select ON public.campaign_assignments;
CREATE POLICY campaign_assignments_select ON public.campaign_assignments
  FOR SELECT TO authenticated
  USING (true);

-- Admin writes outright; service-role writes when completing via WO item.
DROP POLICY IF EXISTS campaign_assignments_admin_all ON public.campaign_assignments;
CREATE POLICY campaign_assignments_admin_all ON public.campaign_assignments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. Sanity check — every public table still has RLS enabled.
-- ---------------------------------------------------------------------------
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ')
  INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables without RLS enabled after 0005: %', missing;
  END IF;
END $$;
