// get_meter_reading — return the latest meter_readings row for an asset
// + unit. In Phase 3a, meter_readings is only populated by manual entry
// (no Intangles/TrackFleet sync yet — that's 3b). If there are no
// readings, the tool returns ok:true with reading=null so Claude can
// gracefully say "no recent reading available".

export const getMeterReading = {
  name: 'get_meter_reading',
  description:
    'Fetch the most recent meter reading for an asset. unit="miles" for ' +
    'trucks (odometer), unit="hours" for reefer engine/work hours. Returns ' +
    'the latest reading or null if none recorded yet.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: { type: 'string' },
      unit: { type: 'string', enum: ['miles', 'hours'] },
    },
    required: ['asset_unit_number', 'unit'],
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    const { admin } = ctx;

    // Resolve asset_id from unit_number.
    const { data: asset } = await admin
      .from('assets')
      .select('id, unit_number, type')
      .ilike('unit_number', input.asset_unit_number)
      .maybeSingle();
    if (!asset) {
      return { ok: false, error: 'asset_not_found', asset_unit_number: input.asset_unit_number };
    }

    const { data, error } = await admin
      .from('meter_readings')
      .select('value, unit, source, recorded_at')
      .eq('asset_id', asset.id)
      .eq('unit', input.unit)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return {
      asset_unit_number: asset.unit_number,
      reading: data
        ? {
            value: data.value,
            unit: data.unit,
            source: data.source,
            recorded_at: data.recorded_at,
          }
        : null,
    };
  },
};
