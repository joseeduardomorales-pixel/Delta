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

import { listAssets } from './list_assets.js';
import { queryPendingWork } from './query_pending_work.js';
import { createWorkOrder } from './create_work_order.js';
import { voidWorkOrder } from './void_work_order.js';
import { getMeterReading } from './get_meter_reading.js';

const ALL_TOOLS = [
  listAssets,
  queryPendingWork,
  createWorkOrder,
  voidWorkOrder,
  getMeterReading,
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
    return { ok: true, ...result };
  } catch (e) {
    ctx.logger?.error(
      { err: e.message, tool: name, input },
      'tool: handler threw',
    );
    return { ok: false, error: e.message };
  }
}
