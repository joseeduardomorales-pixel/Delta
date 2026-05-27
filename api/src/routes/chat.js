// POST /api/chat
// --------------
// One conversational turn. The server:
//   1. Loads or creates a conversation for the caller
//   2. Persists the user message
//   3. Calls Claude with a role-bounded toolset + the message history
//   4. Loops: while Claude returns tool_use, execute each tool, persist
//      the tool result, re-send to Claude for the next turn
//   5. Persists the final assistant message
//   6. Returns { conversationId, assistantText, createdWorkOrders[] }
//
// Body: { conversationId?: uuid, message: string }
// Response: { conversationId, assistantText, createdWorkOrders }

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createMessage } from '../services/anthropic.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { logger } from '../logger.js';
import {
  toolDefinitionsForClaude,
  dispatchTool,
} from '../tools/index.js';

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 20; // last N messages of context per turn

export const chatRouter = Router();

function buildSystemPrompt({ profile }) {
  return [
    'You are Delta — Cold Cargo\'s maintenance assistant for the Laredo, TX shop.',
    '',
    `User: ${profile.fullName}, role=${profile.role}.`,
    '',
    'Your job: turn what users describe into structured work orders. You',
    'have tools to look up assets, query pending work, read meter values,',
    'create work orders, and undo a recent work order.',
    '',
    'Rules:',
    '- Asset references like "CC07", "T05", "BF1701" are unit_number values.',
    '  When in doubt, call list_assets with a substring to confirm.',
    '- Whenever a tech describes work they DID (oil change, repair, inspection,',
    '  PM), call create_work_order immediately. Do not ask "should I log this?"',
    '  — log it, then echo the confirmation.',
    '- After create_work_order returns, include the `confirmation` field',
    '  verbatim in your final reply.',
    '- When a tech reports a PROBLEM that hasn\'t been fixed yet, log it with',
    '  type="issue" (status defaults to open).',
    '- If the user says "undo", "scratch that", or "wrong truck" right after',
    '  a work order was logged, call void_work_order with the short_id from',
    '  the previous confirmation.',
    '- All work orders land in approval_status="pending_review" until an admin',
    '  signs off. Tell the user this is normal; they don\'t need to do anything.',
    '- Be brief. One short paragraph per turn unless the user asks for detail.',
    '- Never invent unit numbers. If a unit doesn\'t exist, say so and offer',
    '  the closest matches from list_assets.',
  ].join('\n');
}

async function loadOrCreateConversation({ admin, userId, conversationId }) {
  if (conversationId) {
    const { data, error } = await admin
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && data.user_id === userId) return data.id;
  }
  const { data, error } = await admin
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function loadHistory({ admin, conversationId, limit = HISTORY_LIMIT }) {
  const { data, error } = await admin
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  // Convert stored {role, content} rows back into Anthropic message format.
  return data.map((m) => ({ role: m.role, content: m.content }));
}

async function persistMessage({ admin, conversationId, role, content, toolCalls, workOrderId }) {
  const { error } = await admin.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
    tool_calls: toolCalls ?? null,
    related_work_order_id: workOrderId ?? null,
  });
  if (error) throw new Error(error.message);
  // Bump last_message_at for ordering.
  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}

chatRouter.post('/api/chat', requireAuth, async (req, res) => {
  const { message, conversationId: incomingConvoId } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message_required' });
  }

  const admin = getSupabaseAdmin();
  const conversationId = await loadOrCreateConversation({
    admin,
    userId: req.user.id,
    conversationId: incomingConvoId,
  });

  // Persist the user's message before anything else — never lose input.
  const userContent = [{ type: 'text', text: message }];
  await persistMessage({
    admin,
    conversationId,
    role: 'user',
    content: userContent,
  });

  // Build Anthropic message list from history.
  const history = await loadHistory({ admin, conversationId });

  const tools = toolDefinitionsForClaude(req.user.role);
  const system = buildSystemPrompt({ profile: req.user });
  const ctx = {
    user: { id: req.user.id, role: req.user.role, fullName: req.user.fullName },
    admin,
    conversationId,
    logger,
  };

  const createdWorkOrders = [];
  let assistantText = '';
  let messages = history;

  // Tool-use loop.
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res1 = await createMessage({ system, messages, tools });

    // Persist what Claude returned (assistant message — possibly with tool_use blocks).
    const assistantContent = res1.content;
    await persistMessage({
      admin,
      conversationId,
      role: 'assistant',
      content: assistantContent,
      toolCalls: assistantContent.filter((c) => c.type === 'tool_use'),
    });

    // Append to in-memory history for the next iteration.
    messages = [...messages, { role: 'assistant', content: assistantContent }];

    const toolUses = assistantContent.filter((c) => c.type === 'tool_use');
    const textBlocks = assistantContent.filter((c) => c.type === 'text');
    assistantText = textBlocks.map((b) => b.text).join('\n');

    if (res1.stop_reason !== 'tool_use' || toolUses.length === 0) {
      break; // model is done
    }

    // Execute each tool call and persist results as a 'user' message
    // containing tool_result blocks (Anthropic's required format).
    const toolResults = [];
    for (const tu of toolUses) {
      const t0 = Date.now();
      const result = await dispatchTool({ name: tu.name, input: tu.input, ctx });
      const ms = Date.now() - t0;
      logger.info(
        { tool: tu.name, ok: result.ok, ms, userId: req.user.id },
        'chat: tool dispatched',
      );
      if (result.ok && result.work_order) {
        createdWorkOrders.push(result.work_order);
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    const toolResultMessage = { role: 'user', content: toolResults };
    await persistMessage({
      admin,
      conversationId,
      role: 'tool',
      content: toolResults,
      workOrderId: createdWorkOrders[createdWorkOrders.length - 1]?.id ?? null,
    });
    messages = [...messages, toolResultMessage];
  }

  res.json({
    conversationId,
    assistantText,
    createdWorkOrders,
  });
});
