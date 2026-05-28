// Delta — Claude tool registry.
// Each tool exports:
//   - name           string
//   - description    string  (shown to Claude)
//   - input_schema   JSON Schema
//   - allowedRoles   string[]
//   - handler        async (input, ctx) => result
//
// The registry returns the role-gated subset and dispatches by name.
// ctx shape: { user: { id, role, fullName }, admin: SupabaseClient,
//              conversationId, logger }
//
// New work-order session model (post-0005):
//   - issues are reported via report_issue
//   - work orders are sessions opened via open_work_order, with items
//     added via add_item_to_work_order and completed via complete_item.
//     Closed with close_work_order.
//   - log_completed_work is the fast-path for narrated past-tense work.
//   - query_pending_for_asset returns the pick list (issues + due PMs +
//     campaigns).
//   - void_work_order undoes a WO within the 5-min grace.

import { listAssets } from './list_assets.js';
import { reportIssue } from './report_issue.js';
import { queryPendingForAsset } from './query_pending_for_asset.js';
import { openWorkOrder } from './open_work_order.js';
import { addItemToWorkOrder } from './add_item_to_work_order.js';
import { completeItem } from './complete_item.js';
import { closeWorkOrder } from './close_work_order.js';
import { logCompletedWork } from './log_completed_work.js';
import { voidWorkOrder } from './void_work_order.js';

const ALL_TOOLS = [
  listAssets,
  reportIssue,
  queryPendingForAsset,
  openWorkOrder,
  addItemToWorkOrder,
  completeItem,
  closeWorkOrder,
  logCompletedWork,
  voidWorkOrder,
];

export function toolsForRole(role) {
  return ALL_TOOLS.filter((t) => t.allowedRoles.includes(role));
}

export function toolDefinitionsForClaude(role) {
  return toolsForRole(role).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export async function dispatchTool({ name, input, ctx }) {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { ok: false, error: `unknown_tool:${name}` };
  }
  if (!tool.allowedRoles.includes(ctx.user.role)) {
    return { ok: false, error: `role_not_permitted:${ctx.user.role}` };
  }
  try {
    const result = await tool.handler(input, ctx);
    // Tools that return an error object set ok:false themselves; everything
    // else gets the default ok:true wrapper.
    if (result && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      return result;
    }
    return { ok: true, ...result };
  } catch (e) {
    ctx.logger?.error(
      { err: e.message, tool: name, input },
      'tool: handler threw',
    );
    return { ok: false, error: e.message };
  }
}
