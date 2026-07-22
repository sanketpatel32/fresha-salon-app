import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

const ToastContext = createContext(null);

/**
 * Provides showToast() to any descendant, and renders the single toast.
 * Consumed by every page component via useToast().
 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && <ToastView message={toast.message} type={toast.type} onClose={dismiss} />}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.showToast;
}

function ToastView({ message, type, onClose }) {
  // Auto-dismiss after 4s. Previously this used useState() as if it were
  // useEffect() — the timer fired once but the cleanup was never wired up by
  // React, so a re-render before 4s could leak a stale timer.
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const isSuccess = type === 'success';
  const isError = type === 'error';
  return (
    <div className={`toast ${isSuccess ? 'toast-success' : isError ? 'toast-error' : ''}`}>
      {isSuccess && <CheckCircle size={20} className="text-success" />}
      {isError && <AlertCircle size={20} className="text-danger" />}
      <span>{message}</span>
    </div>
  );
}
