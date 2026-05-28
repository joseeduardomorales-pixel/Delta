// close_work_order — mark the WO completed. Should only happen after all
// items are either 'done' or 'skipped'. We don't enforce that hard-line
// here because the tech might want to close a WO and leave a "pending"
// item for next visit; the admin reviewer can flag that.

export const closeWorkOrder = {
  name: 'close_work_order',
  description:
    'Close a work order. Use when the tech says "that\'s it" / "all done" / ' +
    '"close it out". Optional summary captures any wrap-up notes.',
  input_schema: {
    type: 'object',
    properties: {
      work_order_id: { type: 'string' },
      summary: { type: 'string', description: 'Optional wrap-up note.' },
    },
    required: ['work_order_id'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin } = ctx;
    const { data: wo } = await admin
      .from('work_orders')
      .select('id, status, asset_unit_number')
      .eq('id', input.work_order_id)
      .maybeSingle();
    if (!wo) return { ok: false, error: 'work_order_not_found' };
    if (wo.status === 'completed') {
      return { ok: false, error: 'already_completed' };
    }
    if (wo.status === 'voided') {
      return { ok: false, error: 'voided' };
    }

    const { data, error } = await admin
      .from('work_orders')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        summary: input.summary?.trim() || null,
      })
      .eq('id', input.work_order_id)
      .select('id, status, completed_at')
      .single();
    if (error) throw new Error(error.message);

    // Count items by status for the confirmation message.
    const { data: items } = await admin
      .from('work_order_items')
      .select('status')
      .eq('work_order_id', input.work_order_id);
    const counts = (items || []).reduce(
      (acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }),
      {},
    );

    return {
      work_order: {
        id: data.id,
        short_id: data.id.slice(0, 8),
        status: data.status,
        completed_at: data.completed_at,
      },
      counts,
      confirmation:
        `Closed WO-${data.id.slice(0, 8)} on ${wo.asset_unit_number}. ` +
        `${counts.done || 0} done, ${counts.skipped || 0} skipped, ` +
        `${counts.pending || 0} pending. Pending review by admin.`,
    };
  },
};
