import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Scissors, Mail, Phone, MapPin, CreditCard, Lock } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';

/* Salon Signup */
export default function SalonSignup() {
  const showToast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [pricing, setPricing] = useState('Premium');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/buisness/signup', { name, email, password, phoneNumber, address, pricing });
      showToast('Salon registered successfully! Please sign in.', 'success');
      navigate('/buisness/login');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to register salon', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: '540px' }}>
        <div className="auth-header">
          <h2 className="auth-title">Salon registration</h2>
          <p className="auth-subtitle">Register your business to start booking customers</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="salon-name" className="form-label">Salon / Brand Name</label>
            <div className="form-input-wrapper">
              <Scissors className="form-input-icon" size={18} />
              <input
                id="salon-name"
                type="text"
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
                required
                className="form-input"
                placeholder="contact@glowsalon.com"
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
            <label htmlFor="salon-password" className="form-label">Secret Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input
                id="salon-password"
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
          <button type="submit" disabled={loading} className="btn btn-accent" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Registering...' : 'Register Salon Partner'}
          </button>
        </form>
        <div className="form-footer">
          Already registered? <Link to="/buisness/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
