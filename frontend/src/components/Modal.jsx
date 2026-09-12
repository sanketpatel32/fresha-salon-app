import React, { useEffect, useRef, useCallback } from 'react';
import './Modal.css';

/**
 * Accessible modal dialog.
 *
 * Provides: role="dialog", aria-modal="true", focus trap (Tab cycles within),
 * Escape-to-close, click-on-backdrop-to-close, and focus restoration to the
 * element that had focus before the modal opened.
 *
 * Refactor target: the 5 existing modal instances in App.jsx (review writer,
 * assign services, staff note x2, blockout) should use this instead of the
 * bare modal-backdrop/modal-content divs.
 */
export default function Modal({ open, onClose, title, labelledById, children, size = 'md' }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  // Focus the dialog (or first focusable) on open; restore focus on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;

    const node = dialogRef.current;
    if (node) {
      // Focus the first focusable child, else the dialog itself.
      const focusable = node.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        node.focus();
      }
    }

    return () => {
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [open]);

  // Escape to close.
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Focus trap: keep Tab within the dialog.
      if (e.key === 'Tab') {
        const node = dialogRef.current;
        if (!node) return;
        const focusable = node.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  const headingId = labelledById || 'modal-title';

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // Close only on direct backdrop click, not clicks inside the content.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal-content modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <h3 id={headingId} className="panel-title">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
