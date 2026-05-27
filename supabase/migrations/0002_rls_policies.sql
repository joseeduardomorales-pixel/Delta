-- ============================================================================
-- Delta — Row-Level Security policies (Phase 2, v4 plan)
-- ----------------------------------------------------------------------------
-- Enforces the v4 permission matrix:
--   Admin       — full read/write everywhere
--   Dispatcher  — read everything; write only work_orders.type='issue'
--   Tech        — read everything; write own work_orders (any type)
--   Driver      — enum exists, no policies until needed
--
-- All policies default-deny outside these explicit grants. Service-role
-- bypasses RLS (used by the backend for telematics sync, admin tooling,
-- audit_log writes).
-- ============================================================================

-- ---------- helper: current user's role ------------------------------------
-- SECURITY DEFINER so the function can read public.users even when the
-- caller's RLS would otherwise block. Function body is intentionally
-- minimal — no joins, no parameters — to keep the attack surface tiny.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_dispatcher()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'dispatcher');
$$;

CREATE OR REPLACE FUNCTION public.is_tech()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'tech');
$$;

-- Grace window for self-edits on work_orders. Hardcoded here for foundation;
-- can be moved to a settings table later if the value needs to drift per env.
CREATE OR REPLACE FUNCTION public.wo_grace_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '5 minutes' $$;

-- =============================================================================
-- users
-- =============================================================================
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  -- Don't let users elevate their own role. Admin can update anyone via the
  -- admin policy below.
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS users_admin_all ON public.users;
CREATE POLICY users_admin_all ON public.users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- assets — read-only mirror; only service role writes
-- =============================================================================
DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets
  FOR SELECT TO authenticated
  USING (true);

-- (No INSERT/UPDATE/DELETE policies — only service_role can write, and
-- service_role bypasses RLS.)

-- =============================================================================
-- drivers — same shape as assets
-- =============================================================================
DROP POLICY IF EXISTS drivers_select ON public.drivers;
CREATE POLICY drivers_select ON public.drivers
  FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- meter_readings
--   SELECT: any authenticated
--   INSERT: own row with source='manual'  OR  service_role (sync)
-- =============================================================================
DROP POLICY IF EXISTS meter_readings_select ON public.meter_readings;
CREATE POLICY meter_readings_select ON public.meter_readings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS meter_readings_insert_manual ON public.meter_readings;
CREATE POLICY meter_readings_insert_manual ON public.meter_readings
  FOR INSERT TO authenticated
  WITH CHECK (source = 'manual' AND recorded_by = auth.uid());

DROP POLICY IF EXISTS meter_readings_admin_all ON public.meter_readings;
CREATE POLICY meter_readings_admin_all ON public.meter_readings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- pm_schedules
--   SELECT: any authenticated
--   INSERT/UPDATE/DELETE: admin only
-- =============================================================================
DROP POLICY IF EXISTS pm_schedules_select ON public.pm_schedules;
CREATE POLICY pm_schedules_select ON public.pm_schedules
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS pm_schedules_admin_all ON public.pm_schedules;
CREATE POLICY pm_schedules_admin_all ON public.pm_schedules
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- work_orders
--   SELECT: any authenticated
--   INSERT:
--     - Dispatcher: only type='issue', and user_id = auth.uid()
--     - Tech:       any type, user_id = auth.uid()
--     - Admin:      anything
--   UPDATE:
--     - Owner within grace window (now() - started_at < 5 min)
--     - Admin anytime
--   DELETE: never (use status='voided' instead)
-- =============================================================================
DROP POLICY IF EXISTS work_orders_select ON public.work_orders;
CREATE POLICY work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS work_orders_insert_tech ON public.work_orders;
CREATE POLICY work_orders_insert_tech ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_tech()
    AND type IN ('issue','repair','pm','inspection','other')
  );

DROP POLICY IF EXISTS work_orders_insert_dispatcher ON public.work_orders;
CREATE POLICY work_orders_insert_dispatcher ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_dispatcher()
    AND type = 'issue'
  );

DROP POLICY IF EXISTS work_orders_admin_all ON public.work_orders;
CREATE POLICY work_orders_admin_all ON public.work_orders
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS work_orders_update_own_grace ON public.work_orders;
CREATE POLICY work_orders_update_own_grace ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND started_at > now() - public.wo_grace_window()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND started_at > now() - public.wo_grace_window()
  );

-- =============================================================================
-- action_photos
--   SELECT: any authenticated
--   INSERT: uploader is self, attached to a work_order owned by self
--           (or admin via the all-policy)
-- =============================================================================
DROP POLICY IF EXISTS action_photos_select ON public.action_photos;
CREATE POLICY action_photos_select ON public.action_photos
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS action_photos_insert_own ON public.action_photos;
CREATE POLICY action_photos_insert_own ON public.action_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id AND wo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS action_photos_admin_all ON public.action_photos;
CREATE POLICY action_photos_admin_all ON public.action_photos
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- conversations + messages — owner-scoped
-- =============================================================================
DROP POLICY IF EXISTS conversations_select_own ON public.conversations;
CREATE POLICY conversations_select_own ON public.conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS conversations_insert_own ON public.conversations;
CREATE POLICY conversations_insert_own ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_update_own ON public.conversations;
CREATE POLICY conversations_update_own ON public.conversations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS messages_select_own ON public.messages;
CREATE POLICY messages_select_own ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    role = 'user'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- =============================================================================
-- audit_log — service role only. No policies. Default deny.
-- =============================================================================
-- (intentionally empty)
