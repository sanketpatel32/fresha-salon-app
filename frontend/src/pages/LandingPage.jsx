import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Sparkles, User, ShieldAlert } from 'lucide-react';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <section className="hero">
        <span className="hero-badge"><Sparkles size={14} style={{ marginRight: '4px' }} /> Discover & Book Beauty Services</span>
        <h1 className="hero-title">
          The Premium <span>Salon Experience</span> at Your Fingertips
        </h1>
        <p className="hero-subtitle">
          Book top-rated styling, hair, spa, and beauty professionals with absolute ease and secure payments.
        </p>
        <div className="hero-cta">
          <button onClick={() => navigate('/user/login')} className="btn btn-primary btn-lg">Explore as Customer</button>
          <button onClick={() => navigate('/buisness/signup')} className="btn btn-accent btn-lg">Join as Partner Salon</button>
        </div>

        <h2 className="section-head">Who are you?</h2>
        <p className="section-sub">Choose your workspace portal below.</p>

        <div className="role-cards-grid">
          <button onClick={() => navigate('/user/login')} className="role-card" type="button">
            <div className="role-icon-wrapper">
              <User size={32} />
            </div>
            <h3>Customer</h3>
            <p>Search premium salons, book appointments, make secure payments and leave feedback.</p>
          </button>

          <button onClick={() => navigate('/buisness/login')} className="role-card" type="button">
            <div className="role-icon-wrapper">
              <Sparkles size={32} />
            </div>
            <h3>Salon Owner</h3>
            <p>Manage services, catalog listings, coordinate staff members, and track customer schedules.</p>
          </button>

          <button onClick={() => navigate('/staff/login')} className="role-card" type="button">
            <div className="role-icon-wrapper">
              <Scissors size={32} />
            </div>
            <h3>Salon Staff</h3>
            <p>Check assigned bookings, review appointment details, and look at customer service notes.</p>
          </button>

          <button onClick={() => navigate('/admin/login')} className="role-card" type="button">
            <div className="role-icon-wrapper">
              <ShieldAlert size={32} />
            </div>
            <h3>System Admin</h3>
            <p>Admin console to monitor global users, salon listings, and resolve bookings.</p>
          </button>
        </div>
      </section>
    </div>
  );
}
