import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Scissors, Mail, Phone, MapPin, CreditCard, Lock } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import './auth.css';

/* Salon Signup */
export default function SalonSignup() {
  const showToast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [pricing, setPricing] = useState('Premium');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axios.post('/api/buisness/signup', { name, email, password, phoneNumber, address, pricing });
      showToast('Salon registered successfully! Please sign in.', 'success');
      navigate('/buisness/login');
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to register salon';
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
          <h2 className="auth-title">Register Your Salon</h2>
          <p className="auth-subtitle">Register your business to start accepting bookings</p>
        </div>
        {error && (
          <div id="salon-signup-error" className="form-alert form-alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="salon-name" className="form-label">Salon Name</label>
            <div className="form-input-wrapper">
              <Scissors className="form-input-icon" size={18} />
              <input
                id="salon-name"
                type="text"
                autoComplete="organization"
                required
                className="form-input"
                placeholder="Glow Hair & Spa"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="salon-email" className="form-label">Business Email</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input
                id="salon-email"
                type="email"
                autoComplete="email"
                required
                className="form-input"
                placeholder="contact@glowsalon.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'salon-signup-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="salon-phone" className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input
                id="salon-phone"
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
            <label htmlFor="salon-address" className="form-label">Address</label>
            <div className="form-input-wrapper">
              <MapPin className="form-input-icon" size={18} />
              <input
                id="salon-address"
                type="text"
                autoComplete="street-address"
                required
                className="form-input"
                placeholder="123 Luxury Road, City Center"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="salon-pricing" className="form-label">Pricing Standard</label>
            <div className="form-input-wrapper">
              <CreditCard className="form-input-icon" size={18} />
              <select id="salon-pricing" className="form-select" value={pricing} onChange={e => setPricing(e.target.value)}>
                <option value="Affordable">Affordable</option>
                <option value="Moderate">Moderate</option>
                <option value="Premium">Premium Luxury</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="salon-password" className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="salon-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                title="At least 8 characters"
                required
                className="form-input"
                placeholder="••••••••"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'salon-signup-error' : undefined}
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
          Already have an account? <Link to="/buisness/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
