// Delta — single-screen chat surface. Tech-facing primary UI.

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';
import { Link } from 'react-router-dom';

export default function Chat() {
  const { session, profile, signOut } = useAuth();
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [bannerError, setBannerError] = useState(null);

  async function handleSend({ text, attachments }) {
    // Append the user's message immediately (optimistic).
    const photoNote =
      attachments?.length > 0
        ? ` (📎 ${attachments.length} photo${attachments.length === 1 ? '' : 's'})`
        : '';
    setMessages((m) => [
      ...m,
      { role: 'user', text: (text || '(photo only)') + photoNote },
    ]);
    setPending(true);
    setBannerError(null);

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
            text: `Delta couldn't process that (HTTP ${res.status}). Try again.`,
            error: true,
          },
        ]);
        setBannerError(`API error: ${res.status} ${body.slice(0, 120)}`);
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
          text: 'Network problem. Your message wasn\'t sent.',
          error: true,
        },
      ]);
      setBannerError(e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-matrix-black text-matrix-fg font-mono">
      <header className="flex items-center justify-between px-3 py-2 border-b border-matrix-green-line">
        <div>
          <h1 className="text-base text-matrix-green tracking-tight">Delta</h1>
          <p className="text-[10px] text-matrix-fg-muted">
            {profile?.fullName} · {profile?.role}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {profile?.role === 'admin' && (
            <Link
              to="/admin/work-orders/pending"
              className="text-[10px] uppercase tracking-widest text-matrix-fg-dim hover:text-matrix-green px-2 py-1 border border-matrix-green-line rounded"
            >
              Review queue
            </Link>
          )}
          <button
            type="button"
            onClick={signOut}
            className="text-[10px] uppercase tracking-widest text-matrix-fg-dim hover:text-matrix-green px-2 py-1 border border-matrix-green-line rounded"
          >
            Sign out
          </button>
        </div>
      </header>

      {bannerError && (
        <div className="bg-matrix-red/10 border-b border-matrix-red/40 text-matrix-red text-xs px-3 py-1">
          {bannerError}
        </div>
      )}

      <MessageList messages={messages} pending={pending} />

      <MessageInput
        onSend={handleSend}
        disabled={pending}
        accessToken={session.access_token}
      />
    </div>
  );
}
