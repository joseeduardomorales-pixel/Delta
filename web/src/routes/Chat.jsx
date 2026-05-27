// Delta — chat surface (v2, restrained).
// Tech-facing primary UI. New palette + type + primitives, NO
// decorative motion — speed and density matter more than flourish.

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { Header, useToast } from '../components/ui/index.js';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';

export default function Chat() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState(null);

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
          text: data.assistantText || '(no reply)',
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

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={profile?.role === 'admin' ? 'Chat · admin view' : 'Chat'}
        sticky
      />
      <MessageList messages={messages} pending={pending} />
      <MessageInput
        onSend={handleSend}
        disabled={pending}
        accessToken={session.access_token}
      />
    </div>
  );
}
