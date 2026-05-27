// Delta — Toast primitive (v2).
// Top-right on desktop, bottom-center on mobile. Auto-dismiss 3s for
// success; sticky for warning/danger until manually closed.
//
// Exposes a React context + useToast() hook so any consumer can fire
// toasts with one call: const { push } = useToast(); push({tone:'success', text:'…'});

import { createContext, useCallback, useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const ToastCtx = createContext(null);

const TONE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
};

const TONE_BORDER = {
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
  info: 'border-l-info',
};

const TONE_ICON_COLOR = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ tone = 'info', title, text, ttl }) => {
      const id = ++_id;
      const sticky = tone === 'warning' || tone === 'danger';
      const lifetime = ttl ?? (sticky ? null : 3000);
      setToasts((curr) => [...curr, { id, tone, title, text }]);
      if (lifetime != null) {
        setTimeout(() => dismiss(id), lifetime);
      }
      return id;
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastViewport({ toasts, dismiss }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed z-50 pointer-events-none inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3 sm:bottom-auto sm:top-3 sm:right-3 sm:left-auto sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'pointer-events-auto w-full sm:w-auto sm:min-w-[280px] sm:max-w-sm',
                'flex items-start gap-3 rounded-xl bg-card shadow-lg border border-border',
                'border-l-4',
                TONE_BORDER[t.tone],
                'px-4 py-3',
              )}
              role="status"
            >
              <Icon size={18} className={cn('mt-0.5 shrink-0', TONE_ICON_COLOR[t.tone])} />
              <div className="flex-1 min-w-0 text-sm">
                {t.title && <p className="font-semibold leading-snug">{t.title}</p>}
                {t.text && (
                  <p className={cn('leading-snug', t.title && 'mt-0.5 text-muted-foreground')}>
                    {t.text}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 -m-1 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
