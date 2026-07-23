import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/* Salon Login */
export default function SalonLogin() {
  const { handleLogin } = useAuth();
  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/buisness/login', { email, password });
      handleLogin(res.data.token, 'salon', res.data.salonId);
      navigate('/salon/dashboard');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to login', 'error');
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
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-accent" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Logging in...' : 'Sign In as Partner'}
          </button>
        </form>
        <div className="form-footer">
          Want to partner with us? <Link to="/buisness/signup" className="form-link">Register Salon</Link>
        </div>
      </div>
    </div>
  );
}
