// report_issue — log a problem found on an asset. Issues are NOT work
// orders; they're the *upstream* of work orders. Any role can report an
// issue. A tech later opens a work order on the asset, sees this issue
// in the pick list, and addresses it.
//
// Use this whenever a user reports something broken / wrong without
// describing repair work. Examples:
//   - "CC07 has a coolant leak"
//   - "T12 brake light is out"
//   - "Reefer on BF1701 not holding temp"
//
// If the user is describing work they JUST DID (oil change, repair),
// use log_completed_work or open_work_order instead.

export const reportIssue = {
  name: 'report_issue',
  description:
    'Report a problem found on an asset (NOT yet fixed). Use whenever a ' +
    'user mentions something broken/wrong without describing repair work. ' +
    'Returns a confirmation the assistant must echo verbatim.\n\n' +
    'If the user instead says they DID some work (e.g. "I just changed the ' +
    'oil"), use log_completed_work, NOT this tool.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: {
        type: 'string',
        description: 'Unit number (e.g. "CC07", "BF1701"). Ask if unclear.',
      },
      title: {
        type: 'string',
        description: 'Short headline (3–10 words). E.g. "Coolant leak", "Reefer not cooling".',
      },
      description: {
        type: 'string',
        description: 'Optional longer detail.',
      },
      raw_input: {
        type: 'string',
        description: "The user's exact original message, verbatim.",
      },
    },
    required: ['asset_unit_number', 'title', 'raw_input'],
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    const unit = input.asset_unit_number.trim().toUpperCase();

    const { data: asset } = await admin
      .from('assets')
      .select('id, unit_number')
      .ilike('unit_number', unit)
      .maybeSingle();

    const { data, error } = await admin
      .from('issues')
      .insert({
        asset_id: asset?.id ?? null,
        asset_unit_number: unit,
        reported_by: user.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        raw_input: input.raw_input,
        status: 'open',
      })
      .select('id, asset_unit_number, title, status, reported_at')
      .single();
    if (error) throw new Error(error.message);

    const short = data.id.slice(0, 8);
    return {
      issue: {
        id: data.id,
        short_id: short,
        asset_unit_number: data.asset_unit_number,
        title: data.title,
        status: data.status,
      },
      confirmation:
        `Issue logged: ISS-${short} — "${data.title}" on ${data.asset_unit_number}. ` +
        `A tech will pick this up when they open a work order on this asset.`,
    };
  },
};
