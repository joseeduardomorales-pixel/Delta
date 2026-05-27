// void_work_order — sets status='voided' on an own WO within the
// 5-min grace window. The DB grace policy already enforces the time
// window; we double-check here to give a friendly message.

export const voidWorkOrder = {
  name: 'void_work_order',
  description:
    'Void (undo) a work order the user just created. Use when the user ' +
    'says "undo", "scratch that", "wrong truck", etc. within 5 minutes of ' +
    'creation. After 5 minutes, only admin can void via the admin UI.',
  input_schema: {
    type: 'object',
    properties: {
      work_order_id: {
        type: 'string',
        description:
          'Full UUID or short-id prefix (first 8 chars). If multiple WOs ' +
          'match a short prefix, use the most recent.',
      },
      reason: {
        type: 'string',
        description: 'Brief reason (e.g., "wrong truck", "duplicate").',
      },
    },
    required: ['work_order_id'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;

    // Resolve short-id prefix to full UUID if needed.
    let resolvedId = input.work_order_id;
    if (resolvedId.length === 8) {
      const { data: matches } = await admin
        .from('work_orders')
        .select('id, started_at')
        .like('id', `${resolvedId}%`)
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(1);
      if (!matches?.length) {
        return { ok: false, error: 'work_order_not_found' };
      }
      resolvedId = matches[0].id;
    }

    const { data, error } = await admin
      .from('work_orders')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: input.reason ?? 'undo',
      })
      .eq('id', resolvedId)
      .eq('user_id', user.id) // can only void own (admin overrides via RLS)
      .gt(
        'started_at',
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ) // within 5-min grace
      .select('id, asset_unit_number, title')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return {
        ok: false,
        error: 'cannot_void',
        message:
          'Either the work order is older than 5 minutes, or it does not ' +
          'belong to this user. Ask an admin to void it.',
      };
    }
    return {
      voided: {
        id: data.id,
        short_id: data.id.slice(0, 8),
        asset_unit_number: data.asset_unit_number,
        title: data.title,
      },
      confirmation: `Voided WO-${data.id.slice(0, 8)} (${data.title} on ${data.asset_unit_number}).`,
    };
  },
};
