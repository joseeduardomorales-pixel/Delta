// Delta — Modal primitive (v2).
// Centered, max-w-md, focus trap, ESC to close (unless `destructive`
// is set — destructive requires explicit Cancel click).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.jsx';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  destructive = false,
  maxWidth = 'md', // sm | md | lg
  className,
}) {
  const dialogRef = useRef(null);

  // ESC handler (skipped if destructive)
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape' && !destructive) onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, destructive, onClose]);

  // Lightweight focus trap: focus the dialog when it opens.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const widthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }[maxWidth];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close"
            onClick={destructive ? undefined : onClose}
            className={cn(
              'absolute inset-0 bg-foreground/40 backdrop-blur-sm',
              destructive ? 'cursor-default' : 'cursor-pointer',
            )}
            tabIndex={-1}
          />
          {/* Dialog */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'relative w-full bg-card border border-border rounded-2xl shadow-xl',
              widthClass,
              className,
            )}
          >
            {/* Header */}
            {(title || !destructive) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                <div className="flex-1 min-w-0">
                  {title && (
                    <h2 id="modal-title" className="text-lg font-semibold leading-snug">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {description}
                    </p>
                  )}
                </div>
                {!destructive && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="-m-2 p-2 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            {/* Body */}
            <div className="px-6 pb-5">{children}</div>
            {/* Footer */}
            {footer && (
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Convenience: pair of Cancel + Action buttons for the footer slot. */
export function ModalActions({ onCancel, cancelLabel = 'Cancel', children }) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      {children}
    </>
  );
}
