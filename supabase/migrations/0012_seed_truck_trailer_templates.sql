-- ============================================================================
-- 0012 — Seed truck + trailer brake/tire inspection templates
-- ============================================================================
-- Two new templates from Lalo's Excel files:
--
--   - "Truck Brake & Tire Inspection"  scope=truck   21 items in 2 sections
--   - "Trailer Brake & Tire Inspection" scope=trailer 18 items in 2 sections
--
-- Each template ends with the same 3 yes/no final-assessment questions
-- (auto-appended per Q4-A decision) flagged requires_photo_on_fail=false
-- per Lalo's "no pictures necessary on final assessment" note.
--
-- The criteria text from the Excel goes into inspection_template_items.
-- description; the "Quick Reference" tab from each Excel goes into
-- inspection_templates.quick_reference.
-- ============================================================================

DO $$
DECLARE
  truck_template_id   uuid;
  trailer_template_id uuid;
BEGIN
  -- ──────────────────────────────────────────────────────────────────────
  -- TRUCK TEMPLATE
  -- ──────────────────────────────────────────────────────────────────────
  INSERT INTO public.inspection_templates (name, description, scope, active, quick_reference)
  VALUES (
    'Truck Brake & Tire Inspection',
    'Cold Cargo''s power-unit brake and tire walkaround. Criteria per FMCSA 49 CFR Part 393/396 and CVSA North American Out-of-Service criteria.',
    'truck',
    true,
$$• 20% Brake Rule — Vehicle is OOS if 20% or more of the service brakes are defective.
• Pushrod stroke (Type 30) — Standard chamber adjustment limit 2 in; long-stroke 2.5 in. At or beyond limit = defective brake.
• Lining thickness — Drum: OOS below 1/4 in. Disc: OOS below 1/8 in at thinnest point.
• Air loss rate (combination) — Engine off, brakes applied: OOS if loss > 2 psi/min.
• Low-air warning — Must be present and operative, activating at or above 55 psi.
• Steer tread depth — OOS below 4/32 in in any major groove on a front steer tire.
• Drive / other tread depth — OOS below 2/32 in in any major groove.
• Steer tire restriction — No regrooved, recapped, or retreaded tires on the steer axle.
• ABS (tractor) — Air-braked power units built on/after 3/1/1997 must have working ABS.
• Wheel fasteners — OOS if any loose, missing, broken, cracked, or stripped.

Operational pre-inspection aid. Summarizes FMCSA Part 393/396 and CVSA OOS criteria; not the official handbook. When in doubt, place the unit out of service and verify against the current CVSA North American Standard Out-of-Service Criteria.$$
  )
  RETURNING id INTO truck_template_id;

  -- Truck — Section 1: BRAKE SYSTEM (12 items)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, description, requires_photo_on_fail)
  VALUES
    (truck_template_id, 'BRAKE SYSTEM', 1, 1, 'Pushrod stroke / brake adjustment', 'pass_fail',
      'OOS if stroke at or beyond adjustment limit for chamber type/size (e.g. Type 30 std = 2 in, long-stroke = 2.5 in). 20% rule: OOS if 20%+ of brakes defective. Check each wheel.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 2, 'Brake linings / pads', 'pass_fail',
      'OOS if lining/pad < 1/4 in (drum) or < 1/8 in (disc) at thinnest, missing, cracked through, oil/grease soaked, or loose. Check each wheel.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 3, 'Brake drums / rotors', 'pass_fail',
      'OOS if external crack opens when brake applied, or any portion missing / about to fall away. Check each wheel.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 4, 'Air compressor & governor', 'pass_fail',
      'FAIL if compressor will not build/maintain pressure, governor cut-in/cut-out out of spec, or drive belt loose/cracked. Engine.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 5, 'Air lines & hoses', 'pass_fail',
      'OOS if audible leak at connection, hose chafed through outer cover exposing reinforcement, kinked, or bulging under pressure. Check all.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 6, 'Air chambers / actuators', 'pass_fail',
      'OOS if chamber loose, cracked, broken, or mismatched (different size) on same axle. Check each wheel.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 7, 'Slack adjusters', 'pass_fail',
      'OOS if missing, broken, or non-functioning. Auto slack adjusters must self-adjust. Check each wheel.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 8, 'Low-air warning device', 'pass_fail',
      'OOS if low-air warning (light/buzzer/gauge) missing or inoperative. Must activate at or above 55 psi. Dash.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 9, 'Air loss rate / reservoirs', 'pass_fail',
      'OOS if loss > 2 psi/min (combination, engine off, brakes applied). Tanks secure, drain valves operable, no leaks. System.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 10, 'ABS warning lamp (tractor)', 'pass_fail',
      'FAIL if malfunction lamp stays on or is inoperative. Power units built after 3/1/1997 must have functioning ABS. Dash.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 11, 'Parking / spring brake', 'pass_fail',
      'FAIL if spring brake fails to apply on air loss or will not hold loaded unit on grade. System.', true),
    (truck_template_id, 'BRAKE SYSTEM', 1, 12, 'Brake balance & operation', 'pass_fail',
      'FAIL if brakes drag, grab, pull, or fail to apply/release evenly on actuation test. System.', true);

  -- Truck — Section 2: TIRES & WHEELS (9 items)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, description, requires_photo_on_fail)
  VALUES
    (truck_template_id, 'TIRES & WHEELS', 2, 1, 'Tread depth — STEER axle', 'pass_fail',
      'OOS if < 4/32 in in any major groove on a front steer tire. Measure at multiple points. Steer L / R.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 2, 'Tread depth — DRIVE axles', 'pass_fail',
      'OOS if < 2/32 in in any major groove on drive/other axles. Each drive tire.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 3, 'Tire condition — sidewall & tread', 'pass_fail',
      'OOS if tread/sidewall separation, bump/bulge/knot, exposed cord or belt, or any cut exposing ply/belt. Each tire.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 4, 'Steer tire restrictions', 'pass_fail',
      'OOS if regrooved, recapped, or retreaded tire used on the steer axle, or steer tire below load rating. Steer L / R.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 5, 'Inflation / flat', 'pass_fail',
      'OOS if flat, audible air leak, or noticeably underinflated below load requirement. Use gauge — do not thump. Each tire.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 6, 'Tire load / mounting', 'pass_fail',
      'OOS if tire contacts another tire, frame, or body, or is mounted/inflated beyond marked limits. Each tire.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 7, 'Wheels & rims', 'pass_fail',
      'OOS if cracked/broken rim, cracks across spokes/web, or elongated bolt holes. Each wheel.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 8, 'Fasteners (lugs / studs)', 'pass_fail',
      'OOS if any loose, missing, broken, cracked, or stripped stud/nut; OOS threshold varies by total count. Each wheel.', true),
    (truck_template_id, 'TIRES & WHEELS', 2, 9, 'Hub / oil seal', 'pass_fail',
      'FAIL if leaking lube, low/contaminated oil in hub sight glass, or evidence of bearing overheat. Each wheel end.', true);

  -- Truck — Section 3: FINAL ASSESSMENT (3 closing yes/no questions, photo NOT required)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, good_answer, description, requires_photo_on_fail)
  VALUES
    (truck_template_id, 'FINAL ASSESSMENT', 3, 1, 'Is this unit SAFE to go on the road?', 'yes_no', 'yes',
      'Your overall judgment after the walkaround. Explain a NO in the notes.', false),
    (truck_template_id, 'FINAL ASSESSMENT', 3, 2, 'If inspected by a highway officer, would this unit pass a clean inspection?', 'yes_no', 'yes',
      'Imagine a DOT roadside check right now. Explain a NO in the notes.', false),
    (truck_template_id, 'FINAL ASSESSMENT', 3, 3, 'Is the cab interior, mirrors, and lighting up to customer / DOT standards?', 'yes_no', 'yes',
      'Cleanliness, glass condition, lights operational. Explain a NO in the notes.', false);

  -- ──────────────────────────────────────────────────────────────────────
  -- TRAILER TEMPLATE
  -- ──────────────────────────────────────────────────────────────────────
  INSERT INTO public.inspection_templates (name, description, scope, active, quick_reference)
  VALUES (
    'Trailer Brake & Tire Inspection',
    'Cold Cargo''s trailer brake and tire walkaround — applies to reefer trailers and dry vans alike. Criteria per FMCSA 49 CFR Part 393/396 and CVSA North American Out-of-Service criteria.',
    'trailer',
    true,
$$• 20% Brake Rule — Vehicle is OOS if 20% or more of the service brakes are defective.
• Pushrod stroke (Type 30) — Standard chamber adjustment limit 2 in; long-stroke 2.5 in. At or beyond limit = defective brake.
• Lining thickness — Drum: OOS below 1/4 in. Disc: OOS below 1/8 in at thinnest point.
• Air loss rate — Engine off, brakes released: OOS if loss > 3 psi/min (single vehicle).
• Tread depth — All trailer / non-steer axles: OOS below 2/32 in in any major groove.
• Tire damage — OOS for tread/sidewall separation, bulge/knot, exposed cords or belt, or cut exposing ply.
• Wheel fasteners — OOS if any loose, missing, broken, cracked, or stripped.
• ABS (trailer) — Trailers built on/after 3/1/1998 must have working ABS.

Operational pre-inspection aid. Summarizes FMCSA Part 393/396 and CVSA OOS criteria; not the official handbook. When in doubt, place the unit out of service and verify against the current CVSA North American Standard Out-of-Service Criteria.$$
  )
  RETURNING id INTO trailer_template_id;

  -- Trailer — Section 1: BRAKE SYSTEM (10 items)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, description, requires_photo_on_fail)
  VALUES
    (trailer_template_id, 'BRAKE SYSTEM', 1, 1, 'Pushrod stroke / brake adjustment', 'pass_fail',
      'OOS if stroke at or beyond adjustment limit for chamber size (e.g. Type 30 long-stroke = 2.5 in). 20% rule: OOS if 20%+ of brakes defective. Each axle / wheel.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 2, 'Brake linings / pads', 'pass_fail',
      'OOS if lining/pad < 1/4 in (drum) or < 1/8 in (disc) at thinnest, missing, cracked through, soaked w/ oil or grease, or loose. Each wheel.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 3, 'Brake drums / rotors', 'pass_fail',
      'OOS if external crack opens when brake applied, or any portion missing / about to fall away. Each wheel.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 4, 'Air lines & hoses', 'pass_fail',
      'OOS if audible leak at connection, hose chafed through outer cover exposing reinforcement, kinked, or bulging under pressure. All.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 5, 'Air chambers / actuators', 'pass_fail',
      'OOS if chamber loose, cracked, broken, or mismatched (different size) on same axle. Each wheel.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 6, 'Slack adjusters', 'pass_fail',
      'OOS if missing, broken, or non-functioning. Auto slack adjusters must self-adjust. Each wheel.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 7, 'Air loss rate / reservoir', 'pass_fail',
      'OOS if air loss exceeds 3 psi/min (single) with engine off & brakes released. Check tank for leaks, secure mount, drain valve. System.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 8, 'ABS warning lamp (trailer)', 'pass_fail',
      'FAIL if malfunction lamp stays on or is inoperative. Trailers built after 3/1/1998 must have functioning ABS. Trailer.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 9, 'Parking / emergency brake', 'pass_fail',
      'FAIL if spring brake fails to apply on air loss or will not hold. Verify breakaway / emergency function. System.', true),
    (trailer_template_id, 'BRAKE SYSTEM', 1, 10, 'Brake balance & operation', 'pass_fail',
      'FAIL if brakes drag, grab, or fail to apply/release evenly on actuation test. System.', true);

  -- Trailer — Section 2: TIRES & WHEELS (8 items)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, description, requires_photo_on_fail)
  VALUES
    (trailer_template_id, 'TIRES & WHEELS', 2, 1, 'Tread depth', 'pass_fail',
      'OOS if < 2/32 in in any major groove (all trailer/other axles). Measure at multiple points. Each tire.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 2, 'Tire condition — sidewall & tread', 'pass_fail',
      'OOS if tread/sidewall separation, bump/bulge/knot, exposed cord or belt material, or any cut exposing ply/belt. Each tire.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 3, 'Inflation / flat', 'pass_fail',
      'OOS if flat, audible air leak, or noticeably underinflated below load requirement. Check w/ gauge — do not thump. Each tire.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 4, 'Tire load / mounting', 'pass_fail',
      'OOS if tire contacts another tire, frame, or body, or is mounted/inflated beyond marked limits. Each tire.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 5, 'Regrooved / unsafe tires', 'pass_fail',
      'OOS if regrooved tire on a position where prohibited, or tire so worn fabric is exposed. Each tire.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 6, 'Wheels & rims', 'pass_fail',
      'OOS if cracked/broken rim, cracks across spokes/web, or elongated bolt holes. Each wheel.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 7, 'Fasteners (lugs / studs)', 'pass_fail',
      'OOS if any loose, missing, broken, cracked, or stripped stud/nut; OOS threshold varies by total count. Each wheel.', true),
    (trailer_template_id, 'TIRES & WHEELS', 2, 8, 'Hub / oil seal', 'pass_fail',
      'FAIL if leaking lube, low/contaminated oil in hub sight glass, or evidence of bearing overheat. Each wheel end.', true);

  -- Trailer — Section 3: FINAL ASSESSMENT (3 closing yes/no questions, photo NOT required)
  INSERT INTO public.inspection_template_items
    (template_id, section, section_sequence, item_sequence, text, kind, good_answer, description, requires_photo_on_fail)
  VALUES
    (trailer_template_id, 'FINAL ASSESSMENT', 3, 1, 'Is this trailer SAFE to go on the road?', 'yes_no', 'yes',
      'Your overall judgment after the walkaround. Explain a NO in the notes.', false),
    (trailer_template_id, 'FINAL ASSESSMENT', 3, 2, 'If inspected by a highway officer, would this trailer pass a clean inspection?', 'yes_no', 'yes',
      'Imagine a DOT roadside check right now. Explain a NO in the notes.', false),
    (trailer_template_id, 'FINAL ASSESSMENT', 3, 3, 'Is the interior cleanliness, hermeticity, and quality up to customer standards and CTPAT safe?', 'yes_no', 'yes',
      'Cargo box / interior walkaround. Explain a NO in the notes.', false);

END $$;
