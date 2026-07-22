import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { User, Mail, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function EditProfile() {
  const { userSession } = useAuth();
  const showToast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await axios.get('/api/user/profile');
        setName(res.data.name || '');
        setEmail(res.data.email || '');
        setPhoneNumber(res.data.phoneNumber || '');
      } catch (err) {
        console.error('Error loading profile', err);
      }
    };
    loadProfile();
  }, [userSession.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.put('/api/user/edit', { name, email, phoneNumber });
      showToast('Profile updated successfully!', 'success');
    } catch (err) {
      showToast('Failed to update profile details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: '60px 24px', maxWidth: '600px' }}>
      <div className="auth-card" style={{ maxWidth: '100%' }}>
        <div className="auth-header">
          <h2 className="auth-title">Edit Profile</h2>
          <p className="auth-subtitle">Keep your contact details up to date</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input type="tel" className="form-input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Saving Changes...' : 'Save Profile Details'}
          </button>
        </form>
      </div>
    </div>
  );
}
