import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { User, Mail, Phone, Lock } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import './auth.css';

/* User (Customer) Signup */
export default function UserSignup() {
  const showToast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axios.post('/api/user/signup', { name, email, password, phoneNumber });
      showToast('Signup successful! Please sign in.', 'success');
      navigate('/user/login');
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to sign up';
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
          <h2 className="auth-title">Create Account</h2>
          <p className="auth-subtitle">Register a new customer account</p>
        </div>
        {error && (
          <div id="user-signup-error" className="form-alert form-alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="signup-name" className="form-label">Full Name</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input
                id="signup-name"
                type="text"
                autoComplete="name"
                required
                className="form-input"
                placeholder="John Doe"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="signup-email" className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                className="form-input"
                placeholder="john@example.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'user-signup-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="signup-phone" className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input
                id="signup-phone"
                type="tel"
                pattern="[0-9]{10}"
                title="Enter a 10-digit phone number"
                autoComplete="tel"
                required
                className="form-input"
                placeholder="9876543210"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="signup-password" className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                title="At least 8 characters"
                required
                className="form-input"
                placeholder="••••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'user-signup-error' : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-block">
            {loading ? 'Signing Up…' : 'Sign Up'}
          </button>
        </form>
        <div className="form-footer">
          Already have an account? <Link to="/user/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
