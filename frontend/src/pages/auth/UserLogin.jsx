import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import './auth.css';

/* User (Customer) Login */
export default function UserLogin() {
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
      const res = await axios.post('/api/user/login', { email, password });
      handleLogin(res.data.token, 'customer', res.data.userId);
      navigate('/customer/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to sign in';
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
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">Sign in to your customer account</p>
        </div>
        {error && (
          <div id="user-login-error" className="form-alert form-alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="user-login-email" className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input
                id="user-login-email"
                type="email"
                autoComplete="email"
                required
                className="form-input"
                placeholder="you@example.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'user-login-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="user-login-password" className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="user-login-password"
                type="password"
                autoComplete="current-password"
                minLength={6}
                required
                className="form-input"
                placeholder="••••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'user-login-error' : undefined}
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
          Don't have an account? <Link to="/user/signup" className="form-link">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
