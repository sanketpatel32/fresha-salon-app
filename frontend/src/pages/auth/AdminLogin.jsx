import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { User, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import './auth.css';

/* Admin Login Component */
export default function AdminLogin() {
  const { handleLogin } = useAuth();
  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/api/admin/login', { email, password });
      handleLogin(res.data.token, 'admin', 'system_admin');
      navigate('/admin/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || 'Invalid credentials';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Admin Console</h2>
          <p className="auth-subtitle">Sign in with your administrator credentials</p>
        </div>
        {error && (
          <div id="admin-login-error" className="form-alert form-alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-login-username" className="form-label">Admin Username</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input
                id="admin-login-username"
                type="text"
                autoComplete="username"
                required
                className="form-input"
                placeholder="admin_id"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'admin-login-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="admin-login-password" className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="admin-login-password"
                type="password"
                autoComplete="current-password"
                required
                className="form-input"
                placeholder="••••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'admin-login-error' : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-block">
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>
        <div className="form-footer">
          Looking to book instead? <Link to="/user/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
