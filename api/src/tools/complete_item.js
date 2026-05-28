// complete_item — mark a work_order_item as done, skipped, or update notes.
//
// On status='done', cascades:
//   - Linked issue → resolved (with resolved_by_work_order_item_id)
//   - Linked PM → last_completed_miles/hours snapped from opening meter,
//                 last_completed_work_order_item_id set.
//   - Linked campaign_assignment → completed.
//
// On status='skipped', the item is shelved with an optional skip reason.

import { cascadeCompleteItem } from '../services/workOrderHelpers.js';

export const completeItem = {
  name: 'complete_item',
  description:
    'Update a work_order_item — typically to mark it done. \n\n' +
    'On status="done", the cascade:\n' +
    '- Linked issue → resolved\n' +
    '- Linked PM → last_completed_* snapped from the WO\'s opening meter\n' +
    '- Linked campaign_assignment → completed\n\n' +
    'On status="skipped", mark the item shelved with skipped_reason.',
  input_schema: {
    type: 'object',
    properties: {
      item_id: { type: 'string' },
      status: { type: 'string', enum: ['done', 'skipped'] },
      notes: { type: 'string', description: 'Free-form notes from the tech.' },
      skipped_reason: { type: 'string' },
    },
    required: ['item_id', 'status'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    const { data: before } = await admin
      .from('work_order_items')
      .select(
        'id, work_order_id, source, source_issue_id, source_pm_schedule_id, source_campaign_assignment_id, status, title',
      )
      .eq('id', input.item_id)
      .maybeSingle();
    if (!before) return { ok: false, error: 'item_not_found' };
    if (before.status === input.status) {
      return {
        ok: false,
        error: 'already_in_status',
        message: `Item is already ${before.status}.`,
      };
    }

    const update = { status: input.status };
    if (typeof input.notes === 'string') update.notes = input.notes.trim();
    if (input.status === 'skipped' && input.skipped_reason) {
      update.skipped_reason = input.skipped_reason.trim();
    }
    if (input.status === 'done') {
      update.completed_at = new Date().toISOString();
      update.completed_by_user_id = user.id;
      // Snapshot the WO's opening meter onto the item for the PM cascade.
      const { data: wo } = await admin
        .from('work_orders')
        .select('opening_meter_reading_id')
        .eq('id', before.work_order_id)
        .maybeSingle();
      if (wo?.opening_meter_reading_id) {
        update.meter_reading_id = wo.opening_meter_reading_id;
      }
    }

    const { data: after, error } = await admin
      .from('work_order_items')
      .update(update)
      .eq('id', input.item_id)
      .select('id, status, completed_at, meter_reading_id')
      .single();
    if (error) throw new Error(error.message);

    let linked = {};
    if (input.status === 'done' && before.status !== 'done') {
      let openingMeter = null;
      if (after.meter_reading_id) {
        const { data: mr } = await admin
          .from('meter_readings')
          .select('value, unit, recorded_at')
          .eq('id', after.meter_reading_id)
          .maybeSingle();
        openingMeter = mr ?? null;
      }
      linked = await cascadeCompleteItem({
        admin,
        item: {
          id: after.id,
          source: before.source,
          source_issue_id: before.source_issue_id,
          source_pm_schedule_id: before.source_pm_schedule_id,
          source_campaign_assignment_id: before.source_campaign_assignment_id,
        },
        openingMeterReading: openingMeter,
      });
    }

    const verb = input.status === 'done' ? 'Done' : 'Skipped';
    return {
      item: { id: after.id, status: after.status },
      linked,
      confirmation: `${verb}: "${before.title}".`,
    };
  },
};
