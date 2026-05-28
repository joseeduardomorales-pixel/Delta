// add_item_to_work_order — append a line item to an open WO.
//
// Sources:
//   - 'issue'                 — links to an existing issue; on completion,
//                                resolves the issue.
//   - 'pm_schedule'           — links to a PM; on completion, snaps
//                                last_completed_* on the PM.
//   - 'campaign_assignment'   — links to a campaign_assignment; on
//                                completion, marks it done.
//   - 'ad_hoc'                — free-form work that doesn't link upstream.
//
// After insert, the WO is auto-bumped from 'open' to 'in_progress' on
// the first item. If linking to an issue, that issue is auto-set to
// 'in_progress'.

export const addItemToWorkOrder = {
  name: 'add_item_to_work_order',
  description:
    'Add a line item (a thing the tech is going to work on) to an open WO. ' +
    'Sources:\n' +
    '- "issue" — pass the issue id from query_pending_for_asset as source_id.\n' +
    '- "pm_schedule" — pass the PM id as source_id.\n' +
    '- "campaign_assignment" — pass the assignment_id as source_id.\n' +
    '- "ad_hoc" — for work that isn\'t tied to any upstream record. No source_id.\n\n' +
    'On the first item added, the WO status auto-bumps from "open" to ' +
    '"in_progress". If linking to an issue, the issue auto-moves to ' +
    '"in_progress" as well.',
  input_schema: {
    type: 'object',
    properties: {
      work_order_id: { type: 'string', description: 'UUID of the open WO.' },
      source: {
        type: 'string',
        enum: ['issue', 'pm_schedule', 'campaign_assignment', 'ad_hoc'],
      },
      source_id: {
        type: 'string',
        description:
          'UUID of the upstream record (issue / pm / assignment). Required ' +
          'unless source is "ad_hoc".',
      },
      type: {
        type: 'string',
        enum: ['pm', 'repair', 'inspection', 'other'],
        description: 'Classification of the work itself.',
      },
      title: { type: 'string', description: 'Short headline.' },
      description: { type: 'string' },
      raw_input: {
        type: 'string',
        description: "The user's exact original message, verbatim.",
      },
    },
    required: ['work_order_id', 'source', 'type', 'title'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin } = ctx;
    if (input.source !== 'ad_hoc' && !input.source_id) {
      return {
        ok: false,
        error: 'source_id_required',
        message: `source=${input.source} requires source_id.`,
      };
    }

    const { data: wo } = await admin
      .from('work_orders')
      .select('id, status')
      .eq('id', input.work_order_id)
      .maybeSingle();
    if (!wo) {
      return { ok: false, error: 'work_order_not_found' };
    }
    if (wo.status !== 'open' && wo.status !== 'in_progress') {
      return { ok: false, error: `wo_status_${wo.status}` };
    }

    const { data: maxSeq } = await admin
      .from('work_order_items')
      .select('sequence')
      .eq('work_order_id', input.work_order_id)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSeq = (maxSeq?.sequence ?? -1) + 1;

    const insert = {
      work_order_id: input.work_order_id,
      sequence: nextSeq,
      source: input.source,
      source_issue_id: input.source === 'issue' ? input.source_id : null,
      source_pm_schedule_id: input.source === 'pm_schedule' ? input.source_id : null,
      source_campaign_assignment_id:
        input.source === 'campaign_assignment' ? input.source_id : null,
      type: input.type,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      raw_input: input.raw_input?.trim() || null,
      status: 'pending',
    };

    const { data: item, error } = await admin
      .from('work_order_items')
      .insert(insert)
      .select('id, sequence, source, type, title, status')
      .single();
    if (error) throw new Error(error.message);

    // Side effects
    if (input.source === 'issue') {
      await admin
        .from('issues')
        .update({ status: 'in_progress' })
        .eq('id', input.source_id)
        .eq('status', 'open');
    }
    if (wo.status === 'open') {
      await admin
        .from('work_orders')
        .update({ status: 'in_progress' })
        .eq('id', input.work_order_id);
    }

    return {
      item: { ...item, short_id: item.id.slice(0, 8) },
      confirmation: `Added item #${item.sequence + 1}: "${item.title}" (${item.type}) — pending.`,
    };
  },
};
