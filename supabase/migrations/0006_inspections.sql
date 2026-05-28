-- ============================================================================
-- Delta — Inspections (Phase 6, tech-side)
-- ----------------------------------------------------------------------------
-- Adds reusable inspection templates and the linkage between a template and
-- the work_order_items it materializes.
--
-- Shape:
--   inspection_templates                a named, scoped checklist
--   inspection_template_items           the checklist's line items, grouped
--                                       by section, ordered within section
--   work_order_inspections              binds a template to a specific WO
--                                       (started/completed timestamps, sigs)
--   work_order_items                    extended with:
--                                         - 'inspection_template' as a source
--                                         - inspection_template_item_id FK
--                                         - inspection_result (pass|fail|na|yes|no)
--                                         - measurement_value / measurement_text
--
-- Workflow:
--   1. Tech opens a WO on an asset (existing /api/work-orders flow).
--   2. POST /api/work-orders/:id/inspections {template_id}
--        → server materializes one work_order_item per template line item.
--   3. Tech walks the asset and PATCHes each item with inspection_result.
--   4. On submit, items with result='fail' auto-create an issue on the asset
--      (so future WOs see them in the pending picker).
--   5. The work_order_inspections row gets completed_at + signature.
--
-- Driver pre-trip/post-trip walkaround is a SEPARATE future project — it
-- needs driver accounts, Alvys driver sync, and a mobile-first UI. Not here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. INSPECTION_TEMPLATES — reusable checklist definitions
-- ---------------------------------------------------------------------------
CREATE TABLE public.inspection_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  -- Which asset types this template applies to. 'any' = no constraint.
  scope           text NOT NULL DEFAULT 'any'
                    CHECK (scope IN ('truck','trailer','reefer','reefer_trailer','any')),
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_templates_active_scope
  ON public.inspection_templates (scope) WHERE active = true;

CREATE TRIGGER trg_inspection_templates_updated_at
  BEFORE UPDATE ON public.inspection_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.inspection_templates ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. INSPECTION_TEMPLATE_ITEMS — the actual checklist lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.inspection_template_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid NOT NULL REFERENCES public.inspection_templates(id) ON DELETE CASCADE,
  section             text NOT NULL,           -- e.g. "AIR, BRAKES & SUSPENSION"
  section_sequence    int NOT NULL,
  item_sequence       int NOT NULL,            -- order within the section
  text                text NOT NULL,
  -- Answer model:
  --   pass_fail   — standard inspection check (default)
  --   yes_no      — for the final assessment ("Safe to road?")
  --   measurement — numeric reading (PSI, °F, tread depth, hours)
  kind                text NOT NULL DEFAULT 'pass_fail'
                        CHECK (kind IN ('pass_fail','yes_no','measurement')),
  -- For yes_no items: which answer means "this is OK" (the good answer).
  good_answer         text CHECK (good_answer IN ('yes','no')),
  -- For measurement items.
  measurement_unit    text,
  measurement_min     numeric,
  measurement_max     numeric,
  required            boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_items_template
  ON public.inspection_template_items (template_id, section_sequence, item_sequence);

ALTER TABLE public.inspection_template_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. EXTEND work_order_items for inspections
-- ---------------------------------------------------------------------------
-- Drop the old source check + consistency check so we can add the new source.
ALTER TABLE public.work_order_items
  DROP CONSTRAINT IF EXISTS work_order_items_source_check;
ALTER TABLE public.work_order_items
  DROP CONSTRAINT IF EXISTS work_order_items_source_consistency;

-- Add the new columns.
ALTER TABLE public.work_order_items
  ADD COLUMN IF NOT EXISTS source_inspection_template_item_id uuid
    REFERENCES public.inspection_template_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_template_id uuid
    REFERENCES public.inspection_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_result text
    CHECK (inspection_result IN ('pass','fail','na','yes','no')),
  ADD COLUMN IF NOT EXISTS measurement_value numeric,
  ADD COLUMN IF NOT EXISTS measurement_text text;

-- Re-add the source check WITH 'inspection_template' as a valid value.
ALTER TABLE public.work_order_items
  ADD CONSTRAINT work_order_items_source_check
  CHECK (source IN ('issue','pm_schedule','campaign_assignment','ad_hoc','inspection_template'));

-- Re-add consistency: exactly one source_*_id matches the discriminator.
ALTER TABLE public.work_order_items
  ADD CONSTRAINT work_order_items_source_consistency CHECK (
    (source = 'issue'
        AND source_issue_id IS NOT NULL
        AND source_pm_schedule_id IS NULL
        AND source_campaign_assignment_id IS NULL
        AND source_inspection_template_item_id IS NULL)
    OR (source = 'pm_schedule'
        AND source_pm_schedule_id IS NOT NULL
        AND source_issue_id IS NULL
        AND source_campaign_assignment_id IS NULL
        AND source_inspection_template_item_id IS NULL)
    OR (source = 'campaign_assignment'
        AND source_campaign_assignment_id IS NOT NULL
        AND source_issue_id IS NULL
        AND source_pm_schedule_id IS NULL
        AND source_inspection_template_item_id IS NULL)
    OR (source = 'inspection_template'
        AND source_inspection_template_item_id IS NOT NULL
        AND inspection_template_id IS NOT NULL
        AND source_issue_id IS NULL
        AND source_pm_schedule_id IS NULL
        AND source_campaign_assignment_id IS NULL)
    OR (source = 'ad_hoc'
        AND source_issue_id IS NULL
        AND source_pm_schedule_id IS NULL
        AND source_campaign_assignment_id IS NULL
        AND source_inspection_template_item_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_wo_items_inspection
  ON public.work_order_items (inspection_template_id, work_order_id);

-- ---------------------------------------------------------------------------
-- 4. WORK_ORDER_INSPECTIONS — bind a template instance to a specific WO
-- ---------------------------------------------------------------------------
-- One row per (WO × template) — represents "this WO contains an instance of
-- this inspection". Holds the lifecycle / signature info that doesn't fit
-- on individual items.
CREATE TABLE public.work_order_inspections (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id               uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  template_id                 uuid NOT NULL REFERENCES public.inspection_templates(id) ON DELETE RESTRICT,
  started_by                  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  technician_signed_at        timestamptz,
  supervisor_signed_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  supervisor_signed_at        timestamptz,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, template_id)
);

CREATE INDEX idx_wo_inspections_wo ON public.work_order_inspections (work_order_id);
CREATE INDEX idx_wo_inspections_template_time
  ON public.work_order_inspections (template_id, completed_at DESC);

CREATE TRIGGER trg_wo_inspections_updated_at
  BEFORE UPDATE ON public.work_order_inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_order_inspections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES
-- ---------------------------------------------------------------------------

-- inspection_templates — everyone reads, only admin writes.
CREATE POLICY inspection_templates_select ON public.inspection_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY inspection_templates_admin_all ON public.inspection_templates
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- inspection_template_items — same.
CREATE POLICY inspection_template_items_select ON public.inspection_template_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY inspection_template_items_admin_all ON public.inspection_template_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- work_order_inspections — anyone authed can read; insert/update gated by
-- ownership of the parent WO (or admin).
CREATE POLICY wo_inspections_select ON public.work_order_inspections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY wo_inspections_insert_own_wo ON public.work_order_inspections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id AND wo.user_id = auth.uid()
    )
  );

CREATE POLICY wo_inspections_update_own_wo ON public.work_order_inspections
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id AND wo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = work_order_id AND wo.user_id = auth.uid()
    )
  );

CREATE POLICY wo_inspections_admin_all ON public.work_order_inspections
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. SEED — Cold Cargo's reefer trailer inspection template
-- ---------------------------------------------------------------------------
-- Inline insert. Sections + item text come straight from Lalo's Excel file
-- (Reefer_Trailer_Inspection_Report.xlsx). Hand-keyed here for traceability;
-- if Lalo updates the template, we update this seed and the live DB will be
-- migrated via a follow-up migration.
DO $$
DECLARE
  v_template_id uuid;
BEGIN
  INSERT INTO public.inspection_templates (name, description, scope)
  VALUES (
    'Reefer Trailer Inspection',
    'Cold Cargo''s shop-side inspection for reefer trailers. Two-page checklist covering the reefer unit and the trailer itself, plus final safety & DOT assessment.',
    'reefer_trailer'
  )
  RETURNING id INTO v_template_id;

  -- Section 1: OUTSIDE REEFER UNIT
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 1, 'Display screen — readable, no cracks', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 2, 'Control panel / keypad — all buttons functional', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 3, 'Muffler and exhaust system — secure, no damage', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 4, 'Front grille and fan guards — intact, no damage', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 5, 'Side panels & housing — no dents or cracks', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 6, 'External hoses & wiring — secure, undamaged', 'pass_fail'),
    (v_template_id, 'OUTSIDE REEFER UNIT', 1, 7, 'Mounting brackets & bolts — tight, no missing', 'pass_fail');

  -- Section 2: INSIDE REEFER UNIT — VISUAL INSPECTION
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 1, 'No oil, coolant, refrigerant, or fuel leaks/stains', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 2, 'Refrigerant lines — no cracks, chafing, or wear', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 3, 'Compressor — no leaks, secure mounts', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 4, 'Belts — proper tension, no cracks or fraying', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 5, 'Air filters — clean, within service life', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 6, 'Fuel filters — clean, within service life', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 7, 'Batteries — charged, clean terminals, secure', 'pass_fail'),
    (v_template_id, 'INSIDE REEFER UNIT — VISUAL INSPECTION', 2, 8, 'Fuel tank and lines — no leaks, secure', 'pass_fail');

  -- Section 3: PM INFORMATION & OPERATIONAL TEST
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 1, 'Unit starts properly — no abnormal startup', 'pass_fail'),
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 2, 'Reaches and holds setpoint within expected time', 'pass_fail'),
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 3, 'No abnormal noise or vibration during operation', 'pass_fail'),
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 4, 'No active alarms or fault codes', 'pass_fail'),
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 5, 'Defrost cycle functions correctly', 'pass_fail'),
    (v_template_id, 'PM INFORMATION & OPERATIONAL TEST', 3, 6, 'Return air temp reads accurately on display', 'pass_fail');

  -- Section 4: AIR, BRAKES & SUSPENSION
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 1, 'Air lines & glad hands — no leaks, secured', 'pass_fail'),
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 2, 'Air tank — no leaks, drain valves functional', 'pass_fail'),
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 3, 'Brake chambers & slack adjusters — operational', 'pass_fail'),
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 4, 'Brake shoes & drums — wear within spec', 'pass_fail'),
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 5, 'Suspension springs / air bags — no damage or sag', 'pass_fail'),
    (v_template_id, 'AIR, BRAKES & SUSPENSION', 4, 6, 'Shocks, bushings, hangers — secure, no damage', 'pass_fail');

  -- Section 5: ELECTRICAL & LIGHTS
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'ELECTRICAL & LIGHTS', 5, 1, '7-way connector and trailer plug — clean, secure', 'pass_fail'),
    (v_template_id, 'ELECTRICAL & LIGHTS', 5, 2, 'Wiring harness — no damage, no exposed wires', 'pass_fail'),
    (v_template_id, 'ELECTRICAL & LIGHTS', 5, 3, 'ABS warning light & module — no fault codes', 'pass_fail'),
    (v_template_id, 'ELECTRICAL & LIGHTS', 5, 4, 'Junction boxes and connections — sealed, secure', 'pass_fail'),
    (v_template_id, 'ELECTRICAL & LIGHTS', 5, 5, 'All marker, tail, brake, turn lights working', 'pass_fail');

  -- Section 6: BODY & STRUCTURE
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'BODY & STRUCTURE', 6, 1, 'Door seals & gaskets — full hermeticity, no gaps', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 2, 'Door hinges, latches, and locks — operational', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 3, 'Cross bars / load bars — present, no damage', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 4, 'Landing gear — operates smoothly, no damage', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 5, 'Crank handle — present, operational', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 6, 'Kingpin — wear within spec, secure', 'pass_fail'),
    (v_template_id, 'BODY & STRUCTURE', 6, 7, 'Side skirts & rub rails — intact, secure', 'pass_fail');

  -- Section 7: INSIDE QUALITY INSPECTION
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'INSIDE QUALITY INSPECTION', 7, 1, 'Floor — no patches, holes, or damage', 'pass_fail'),
    (v_template_id, 'INSIDE QUALITY INSPECTION', 7, 2, 'Ceiling — no patches, holes, or damage', 'pass_fail'),
    (v_template_id, 'INSIDE QUALITY INSPECTION', 7, 3, 'Side walls — no patches, holes, or damage', 'pass_fail'),
    (v_template_id, 'INSIDE QUALITY INSPECTION', 7, 4, 'Air chute — intact, properly secured', 'pass_fail'),
    (v_template_id, 'INSIDE QUALITY INSPECTION', 7, 5, 'Kickplate / scuff plate — intact, no damage', 'pass_fail');

  -- Section 8: TIRES & WHEELS
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind, measurement_unit) VALUES
    (v_template_id, 'TIRES & WHEELS', 8, 1, 'Tread depth within spec — record in comments', 'measurement', '32nds'),
    (v_template_id, 'TIRES & WHEELS', 8, 2, 'Tires — no cuts, bulges, sidewall, or uneven wear', 'pass_fail', NULL),
    (v_template_id, 'TIRES & WHEELS', 8, 3, 'Wheels / rims — no cracks, dents, or damage', 'pass_fail', NULL),
    (v_template_id, 'TIRES & WHEELS', 8, 4, 'Hub seals — no oil or grease leaks', 'pass_fail', NULL),
    (v_template_id, 'TIRES & WHEELS', 8, 5, 'Lug nuts — all present, properly torqued', 'pass_fail', NULL);

  -- Section 9: SAFETY COMPLIANCE
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind) VALUES
    (v_template_id, 'SAFETY COMPLIANCE', 9, 1, 'All required lights working (DOT compliant)', 'pass_fail'),
    (v_template_id, 'SAFETY COMPLIANCE', 9, 2, 'Reflective tape — clean, no missing sections', 'pass_fail'),
    (v_template_id, 'SAFETY COMPLIANCE', 9, 3, 'Rear bumper / underride guard — secure', 'pass_fail'),
    (v_template_id, 'SAFETY COMPLIANCE', 9, 4, 'Mudflaps (front and rear) — present, no damage', 'pass_fail'),
    (v_template_id, 'SAFETY COMPLIANCE', 9, 5, 'License plate, registration, DOT # visible', 'pass_fail');

  -- Section 10: FINAL ASSESSMENT (3 yes/no questions)
  INSERT INTO public.inspection_template_items (template_id, section, section_sequence, item_sequence, text, kind, good_answer) VALUES
    (v_template_id, 'FINAL ASSESSMENT', 10, 1, 'Is this trailer SAFE to go on the road?', 'yes_no', 'yes'),
    (v_template_id, 'FINAL ASSESSMENT', 10, 2, 'If inspected by a highway officer, would this trailer pass a clean inspection?', 'yes_no', 'yes'),
    (v_template_id, 'FINAL ASSESSMENT', 10, 3, 'Is the interior cleanliness, hermeticity, and quality up to customer standards and CTPAT safe?', 'yes_no', 'yes');
END $$;

-- ---------------------------------------------------------------------------
-- 7. Sanity check — every public table has RLS enabled (charter §3)
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
