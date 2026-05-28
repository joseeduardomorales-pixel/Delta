-- ============================================================================
-- Delta — Human-readable numbering (Phase 7)
-- ----------------------------------------------------------------------------
-- Replaces hex UUID short-ids with per-user sequenced numbers:
--
--   Each user gets a 4-digit handle starting at 1000 (Eduardo=1000,
--   Ivan=1001, ...). The handle is stored on public.users.handle.
--
--   work_orders, issues, work_order_inspections each get a display_seq
--   column. display_seq counts the user's own rows within that table.
--   Auto-assigned on INSERT via a BEFORE trigger.
--
--   Render format (UI / chat / etc.):
--       WO-1001-0042   = user 1001's 42nd work order
--       ISS-1001-0007  = user 1001's 7th issue
--       INS-1001-0003  = user 1001's 3rd inspection
--
-- UUIDs remain the primary keys — display_seq is just a label.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. USER HANDLE
-- ---------------------------------------------------------------------------
-- Sequence starting at 1000, used for both backfill and new inserts.
CREATE SEQUENCE IF NOT EXISTS public.user_handle_seq START WITH 1000;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS handle int UNIQUE;

-- Backfill: assign handles to existing users in created_at order.
DO $$
DECLARE
  u_id uuid;
  next_handle int;
BEGIN
  FOR u_id IN SELECT id FROM public.users WHERE handle IS NULL ORDER BY created_at LOOP
    next_handle := nextval('public.user_handle_seq');
    UPDATE public.users SET handle = next_handle WHERE id = u_id;
  END LOOP;
END $$;

-- Now lock it down. NOT NULL, and a trigger fills in new rows.
ALTER TABLE public.users
  ALTER COLUMN handle SET NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_user_handle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handle IS NULL THEN
    NEW.handle := nextval('public.user_handle_seq');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_users_assign_handle ON public.users;
CREATE TRIGGER trg_users_assign_handle
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.assign_user_handle();

-- ---------------------------------------------------------------------------
-- 2. WORK_ORDERS.display_seq (per-user-1-up)
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS display_seq int;

-- Backfill: number existing rows per user in started_at order.
WITH numbered AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY started_at, id) AS rn
    FROM public.work_orders
   WHERE display_seq IS NULL
)
UPDATE public.work_orders w
   SET display_seq = n.rn
  FROM numbered n
 WHERE w.id = n.id;

-- Atomic assigner — relies on UNIQUE(user_id, display_seq) for safety
-- against concurrent inserts; the application can retry on conflict.
CREATE OR REPLACE FUNCTION public.assign_work_order_display_seq()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_seq IS NULL THEN
    SELECT COALESCE(MAX(display_seq), 0) + 1 INTO NEW.display_seq
      FROM public.work_orders
     WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_work_orders_display_seq ON public.work_orders;
CREATE TRIGGER trg_work_orders_display_seq
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_work_order_display_seq();

ALTER TABLE public.work_orders
  ALTER COLUMN display_seq SET NOT NULL,
  ADD CONSTRAINT work_orders_user_id_display_seq_key UNIQUE (user_id, display_seq);

CREATE INDEX IF NOT EXISTS idx_work_orders_user_seq
  ON public.work_orders (user_id, display_seq DESC);

-- ---------------------------------------------------------------------------
-- 3. ISSUES.display_seq (per-user-1-up; reported_by is the "user")
-- ---------------------------------------------------------------------------
ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS display_seq int;

WITH numbered AS (
  SELECT id,
         row_number() OVER (PARTITION BY reported_by ORDER BY reported_at, id) AS rn
    FROM public.issues
   WHERE display_seq IS NULL
)
UPDATE public.issues i
   SET display_seq = n.rn
  FROM numbered n
 WHERE i.id = n.id;

CREATE OR REPLACE FUNCTION public.assign_issue_display_seq()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_seq IS NULL THEN
    SELECT COALESCE(MAX(display_seq), 0) + 1 INTO NEW.display_seq
      FROM public.issues
     WHERE reported_by = NEW.reported_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_issues_display_seq ON public.issues;
CREATE TRIGGER trg_issues_display_seq
  BEFORE INSERT ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.assign_issue_display_seq();

ALTER TABLE public.issues
  ALTER COLUMN display_seq SET NOT NULL,
  ADD CONSTRAINT issues_reported_by_display_seq_key UNIQUE (reported_by, display_seq);

CREATE INDEX IF NOT EXISTS idx_issues_user_seq
  ON public.issues (reported_by, display_seq DESC);

-- ---------------------------------------------------------------------------
-- 4. WORK_ORDER_INSPECTIONS.display_seq (per-user-1-up; started_by)
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_order_inspections
  ADD COLUMN IF NOT EXISTS display_seq int;

-- started_by can be NULL in theory (set to NULL on user delete). Only
-- backfill + enforce NOT NULL for rows that have a user — leave NULL
-- where started_by is NULL.
WITH numbered AS (
  SELECT id,
         row_number() OVER (PARTITION BY started_by ORDER BY started_at, id) AS rn
    FROM public.work_order_inspections
   WHERE display_seq IS NULL AND started_by IS NOT NULL
)
UPDATE public.work_order_inspections w
   SET display_seq = n.rn
  FROM numbered n
 WHERE w.id = n.id;

CREATE OR REPLACE FUNCTION public.assign_inspection_display_seq()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_seq IS NULL AND NEW.started_by IS NOT NULL THEN
    SELECT COALESCE(MAX(display_seq), 0) + 1 INTO NEW.display_seq
      FROM public.work_order_inspections
     WHERE started_by = NEW.started_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inspections_display_seq ON public.work_order_inspections;
CREATE TRIGGER trg_inspections_display_seq
  BEFORE INSERT ON public.work_order_inspections
  FOR EACH ROW EXECUTE FUNCTION public.assign_inspection_display_seq();

-- Partial unique index — allows NULL display_seq for inspections whose
-- started_by was deleted (rare). Active inspections always have one.
CREATE UNIQUE INDEX IF NOT EXISTS work_order_inspections_user_seq_key
  ON public.work_order_inspections (started_by, display_seq)
  WHERE started_by IS NOT NULL AND display_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inspections_user_seq
  ON public.work_order_inspections (started_by, display_seq DESC);

-- ---------------------------------------------------------------------------
-- 5. Sanity check — every public table still has RLS
-- ---------------------------------------------------------------------------
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
