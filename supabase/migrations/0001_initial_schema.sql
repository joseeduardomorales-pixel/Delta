-- ============================================================================
-- Delta — initial schema (Phase 2, v4 plan)
-- ----------------------------------------------------------------------------
-- The kardex spine is `work_orders`. Every action a tech narrates in chat
-- becomes a row here. Asset catalog (assets, drivers) is a read-only mirror
-- of Alvys. meter_readings unifies miles (trucks) and hours (reefers).
--
-- All FKs declare on-delete behavior explicitly. RLS is enabled here but
-- policies land in 0002_rls_policies.sql.
-- ============================================================================

-- ---------- extensions -------------------------------------------------------
-- pgcrypto for gen_random_uuid(); citext for case-insensitive text where it
-- helps (unit_number lookups).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- utility: updated_at trigger -------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- users — profile row mirrored from auth.users
-- ============================================================================
CREATE TABLE public.users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  role        text NOT NULL DEFAULT 'tech'
                CHECK (role IN ('admin','dispatcher','tech','driver')),
  phone       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- assets — read-only mirror of Alvys fleet
-- ============================================================================
CREATE TABLE public.assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number           citext UNIQUE NOT NULL,
  type                  text NOT NULL
                          CHECK (type IN ('truck','trailer','reefer')),
  vin                   text,
  make                  text,
  model                 text,
  year                  int CHECK (year IS NULL OR (year BETWEEN 1980 AND 2100)),
  intangles_device_id   text,
  monarch_device_id     text,
  trackfleet_device_id  text,
  alvys_id              text UNIQUE,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_type_active ON public.assets (type, active);
CREATE INDEX idx_assets_unit_number ON public.assets (unit_number);

CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- drivers — read-only mirror of Alvys drivers
-- ============================================================================
CREATE TABLE public.drivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  alvys_id    text UNIQUE,
  phone       text,
  email       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drivers_active ON public.drivers (active);

CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- meter_readings — unified miles + hours, multi-source
-- ============================================================================
CREATE TABLE public.meter_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  unit          text NOT NULL CHECK (unit IN ('miles','hours')),
  value         int  NOT NULL CHECK (value >= 0),
  source        text NOT NULL
                  CHECK (source IN ('intangles','monarch','trackfleet','manual')),
  recorded_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  raw_payload   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meter_readings_asset_time     ON public.meter_readings (asset_id, recorded_at DESC);
CREATE INDEX idx_meter_readings_asset_unit_time ON public.meter_readings (asset_id, unit, recorded_at DESC);

ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- pm_schedules — one row per (asset, scope, name). Cross-FK to work_orders
-- added at the end of this migration to break the circular dependency.
-- ============================================================================
CREATE TABLE public.pm_schedules (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                      uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  scope                         text NOT NULL
                                  CHECK (scope IN ('truck','trailer_body','reefer_unit','other')),
  name                          text NOT NULL,
  cadence_type                  text NOT NULL
                                  CHECK (cadence_type IN ('miles','hours','months')),
  interval_miles                int CHECK (interval_miles  > 0),
  interval_hours                int CHECK (interval_hours  > 0),
  interval_months               int CHECK (interval_months > 0),
  last_completed_at             timestamptz,
  last_completed_miles          int,
  last_completed_hours          int,
  last_completed_work_order_id  uuid, -- FK added below (avoid circular)
  anchor_mode                   text NOT NULL DEFAULT 'anchored'
                                  CHECK (anchor_mode IN ('anchored','from_last_completion')),
  active                        boolean NOT NULL DEFAULT true,
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  -- Exactly one interval column matches cadence_type.
  CONSTRAINT pm_cadence_interval_consistency CHECK (
    (cadence_type = 'miles'  AND interval_miles  IS NOT NULL
                              AND interval_hours IS NULL
                              AND interval_months IS NULL) OR
    (cadence_type = 'hours'  AND interval_hours  IS NOT NULL
                              AND interval_miles IS NULL
                              AND interval_months IS NULL) OR
    (cadence_type = 'months' AND interval_months IS NOT NULL
                              AND interval_miles IS NULL
                              AND interval_hours IS NULL)
  )
);

CREATE INDEX idx_pm_schedules_asset_active ON public.pm_schedules (asset_id, active);

CREATE TRIGGER trg_pm_schedules_updated_at
  BEFORE UPDATE ON public.pm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pm_schedules ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- work_orders — THE KARDEX SPINE
-- ============================================================================
CREATE TABLE public.work_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_unit_number       citext, -- denormalized; survives asset delete
  user_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  type                    text NOT NULL
                            CHECK (type IN ('pm','repair','issue','inspection','other')),
  status                  text NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','completed','voided')),
  title                   text,
  description             text,
  raw_input               text, -- original chat message, never edited
  parsed_data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolves_work_order_id  uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  meter_reading_id        uuid REFERENCES public.meter_readings(id) ON DELETE SET NULL,
  pm_schedule_id          uuid, -- FK added below (avoid circular)
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  voided_at               timestamptz,
  voided_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  void_reason             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_orders_asset_time   ON public.work_orders (asset_id, started_at DESC);
CREATE INDEX idx_work_orders_unit_time    ON public.work_orders (asset_unit_number, started_at DESC);
CREATE INDEX idx_work_orders_user_time    ON public.work_orders (user_id, started_at DESC);
CREATE INDEX idx_work_orders_type_status  ON public.work_orders (type, status);
CREATE INDEX idx_work_orders_open_by_asset ON public.work_orders (asset_id) WHERE status IN ('open','in_progress');

CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Now add the cross-FKs that had to wait for both tables to exist.
ALTER TABLE public.pm_schedules
  ADD CONSTRAINT pm_schedules_last_completed_wo_fkey
  FOREIGN KEY (last_completed_work_order_id)
  REFERENCES public.work_orders(id) ON DELETE SET NULL;

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_pm_schedule_fkey
  FOREIGN KEY (pm_schedule_id)
  REFERENCES public.pm_schedules(id) ON DELETE SET NULL;

-- ============================================================================
-- action_photos — uploaded photos attached to a work_order
-- ============================================================================
CREATE TABLE public.action_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  storage_path    text NOT NULL, -- key inside the action-photos bucket
  caption         text,
  ai_analysis     jsonb,
  uploaded_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_photos_wo ON public.action_photos (work_order_id);

ALTER TABLE public.action_photos ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- conversations — chat sessions per user
-- ============================================================================
CREATE TABLE public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_user_recent ON public.conversations (user_id, last_message_at DESC);

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- messages — individual turns inside a conversation
-- ============================================================================
CREATE TABLE public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role                  text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content               jsonb NOT NULL, -- full Anthropic content block(s)
  tool_calls            jsonb,
  related_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_time ON public.messages (conversation_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- audit_log — immutable change history. Service-role only.
-- ============================================================================
CREATE TABLE public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_table    text NOT NULL,
  target_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_target ON public.audit_log (target_table, target_id);
CREATE INDEX idx_audit_actor_time ON public.audit_log (actor_user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Sanity check — surface non-RLS tables. Should report zero rows.
-- ============================================================================
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
    RAISE EXCEPTION 'Tables without RLS enabled: %', missing;
  END IF;
END $$;
