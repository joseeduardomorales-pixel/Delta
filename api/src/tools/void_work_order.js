// void_work_order — undo a WO created within the 5-min grace window.
//
// Default behavior (no arguments): voids the user's most recent WO,
// whatever its status. This is the right call when the user says
// "undo" right after a log_completed_work or open_work_order.
//
// The 5-min grace is enforced both here (for a friendly error) and by
// the DB grace policy.

const GRACE_MS = 5 * 60 * 1000;

export const voidWorkOrder = {
  name: 'void_work_order',
  description:
    'Void (undo) a work order the user just created. Use when the user ' +
    'says "undo", "scratch that", "wrong truck", etc.\n\n' +
    'Default (no arguments): void the user\'s most recent WO created in ' +
    'the last 5 minutes. This is the right call ~99% of the time. \n\n' +
    'If the user refers to an older WO by its 8-char short_id, pass it as ' +
    'work_order_short_id. After 5 min, only admins can void via the UI.',
  input_schema: {
    type: 'object',
    properties: {
      work_order_short_id: {
        type: 'string',
        description:
          'OPTIONAL. 8-character short id from a previous confirmation. ' +
          'Omit to void the most recent WO automatically.',
        pattern: '^[0-9a-f]{8}$',
      },
      reason: { type: 'string', description: 'Brief reason (e.g., "wrong truck").' },
    },
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    const graceFloor = new Date(Date.now() - GRACE_MS).toISOString();

    let target = null;
    if (input.work_order_short_id) {
      const { data: recent } = await admin
        .from('work_orders')
        .select('id, asset_unit_number, status')
        .eq('user_id', user.id)
        .gt('started_at', graceFloor)
        .order('started_at', { ascending: false })
        .limit(20);
      target = (recent || []).find((r) =>
        r.id.startsWith(input.work_order_short_id),
      );
    } else {
      const { data: recent } = await admin
        .from('work_orders')
        .select('id, asset_unit_number, status')
        .eq('user_id', user.id)
        .gt('started_at', graceFloor)
        .neq('status', 'voided')
        .order('started_at', { ascending: false })
        .limit(1);
      target = recent?.[0] ?? null;
    }

    if (!target) {
      return {
        ok: false,
        error: 'no_recent_work_order',
        message:
          'No WO from you in the last 5 minutes. Anything older has to be ' +
          'voided by an admin.',
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
      .select('id, asset_unit_number')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        ok: false,
        error: 'cannot_void',
        message: 'WO aged out of the grace window or was already voided.',
      };
    }
    return {
      voided: {
        id: data.id,
        short_id: data.id.slice(0, 8),
        asset_unit_number: data.asset_unit_number,
      },
      confirmation: `Voided WO-${data.id.slice(0, 8)} on ${data.asset_unit_number}.`,
    };
  },
};
