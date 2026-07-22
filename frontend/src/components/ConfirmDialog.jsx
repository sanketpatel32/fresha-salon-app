import React from 'react';
import Modal from './Modal';

/**
 * Reusable confirmation dialog — replaces the blocking native confirm().
 *
 * Usage: hold the pending confirmation in state, render this when set.
 *
 *   const [confirm, setConfirm] = useState(null);
 *   ...
 *   <ConfirmDialog
 *     open={!!confirm}
 *     title={confirm?.title}
 *     message={confirm?.message}
 *     confirmLabel={confirm?.confirmLabel || 'Confirm'}
 *     danger={confirm?.danger}
 *     onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
 *     onClose={() => setConfirm(null)}
 *   />
 */
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      {message && (
        <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-lg)' }}>
          {message}
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm">
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
