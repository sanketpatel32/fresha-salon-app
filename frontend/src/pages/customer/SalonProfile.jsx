import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { MapPin, Phone, Clock, Star, Calendar, ArrowLeft, Scissors } from 'lucide-react';
import Skeleton, { SkeletonCardGrid } from '../../components/Skeleton.jsx';

const CATEGORY_ORDER = [
  'Hair', 'Spa & Massage', 'Facial & Skin', 'Nails',
  'Makeup', 'Bridal', "Men's Grooming", 'Other',
];

/** Group services by category, in a stable order. */
function groupByCategory(services) {
  const groups = {};
  services.forEach((s) => {
    const cat = s.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(s);
  });
  // Return in canonical category order, then any leftover categories.
  const ordered = CATEGORY_ORDER.filter((c) => groups[c]);
  const rest = Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c));
  return [...ordered, ...rest].map((cat) => ({ category: cat, services: groups[cat] }));
}

export default function SalonProfile() {
  const { salonId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null); // { salon, services, reviews }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await axios.get(`/api/buisness/profile/${salonId}`);
        setData(res.data);
      } catch (err) {
        // Distinguish a network/server error from a genuine 404 ("not found").
        const status = err.response?.status;
        if (status === 404) {
          setData(null); // genuine not-found
        } else {
          setError(true); // something else went wrong
        }
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [salonId]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '40px 24px' }}>
        <div className="salon-hero">
          <Skeleton height="2.2rem" width="50%" />
          <Skeleton height="1rem" width="70%" />
          <Skeleton height="1.5rem" width="40%" />
        </div>
        <SkeletonCardGrid count={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: '40px 24px' }}>
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>Couldn't load this salon</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Something went wrong. Please try again.</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary btn-sm" style={{ marginTop: '20px' }}>Try again</button>
        </div>
      </div>
    );
  }

  if (!data || !data.salon) {
    return (
      <div className="container" style={{ padding: '40px 24px' }}>
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>Salon not found</h3>
          <Link to="/customer/dashboard" className="btn btn-primary btn-sm" style={{ marginTop: '20px' }}>Back to salons</Link>
        </div>
      </div>
    );
  }

  const { salon, services, reviews } = data;
  const grouped = groupByCategory(services);

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <Link to="/customer/dashboard" className="back-link">
        <ArrowLeft size={16} /> All salons
      </Link>

      {/* Hero */}
      <div className="salon-hero">
        <h1 className="dashboard-title">{salon.name}</h1>
        <p className="section-sub salon-address">
          <MapPin size={16} /> {salon.address}
        </p>
        <div className="salon-meta">
          <span className="chip">
            <Star size={14} fill="currentColor" className="chip-star" />
            <strong>{salon.avgRating ? Number(salon.avgRating).toFixed(1) : 'New'}</strong>
            <span className="chip-muted">· {salon.reviewCount} review{salon.reviewCount === 1 ? '' : 's'}</span>
          </span>
          <span className="chip"><span className="chip-muted">Tier:</span> {salon.pricing || 'Premium'}</span>
          {salon.workingDays && <span className="chip"><span className="chip-muted">Days:</span> {salon.workingDays}</span>}
          <a href={`tel:${salon.phoneNumber}`} className="chip chip-link">
            <Phone size={14} /> {salon.phoneNumber}
          </a>
          {salon.openingTime && (
            <span className="chip"><Clock size={14} /> {salon.openingTime?.slice(0, 5)}–{salon.closingTime?.slice(0, 5)}</span>
          )}
        </div>
      </div>

      {/* Services, grouped by category */}
      <h2 className="section-head">Services menu</h2>
      {services.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '32px' }}>
          <Scissors size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
          <p style={{ color: 'var(--color-ink-2)' }}>This salon hasn't listed any services yet.</p>
        </div>
      ) : (
        grouped.map(({ category, services: catServices }) => (
          <div key={category} className="category-group">
            <h3 className="category-head">{category}</h3>
            <div className="grid-cards">
              {catServices.map((service) => (
                <div key={service.id} className="card">
                  <div className="card-body">
                    <h4 className="card-title">{service.name}</h4>
                    <div className="service-row">
                      <span className="card-info"><Clock size={16} /> {service.duration} mins</span>
                      <span className="service-price">₹{service.price}</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    <button
                      onClick={() => navigate(`/customer/book/${salonId}/${service.id}`)}
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                    >
                      <Calendar size={16} /> Book
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Reviews feed */}
      <h2 className="section-head">Reviews ({salon.reviewCount})</h2>
      {reviews.length === 0 ? (
        <p className="section-sub" style={{ marginBottom: 'var(--space-xl)' }}>No reviews yet — be the first to leave one after your visit.</p>
      ) : (
        <div className="reviews-grid">
          {reviews.map((rev, i) => (
            <div key={i} className="review-card-public">
              <div className="review-header">
                <span className="review-user">{rev.user?.name || 'Anonymous'}</span>
                {rev.rating && (
                  <span className="rating-inline">
                    <Star size={14} fill="currentColor" /> {rev.rating}
                  </span>
                )}
              </div>
              {rev.userReview && <p className="review-text">“{rev.userReview}”</p>}
              <span className="review-date">{new Date(rev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
