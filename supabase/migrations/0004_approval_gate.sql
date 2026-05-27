-- ============================================================================
-- Delta — approval gate on work_orders (Phase 3a, v4)
-- ----------------------------------------------------------------------------
-- Separates "did the work happen" (work_orders.status) from "do we trust
-- the record" (approval_status). Every Claude-driven WO insert defaults to
-- approval_status='pending_review'. Only admin can change it after that.
--
-- The DB-level trigger is the floor: it stops a tech from elevating their
-- own WO inside the 5-min grace window, which the existing RLS policy
-- otherwise allows (the grace policy permits UPDATE of any column).
-- ============================================================================

-- --- columns ----------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending_review'
    CHECK (approval_status IN ('pending_review','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at   timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_notes text;

CREATE INDEX IF NOT EXISTS idx_work_orders_approval_status
  ON public.work_orders (approval_status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_orders_pending_review
  ON public.work_orders (started_at DESC)
  WHERE approval_status = 'pending_review';

-- --- DB-level enforcement ---------------------------------------------------
-- The trigger fires on every INSERT and UPDATE. Service-role connections
-- have auth.uid() = NULL and are exempted (sync jobs, admin tooling).
-- Authenticated callers can only change approval_status if they are admin.
-- This is defense-in-depth — RLS policies should already gate this for
-- techs and dispatchers, but the trigger backstops the grace-window policy
-- which currently allows full-row UPDATE within 5 min.
CREATE OR REPLACE FUNCTION public.enforce_approval_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role / system contexts: no auth.uid(), no enforcement needed.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Only admin can insert a WO that's already approved or rejected.
    IF NEW.approval_status IS DISTINCT FROM 'pending_review'
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION
        'work_orders.approval_status: only admin can set non-default value on insert (got %)',
        NEW.approval_status;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only admin can change approval_status, approved_at, approved_by,
    -- or approval_notes. (Techs editing within grace can touch every
    -- other field.)
    IF (NEW.approval_status IS DISTINCT FROM OLD.approval_status
        OR NEW.approved_at   IS DISTINCT FROM OLD.approved_at
        OR NEW.approved_by   IS DISTINCT FROM OLD.approved_by
        OR NEW.approval_notes IS DISTINCT FROM OLD.approval_notes)
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION
        'work_orders approval columns are admin-only';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_approval_gate ON public.work_orders;
CREATE TRIGGER trg_work_orders_approval_gate
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_gate();
