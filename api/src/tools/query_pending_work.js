// query_pending_work — list open work orders, optionally filtered by asset.

export const queryPendingWork = {
  name: 'query_pending_work',
  description:
    'List work orders that are currently open or in-progress (status open ' +
    'or in_progress). Use when the tech asks "what\'s open on CC07?" or ' +
    '"any pending issues on T05?" or "what should I be working on?".',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: {
        type: 'string',
        description: 'Restrict to a specific unit (e.g., "CC07" or "T05").',
      },
      type: {
        type: 'string',
        enum: ['pm', 'repair', 'issue', 'inspection', 'other'],
        description: 'Restrict to a work-order type.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    let q = ctx.admin
      .from('work_orders')
      .select(
        'id, asset_unit_number, type, status, title, description, started_at, approval_status',
      )
      .in('status', ['open', 'in_progress'])
      .order('started_at', { ascending: false })
      .limit(input.limit ?? 20);
    if (input.asset_unit_number) {
      q = q.eq('asset_unit_number', input.asset_unit_number);
    }
    if (input.type) q = q.eq('type', input.type);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { work_orders: data, count: data.length };
  },
};
