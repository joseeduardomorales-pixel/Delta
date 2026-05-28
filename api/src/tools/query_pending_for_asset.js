// query_pending_for_asset — the "pick list" for a work order.
//
// Returns three sections for a given asset:
//   - issues: open/acknowledged/in_progress issues
//   - pm_schedules: overdue or due-soon PMs (filterable)
//   - campaigns: active campaign_assignments
//
// Use this:
//   - After opening a WO, to show the tech what they could work on.
//   - When the user asks "what's pending on CC07?" or "anything due on T05?"

import { computePmDue } from '../services/workOrderHelpers.js';

export const queryPendingForAsset = {
  name: 'query_pending_for_asset',
  description:
    "List everything pending on an asset — open issues, due/overdue PMs, " +
    'and active campaign assignments. Use after open_work_order to show ' +
    'the tech what they could work on, or when the user asks "what\'s ' +
    'pending on CC07?".\n\n' +
    'Each returned item has an `id` you can pass back to ' +
    'add_item_to_work_order as `source_id`.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: { type: 'string' },
      include_pm_ok: {
        type: 'boolean',
        description:
          'If true, return all PM schedules (incl. ones not yet due). ' +
          'Default false — only overdue/due_soon are returned.',
      },
    },
    required: ['asset_unit_number'],
  },
  allowedRoles: ['admin', 'dispatcher', 'tech'],
  async handler(input, ctx) {
    const { admin } = ctx;
    const unit = input.asset_unit_number.trim().toUpperCase();
    const { data: asset } = await admin
      .from('assets')
      .select('id, unit_number, type, metadata')
      .ilike('unit_number', unit)
      .maybeSingle();
    if (!asset) {
      return { ok: false, error: 'asset_not_found', asset_unit_number: unit };
    }

    const [{ data: issues }, { data: pms }, { data: meters }, { data: assignments }] =
      await Promise.all([
        admin
          .from('issues')
          .select('id, title, description, status, reported_at')
          .eq('asset_id', asset.id)
          .in('status', ['open', 'acknowledged', 'in_progress'])
          .order('reported_at', { ascending: false }),
        admin
          .from('pm_schedules')
          .select(
            'id, name, scope, cadence_type, interval_miles, interval_hours, interval_months, last_completed_at, last_completed_miles, last_completed_hours',
          )
          .eq('asset_id', asset.id)
          .eq('active', true),
        admin
          .from('meter_readings')
          .select('unit, value, recorded_at')
          .eq('asset_id', asset.id)
          .order('recorded_at', { ascending: false })
          .limit(20),
        admin
          .from('campaign_assignments')
          .select(
            'id, status, campaign:campaigns ( id, name, description, status, ends_at )',
          )
          .eq('asset_id', asset.id)
          .eq('status', 'open'),
      ]);

    const latestMiles = meters?.find((m) => m.unit === 'miles')?.value ?? null;
    const latestHours = meters?.find((m) => m.unit === 'hours')?.value ?? null;

    const pmList = (pms || []).map((pm) => {
      const { due, next_at } = computePmDue(pm, latestMiles, latestHours);
      return {
        ...pm,
        due,
        next_at,
      };
    });
    const pmFiltered = input.include_pm_ok
      ? pmList
      : pmList.filter((p) => p.due === 'overdue' || p.due === 'due_soon');

    const applicableCampaigns = (assignments || [])
      .filter((a) => a.campaign?.status === 'active')
      .map((a) => ({
        assignment_id: a.id,
        campaign_id: a.campaign.id,
        name: a.campaign.name,
        description: a.campaign.description,
        ends_at: a.campaign.ends_at,
      }));

    return {
      asset_unit_number: asset.unit_number,
      current_miles: latestMiles,
      current_hours: latestHours,
      issues: (issues || []).map((i) => ({
        id: i.id,
        short_id: i.id.slice(0, 8),
        title: i.title,
        description: i.description,
        status: i.status,
        reported_at: i.reported_at,
      })),
      pm_schedules: pmFiltered,
      campaigns: applicableCampaigns,
      summary: {
        issues: issues?.length ?? 0,
        pms_overdue: pmList.filter((p) => p.due === 'overdue').length,
        pms_due_soon: pmList.filter((p) => p.due === 'due_soon').length,
        campaigns: applicableCampaigns.length,
      },
    };
  },
};
