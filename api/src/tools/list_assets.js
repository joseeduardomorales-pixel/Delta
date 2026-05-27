// list_assets — read-only catalog query. Available to all roles.

export const listAssets = {
  name: 'list_assets',
  description:
    'List Cold Cargo assets (trucks, trailers, reefers). Filter by type, ' +
    'active status, or a substring of the unit number. Use when the tech ' +
    'asks "what trucks do we have?" or when you need to verify a unit ' +
    'number before creating a work order.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['truck', 'trailer', 'reefer'],
        description: 'Restrict to a specific asset type.',
      },
      active: {
        type: 'boolean',
        description: 'If set, restrict to active=true (default true).',
      },
      search: {
        type: 'string',
        description:
          'Case-insensitive substring of unit_number (e.g., "CC0" or "07").',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    let q = ctx.admin
      .from('assets')
      .select('unit_number, type, make, model, year, vin, active')
      .order('unit_number')
      .limit(input.limit ?? 20);
    if (input.type) q = q.eq('type', input.type);
    if (input.active !== false) q = q.eq('active', true);
    if (input.search) q = q.ilike('unit_number', `%${input.search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { assets: data, count: data.length };
  },
};
