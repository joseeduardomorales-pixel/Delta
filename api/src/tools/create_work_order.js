// create_work_order — the core "write" tool. Inserts a work_orders row
// for the caller (user_id = ctx.user.id), defaults approval_status to
// 'pending_review' (enforced by DB trigger anyway for non-admin), and
// returns a confirmation string the assistant must echo to the user.

export const createWorkOrder = {
  name: 'create_work_order',
  description:
    'Log a work order. Use this whenever a tech describes work they DID ' +
    '(repair, pm, inspection) or whenever someone reports an issue. ' +
    'After this tool returns, ALWAYS include the `confirmation` field ' +
    'verbatim in your reply so the user can verify and undo if needed.\n\n' +
    'Type guidance:\n' +
    '  - pm: scheduled/preventive maintenance (oil change, DOT inspection)\n' +
    '  - repair: fixing something broken\n' +
    '  - issue: a problem found, not yet fixed\n' +
    '  - inspection: a check that does not modify anything\n' +
    '  - other: doesn\'t fit the above\n\n' +
    'Dispatchers can only create type=issue. Techs and admin can create any.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: {
        type: 'string',
        description:
          'The unit_number (e.g., "CC07", "BF1701"). If the user did not ' +
          'specify, ask before calling this tool.',
      },
      type: {
        type: 'string',
        enum: ['pm', 'repair', 'issue', 'inspection', 'other'],
      },
      title: {
        type: 'string',
        description:
          'Short headline (3–10 words). E.g. "Oil change" or ' +
          '"Reefer not cooling".',
      },
      description: {
        type: 'string',
        description: 'Longer narrative. Optional if title is self-explanatory.',
      },
      raw_input: {
        type: 'string',
        description:
          'The user\'s exact original message, verbatim. Never paraphrased.',
      },
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'completed'],
        description:
          'Default: "completed" for repair/pm/inspection (the work is done ' +
          'when the tech narrates it). Default "open" for issue.',
      },
    },
    required: ['asset_unit_number', 'type', 'title', 'raw_input'],
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;

    // Dispatcher gate: enforce here as well as via RLS — clearer error.
    if (user.role === 'dispatcher' && input.type !== 'issue') {
      return {
        ok: false,
        error: 'dispatcher_can_only_create_issue',
        message: 'Dispatchers can only report issues, not open work orders.',
      };
    }

    // Resolve asset_id from unit_number (denormalized field stays even
    // if the asset is later deleted).
    let assetId = null;
    if (input.asset_unit_number) {
      const { data: assetRow } = await admin
        .from('assets')
        .select('id, unit_number')
        .ilike('unit_number', input.asset_unit_number)
        .maybeSingle();
      if (assetRow) assetId = assetRow.id;
    }

    const defaultStatus = input.type === 'issue' ? 'open' : 'completed';
    const status = input.status ?? defaultStatus;

    const { data, error } = await admin
      .from('work_orders')
      .insert({
        asset_id: assetId,
        asset_unit_number: input.asset_unit_number,
        user_id: user.id,
        type: input.type,
        status,
        title: input.title,
        description: input.description ?? null,
        raw_input: input.raw_input,
        approval_status: 'pending_review',
      })
      .select('id, started_at, asset_unit_number, type, title, status')
      .single();

    if (error) throw new Error(error.message);

    // Short, stable display id. We surface only the first 8 chars to keep
    // it readable in chat: WO-3f8a0b21.
    const shortId = data.id.slice(0, 8);
    const confirmation =
      `Logged WO-${shortId} — ${data.title} on ${data.asset_unit_number} ` +
      `(${data.type}, ${data.status}, pending review). Say "undo" to ` +
      `remove within 5 minutes.`;

    return {
      work_order: {
        id: data.id,
        short_id: shortId,
        asset_unit_number: data.asset_unit_number,
        type: data.type,
        title: data.title,
        status: data.status,
        approval_status: 'pending_review',
        started_at: data.started_at,
      },
      confirmation,
    };
  },
};
