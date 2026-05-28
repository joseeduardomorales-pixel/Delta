// Delta — chat surface (v2, restrained).
// Tech-facing primary UI. New palette + type + primitives, NO
// decorative motion — speed and density matter more than flourish.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { Header, useToast } from '../components/ui/index.js';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';
import ReportIssueButton from '../components/ReportIssueButton.jsx';
import ResumeInspectionsBanner from '../components/ResumeInspectionsBanner.jsx';

export default function Chat() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  // On mount, hydrate the chat from the user's latest server-side
  // conversation. Without this, navigating to /assets/foo and back via
  // the Δ logo would land you in an empty chat even though the DB
  // already has your history.
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/conversations/latest`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        if (data.conversationId) setConversationId(data.conversationId);
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(() => {
        // Silent — empty chat shell is fine if the load fails.
      });
    return () => {
      alive = false;
    };
  }, [session.access_token]);

  async function handleSend({ text, attachments }) {
    const photoNote =
      attachments?.length > 0
        ? ` (📎 ${attachments.length})`
        : '';
    setMessages((m) => [
      ...m,
      { role: 'user', text: (text || '(photo only)') + photoNote },
    ]);
    setPending(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          conversationId,
          message: text || 'See attached photo(s).',
          attachments,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            text: `Delta couldn't process that (${res.status}).`,
            error: true,
          },
        ]);
        pushToast({
          tone: 'danger',
          title: 'API error',
          text: `${res.status} ${body.slice(0, 120) || ''}`,
        });
        return;
      }

      const data = await res.json();
      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
      }
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          // If the server returned empty assistantText, Claude was silent
          // AND no tool confirmation existed to fall back on. Tell the
          // user honestly instead of pretending nothing happened.
          text:
            data.assistantText ||
            "Delta didn't answer that one. Try rephrasing — if this keeps happening, tell Lalo.",
          workOrders: data.createdWorkOrders || [],
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'system',
          text: "Network problem. Your message wasn't sent.",
          error: true,
        },
      ]);
      pushToast({ tone: 'danger', title: 'Network problem', text: e.message });
    } finally {
      setPending(false);
    }
  }

  function onIssueSubmitted(wo) {
    // Surface the new issue in the chat thread as a system message so
    // there's a visible trail without polluting the conversation.
    setMessages((m) => [
      ...m,
      {
        role: 'system',
        text: `Issue logged: WO-${wo.short_id} on ${wo.asset_unit_number}.`,
      },
    ]);
  }

  return (
    // dvh = dynamic viewport height. On mobile browsers, 100vh includes
    // the URL/tab bar area which pushes the input off-screen. 100dvh
    // tracks the visible area so the input is always reachable.
    <div className="flex flex-col h-[100dvh] bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={profile?.role === 'admin' ? 'Chat · admin view' : 'Chat'}
        sticky
      />
      {/* In-progress inspections — renders nothing if there are none. */}
      <ResumeInspectionsBanner />
      {/* Quick-actions row — primary non-chat entry point */}
      <div className="border-b border-border bg-card/50 px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Quick actions
        </p>
        <ReportIssueButton onSubmitted={onIssueSubmitted} variant="compact" />
      </div>
      <MessageList messages={messages} pending={pending} />
      <MessageInput
        onSend={handleSend}
        disabled={pending}
        accessToken={session.access_token}
      />
    </div>
  );
}
