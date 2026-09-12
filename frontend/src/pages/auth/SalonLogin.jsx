import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import './auth.css';

/* Salon Login */
export default function SalonLogin() {
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
      const res = await axios.post('/api/buisness/login', { email, password });
      handleLogin(res.data.token, 'salon', res.data.salonId);
      navigate('/salon/dashboard');
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
          <h2 className="auth-title">Partner Login</h2>
          <p className="auth-subtitle">Sign in to manage your salon business</p>
        </div>
        {error && (
          <div id="salon-login-error" className="form-alert form-alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="salon-login-email" className="form-label">Business Email</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input
                id="salon-login-email"
                type="email"
                autoComplete="email"
                required
                className="form-input"
                placeholder="business@salon.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'salon-login-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="salon-login-password" className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="salon-login-password"
                type="password"
                autoComplete="current-password"
                minLength={6}
                required
                className="form-input"
                placeholder="••••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'salon-login-error' : undefined}
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
          Want to partner with us? <Link to="/buisness/signup" className="form-link">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
