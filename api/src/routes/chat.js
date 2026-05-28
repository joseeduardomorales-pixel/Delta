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
import { attachStagingToWorkOrder, signedReadUrl } from '../services/storage.js';
import { logger } from '../logger.js';
import {
  toolDefinitionsForClaude,
  dispatchTool,
} from '../tools/index.js';

// How long a signed image URL stays valid when passed to Claude as an
// image content block. Claude fetches it server-side once on receipt;
// 5 minutes gives plenty of headroom.
const IMAGE_URL_TTL_S = 300;

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 20; // last N messages of context per turn

export const chatRouter = Router();

function buildSystemPrompt({ profile }) {
  return [
    "You are Delta — Cold Cargo's maintenance assistant for the Laredo, TX shop.",
    '',
    `User: ${profile.fullName}, role=${profile.role}.`,
    '',
    'Domain model (READ CAREFULLY — this is new):',
    '- ISSUES are problems reported on an asset. They are NOT work orders.',
    '  A tech later opens a WO on the asset and addresses the issue as one',
    '  of its items.',
    '- WORK ORDERS are sessions a tech opens on a specific asset. A WO has',
    '  an opening meter reading (miles for trucks, hours for reefer units)',
    '  and one or more line ITEMS. The WO is closed when the tech is done.',
    '- ITEMS link UPSTREAM to an issue, a PM schedule, a campaign assignment,',
    '  or are "ad_hoc" (free-form work).',
    '',
    'How to choose a tool — DECISION TREE:',
    '',
    '1. User reports a PROBLEM not yet fixed ("CC07 has a coolant leak",',
    '   "brake light is out") → call report_issue.',
    '',
    '2. User narrates work they JUST DID in past tense ("I changed the oil",',
    '   "replaced the brake pads", "fixed the leak") → call log_completed_work.',
    '   This is the FAST PATH: opens + adds item(s) + completes + closes in one shot.',
    '',
    '   MULTI-ACTION RULE — read carefully:',
    '   - If the tech narrates 2+ completed actions on the SAME asset in one',
    '     message ("fixed leak, greased fifth wheel, topped oil on CC09"),',
    '     make ONE log_completed_work call with items: [...]. Each entry has',
    '     its own type/title/description. Do NOT call the tool multiple',
    '     times for the same asset — that creates duplicate WOs.',
    '   - If the same message ALSO mentions a pending problem ("still need',
    '     to check the steering jiggle next time"), make a SEPARATE',
    '     report_issue call AFTER log_completed_work returns. Pending work',
    '     never goes into items[] — items[] is completed work only.',
    '   - Same asset, multiple messages? Each message is its own WO. Don\'t',
    '     try to merge across turns.',
    '',
    '3. User wants to START a work session on an asset ("open a WO on CC07",',
    '   "start working on T05") → call open_work_order. Then optionally',
    '   call query_pending_for_asset to show issues / due PMs / campaigns,',
    '   then add_item_to_work_order for each thing chosen, complete_item as',
    '   each finishes, close_work_order at the end.',
    '',
    '4. User says "undo", "scratch that", "wrong truck" right after a WO',
    '   → call void_work_order with NO arguments (defaults to the most',
    '   recent WO within the 5-min grace).',
    '',
    '5. User says "start a reefer inspection on T05" or "do an inspection",',
    '   → call start_inspection. It opens (or reuses) a WO on the asset and',
    '   materializes the checklist. Tell the user to open the returned URL',
    '   to walk through the items.',
    '',
    'CRITICAL — METER READINGS:',
    '- Every WO needs an opening meter. Trucks → miles, reefers → hours.',
    '- open_work_order and log_completed_work check telematics first.',
    '- If telematics is stale (>24h old), the tool returns',
    '  { needs_meter: true, meter_unit, last_known: { value, recorded_human } }.',
    '  When you see this:',
    '   a. Ask the user "What\'s the current odometer/hour meter on {unit}?"',
    '      You MAY mention the last_known.value and last_known.recorded_human',
    '      for context (e.g. "last reading was 277,242 mi from yesterday").',
    '   b. When they reply, re-call the SAME tool with the same arguments',
    '      PLUS manual_meter_value set to the number they gave.',
    '- Never invent a meter value. Always ask.',
    '- DATES: Never compute relative time ("a month ago", "last week") from',
    '  an ISO timestamp yourself — you are bad at it and will hallucinate.',
    '  Always echo the pre-computed `recorded_human` field verbatim. If it',
    '  says "yesterday", you say "yesterday". If it says "3 hours ago", you',
    '  say "3 hours ago". Do not paraphrase, do not re-estimate.',
    '',
    'VOCABULARY — "trailer" is a superset:',
    '- Cold Cargo splits towable assets into two database types:',
    '    * `reefer`  → refrigerated trailer (has a refrigeration unit on it)',
    '    * `trailer` → dry van (no refrigeration)',
    '- When the operator says "trailer" / "trailers" with no qualifier, they',
    '  mean BOTH types. Do NOT call list_assets with type="trailer" — that',
    '  filters out reefers. Either omit the `type` arg and post-filter to',
    '  type IN (reefer, trailer), or call list_assets twice (once per type).',
    '- "Reefer" or "refrigerated trailer" = type="reefer" only.',
    '- "Dry van" or "dry trailer" = type="trailer" only.',
    '- "Refrigeration unit" / "reefer unit" = the Carrier/Thermo King cooling',
    '  box bolted onto a reefer trailer. It is NOT a separate asset — its',
    '  hours, serial, and PM cadence live on the reefer asset record.',
    '- Always answer in the operator\'s words. Say "trailer" or "reefer";',
    '  never expose the schema ("type=reefer", "asset of type reefer").',
    '',
    'Other rules:',
    '- Asset references like "CC07", "T05", "BF1701" are unit_number values.',
    '  When in doubt, call list_assets with a substring to confirm.',
    '- Dispatchers can ONLY report issues. If a dispatcher tries to log work',
    '  or open a WO, the tool will refuse — tell them that politely.',
    '- NEVER end a turn silent after a tool call. After EVERY tool you call,',
    '  you MUST output at least one text block in the same turn or the next',
    '  describing what happened. The user reads YOUR text, not the raw tool',
    '  result. A silent end_turn = the user sees nothing = bug.',
    '- ALWAYS include the tool\'s `confirmation` field verbatim in your reply',
    '  so the user can verify and undo if needed.',
    '- All WOs land approval_status="pending_review" until admin signs off.',
    '  Tell the user this is normal — they don\'t need to do anything.',
    '- Be brief. One short paragraph per turn unless the user asks for detail.',
    '- Never invent unit numbers. If a unit doesn\'t exist, say so and offer',
    '  the closest matches from list_assets.',
    '',
    'Photos:',
    '- When the user attaches photos, you see them as image blocks alongside',
    '  the text. Use what you see to inform the issue or work item — read',
    '  panel labels, identify the failure (leak, broken latch, damaged tire,',
    '  loose hose, etc.), and include that detail in `description`. Always',
    '  still ask for / confirm the unit number from the user; never infer',
    '  it from a photo.',
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

// Image blocks from prior turns have signed URLs that expire after 5
// minutes. Strip them on replay so we don't send a 403'd URL to Claude.
// Claude can still reason about "the photo you uploaded earlier" via
// the description it generated at the time.
function stripExpiredImages(content) {
  if (!Array.isArray(content)) return content;
  let imageCount = 0;
  const cleaned = content
    .map((block) => {
      if (block?.type === 'image') {
        imageCount += 1;
        return null;
      }
      return block;
    })
    .filter(Boolean);
  if (imageCount > 0) {
    cleaned.push({
      type: 'text',
      text: `[${imageCount} photo${imageCount === 1 ? '' : 's'} attached in this earlier turn]`,
    });
  }
  return cleaned;
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
  // - role='tool' rows must be remapped to 'user' (tool_result blocks
  //   only ride inside user messages per Anthropic's spec).
  // - image blocks from old turns get stripped because their signed URLs
  //   have expired.
  // - Empty content rows (content=[] or null) are SKIPPED. These exist in
  //   historical data from before the poison-guard fix; including them
  //   re-poisons the conversation. The poison-guard now prevents new ones
  //   from being written.
  return data
    .filter(
      (m) =>
        m.content &&
        Array.isArray(m.content) &&
        m.content.length > 0,
    )
    .map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content: stripExpiredImages(m.content),
    }));
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

// GET /api/conversations/latest
// Returns the caller's most recent conversation + a flattened view of its
// messages for the chat UI. If the user has no conversations yet, returns
// { conversationId: null, messages: [] } so the UI can show its empty state.
chatRouter.get('/api/conversations/latest', requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: convo } = await admin
      .from('conversations')
      .select('id, last_message_at')
      .eq('user_id', req.user.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!convo) {
      return res.json({ conversationId: null, messages: [] });
    }
    const { data: rows, error } = await admin
      .from('messages')
      .select('role, content, created_at, related_work_order_id')
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT * 2);
    if (error) throw new Error(error.message);

    // Flatten the stored Anthropic-format content blocks into a {role, text,
    // workOrders?} shape the chat UI expects. Skip tool_use / tool_result
    // rows that don't have user-visible text — the UI only renders user
    // and assistant text. Image blocks become a "[photo]" placeholder
    // since we don't replay signed URLs here.
    const messages = [];
    for (const m of rows || []) {
      // role='tool' rows are tool_result-only — skip in the UI
      if (m.role === 'tool') continue;
      const blocks = Array.isArray(m.content) ? m.content : [];
      const textParts = [];
      let imageCount = 0;
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text);
        } else if (b?.type === 'image') {
          imageCount += 1;
        }
        // tool_use and tool_result blocks aren't shown
      }
      const text = textParts.join('\n').trim();
      if (!text && imageCount === 0) continue;
      messages.push({
        role: m.role,
        text: text + (imageCount > 0 ? ` (📎 ${imageCount})` : ''),
      });
    }

    res.json({ conversationId: convo.id, messages });
  } catch (e) {
    logger.error({ err: e.message }, 'GET /api/conversations/latest: failed');
    res.status(500).json({ error: 'load_failed' });
  }
});

chatRouter.post('/api/chat', requireAuth, async (req, res) => {
  try {
    await handleChat(req, res);
  } catch (e) {
    logger.error(
      { err: e.message, stack: e.stack, userId: req.user?.id },
      'chat: unhandled error',
    );
    if (!res.headersSent) {
      res.status(500).json({ error: 'chat_failed', detail: e.message });
    }
  }
});

async function handleChat(req, res) {
  const {
    message,
    conversationId: incomingConvoId,
    attachments, // [{ staging_path, mimetype, size }]
  } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message_required' });
  }
  const attachmentList = Array.isArray(attachments) ? attachments : [];

  const admin = getSupabaseAdmin();
  const conversationId = await loadOrCreateConversation({
    admin,
    userId: req.user.id,
    conversationId: incomingConvoId,
  });

  // Persist the user's message before anything else — never lose input.
  // For attachments, build Claude image blocks via short-lived signed URLs.
  // Storage is RLS-private, so URLs must be signed to be fetchable by
  // Anthropic's server.
  const userContent = [{ type: 'text', text: message }];
  for (const a of attachmentList) {
    try {
      const url = await signedReadUrl(a.staging_path, IMAGE_URL_TTL_S);
      userContent.push({ type: 'image', source: { type: 'url', url } });
    } catch (e) {
      logger.warn(
        { err: e.message, path: a.staging_path },
        'chat: failed to sign image URL — attaching as text reference instead',
      );
      userContent.push({
        type: 'text',
        text: `[photo attached but unreadable: ${a.staging_path.split('/').pop()}]`,
      });
    }
  }
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
  // Captures the `confirmation` string from each tool execution. We use
  // these as a safety net when Claude finishes the turn silent after a
  // tool call (model returns end_turn with zero text blocks). Without
  // this, the client would render "(no reply)" even though the tool
  // succeeded and the data is in the DB.
  const toolConfirmations = [];
  let assistantText = '';
  let messages = history;

  // Tool-use loop.
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res1 = await createMessage({ system, messages, tools });

    const assistantContent = res1.content;

    // POISON GUARD: occasionally Anthropic returns end_turn with zero
    // content blocks (model anomaly). If we persist that empty array,
    // every subsequent turn loads it back and Anthropic responds with
    // another empty — the conversation cascades into silence. Skip the
    // persist + break out. The safety net (toolConfirmations) below
    // will still surface anything useful from earlier iterations.
    if (!Array.isArray(assistantContent) || assistantContent.length === 0) {
      logger.warn(
        {
          userId: req.user.id,
          conversationId,
          iteration: i,
          stopReason: res1.stop_reason,
        },
        'chat: model returned empty content — skipping persist to avoid history poison',
      );
      break;
    }

    // Persist what Claude returned (assistant message — possibly with tool_use blocks).
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
      if (typeof result?.confirmation === 'string' && result.confirmation.trim()) {
        toolConfirmations.push(result.confirmation.trim());
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

  // After the tool-use loop: if attachments were sent AND we created at
  // least one work_order, link the photos to the FIRST created WO.
  // (Future: let Claude assign each photo to a specific WO via a tool.)
  const attachedPhotos = [];
  if (attachmentList.length > 0 && createdWorkOrders.length > 0) {
    const targetWoId = createdWorkOrders[0].id;
    for (const a of attachmentList) {
      try {
        const photo = await attachStagingToWorkOrder({
          stagingPath: a.staging_path,
          workOrderId: targetWoId,
          uploadedBy: req.user.id,
        });
        attachedPhotos.push({ id: photo.id, storage_path: photo.storage_path });
      } catch (e) {
        logger.warn(
          { err: e.message, staging_path: a.staging_path },
          'chat: failed to attach staging photo to WO',
        );
      }
    }
  }

  // Safety net: if Claude ended the conversation silent after a tool
  // call (no text blocks in the final turn), echo the tool confirmations
  // back to the user. Otherwise the client would render "(no reply)"
  // even though the tool succeeded and the data is in the DB.
  if (!assistantText.trim() && toolConfirmations.length > 0) {
    assistantText = toolConfirmations.join('\n\n');
    logger.warn(
      {
        userId: req.user.id,
        toolCount: toolConfirmations.length,
      },
      'chat: model silent after tool call — falling back to confirmations',
    );
  }

  res.json({
    conversationId,
    assistantText,
    createdWorkOrders,
    attachedPhotos,
  });
}
