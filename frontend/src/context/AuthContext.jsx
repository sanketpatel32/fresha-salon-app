import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from './ToastContext.jsx';

const AuthContext = createContext(null);

const AUTH_EXPIRED_EVENT = 'fresha:auth-expired';

/**
 * Provides userSession, handleLogin, handleLogout to all descendants.
 *
 * Must be rendered INSIDE <BrowserRouter> because the auth-expiry handler
 * uses useNavigate() to redirect to the role-appropriate login without a
 * full page reload.
 */
export function AuthProvider({ children }) {
  const [userSession, setUserSession] = useState({
    token: localStorage.getItem('token') || '',
    role: localStorage.getItem('role') || '',
    id: localStorage.getItem('userId') || localStorage.getItem('salonId') || localStorage.getItem('staffId') || '',
  });
  const navigate = useNavigate();
  const showToast = useToast();

  // Attach the Authorization header on every request when logged in.
  useEffect(() => {
    if (userSession.token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${userSession.token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [userSession.token]);

  // Listen for auth-expiry events from the axios interceptor and redirect
  // via React Router (no hard reload).
  useEffect(() => {
    const handler = () => {
      const role = localStorage.getItem('role') || '';
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('userId');
      localStorage.removeItem('salonId');
      localStorage.removeItem('staffId');
      setUserSession({ token: '', role: '', id: '' });
      showToast('Your session has expired. Please sign in again.', 'error');
      const loginPath =
        role === 'salon' ? '/buisness/login'
        : role === 'staff' ? '/staff/login'
        : role === 'admin' ? '/admin/login'
        : '/user/login';
      navigate(loginPath);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  }, [navigate, showToast]);

  const handleLogin = (token, role, id) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    if (role === 'customer') localStorage.setItem('userId', id);
    else if (role === 'salon') localStorage.setItem('salonId', id);
    else if (role === 'staff') localStorage.setItem('staffId', id);
    setUserSession({ token, role, id });
    showToast(`Logged in successfully as ${role}!`, 'success');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('salonId');
    localStorage.removeItem('staffId');
    setUserSession({ token: '', role: '', id: '' });
    showToast('Logged out successfully.', 'success');
  };

  return (
    <AuthContext.Provider value={{ userSession, handleLogin, handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Exported so the axios interceptor (set up in App.jsx) dispatches the right event.
export { AUTH_EXPIRED_EVENT };
