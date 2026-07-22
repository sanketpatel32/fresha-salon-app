import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { User, Mail, Phone, Lock } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';

/* User (Customer) Signup */
export default function UserSignup() {
  const showToast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/user/signup', { name, email, password, phoneNumber });
      showToast('Signup successful! Please sign in.', 'success');
      navigate('/user/login');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to sign up', 'error');
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
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="signup-name" className="form-label">Full Name</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input
                id="signup-name"
                type="text"
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
                required
                className="form-input"
                placeholder="john@example.com"
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
                minLength={8}
                title="At least 8 characters"
                required
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
        <div className="form-footer">
          Already have an account? <Link to="/user/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
