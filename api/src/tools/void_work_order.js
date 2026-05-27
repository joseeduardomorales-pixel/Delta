// void_work_order — sets status='voided' on an own WO within the
// 5-min grace window. The DB grace policy already enforces the time
// window; we double-check here to give a friendly message.

// We use a Postgres RPC for the lookup-by-short-id case because UUID
// columns don't filter cleanly via PostgREST's LIKE. The common case
// ("undo my last one") doesn't need a short id at all — we just take
// the caller's most recent WO within the 5-min grace window.
const GRACE_MS = 5 * 60 * 1000;

export const voidWorkOrder = {
  name: 'void_work_order',
  description:
    'Void (undo) a work order the user just created. Use when the user ' +
    'says "undo", "scratch that", "wrong truck", "actually no", etc.\n\n' +
    'Default behavior (no arguments): void the user\'s most recent work ' +
    'order created within the last 5 minutes. This is the right call ' +
    '99% of the time — "undo" almost always means "the one I just logged".\n\n' +
    'If the user clearly refers to an older work order they remember the ' +
    'short_id of, pass it as `work_order_short_id` (8 hex chars).\n\n' +
    'After 5 minutes, only admin can void via the admin UI.',
  input_schema: {
    type: 'object',
    properties: {
      work_order_short_id: {
        type: 'string',
        description:
          'OPTIONAL. The 8-character short id from a previous confirmation ' +
          '(e.g., "df8ab191"). Omit to void the most recent WO automatically.',
        pattern: '^[0-9a-f]{8}$',
      },
      reason: {
        type: 'string',
        description: 'Brief reason (e.g., "wrong truck", "duplicate").',
      },
    },
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    const graceFloor = new Date(Date.now() - GRACE_MS).toISOString();

    // Find the candidate WO to void.
    let target = null;
    if (input.work_order_short_id) {
      // Find by short id within the user's recent WOs. We pull recent rows
      // and match the prefix in JS — avoids the uuid-LIKE issue.
      const { data: recent, error } = await admin
        .from('work_orders')
        .select('id, asset_unit_number, title, status')
        .eq('user_id', user.id)
        .gt('started_at', graceFloor)
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      target = (recent || []).find((r) =>
        r.id.startsWith(input.work_order_short_id),
      );
    } else {
      const { data: recent, error } = await admin
        .from('work_orders')
        .select('id, asset_unit_number, title, status')
        .eq('user_id', user.id)
        .gt('started_at', graceFloor)
        .neq('status', 'voided')
        .order('started_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      target = recent?.[0] ?? null;
    }

    if (!target) {
      return {
        ok: false,
        error: 'no_recent_work_order',
        message:
          'No work order from this user within the last 5 minutes. ' +
          'Anything older has to be voided by an admin.',
      };
    }
    if (target.status === 'voided') {
      return {
        ok: false,
        error: 'already_voided',
        message: `WO-${target.id.slice(0, 8)} is already voided.`,
      };
    }

    const { data, error } = await admin
      .from('work_orders')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: input.reason ?? 'undo',
      })
      .eq('id', target.id)
      .eq('user_id', user.id)
      .gt('started_at', graceFloor)
      .select('id, asset_unit_number, title')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return {
        ok: false,
        error: 'cannot_void',
        message:
          'The work order may have aged out of the 5-min grace window ' +
          'or been voided already. Ask an admin to void it.',
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
