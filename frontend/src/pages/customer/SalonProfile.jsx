import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { MapPin, Phone, Clock, Star, Calendar, ArrowLeft, Scissors, ListOrdered } from 'lucide-react';
import Skeleton, { SkeletonCardGrid } from '../../components/Skeleton.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import './customer.css';

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

  // Must be called before the early returns below (Rules of Hooks).
  useDocumentTitle(data?.salon?.name || 'Salon');

  // Waitlist (#30) — queue for a full day at this salon. Date is prefilled
  // with today; joining is best-effort and surfaces the server's reason
  // (e.g. "Already on the waitlist") on failure.
  const showToast = useToast();
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [waitlistDate, setWaitlistDate] = useState(todayLocal());
  const [waitlistPartySize, setWaitlistPartySize] = useState(1);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const handleJoinWaitlist = async () => {
    setJoiningWaitlist(true);
    try {
      await axios.post('/api/appointment/waitlist', {
        salonId: parseInt(salonId, 10),
        date: waitlistDate,
        partySize: Math.min(20, Math.max(1, parseInt(waitlistPartySize, 10) || 1)),
      });
      showToast(`You're on the waitlist for ${waitlistDate}.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not join the waitlist', 'error');
    } finally {
      setJoiningWaitlist(false);
    }
  };

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
      <div className="container page-shell">
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
      <div className="container page-shell">
        <div className="empty-state">
          <Scissors size={48} />
          <h3>Couldn't load this salon</h3>
          <p>Something went wrong. Please try again.</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary btn-sm">Try again</button>
        </div>
      </div>
    );
  }

  if (!data || !data.salon) {
    return (
      <div className="container page-shell">
        <div className="empty-state">
          <Scissors size={48} />
          <h3>Salon not found</h3>
          <Link to="/customer/dashboard" className="btn btn-primary btn-sm">Back to salons</Link>
        </div>
      </div>
    );
  }

  const { salon, services, reviews } = data;
  const grouped = groupByCategory(services);

  return (
    <div className="container page-shell">
      <Link to="/customer/dashboard" className="back-link">
        <ArrowLeft size={16} /> All salons
      </Link>

      {/* Hero — the salon's page header: serif headline over a hairline rule */}
      <div className="salon-hero">
        <div className="page-head" style={{ marginBottom: 0 }}>
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
            {salon.workingDays && (
              <span className="chip">
                <span className="chip-muted">Days:</span>{' '}
                {/* API returns ["mon","tue",…]; a bare array renders with no
                    separators ("montowed…"), so format it explicitly. */}
                {(Array.isArray(salon.workingDays)
                  ? salon.workingDays
                  : String(salon.workingDays).split(',')
                ).map(d => {
                  const s = String(d).trim().slice(0, 3).toLowerCase();
                  return s.charAt(0).toUpperCase() + s.slice(1);
                }).join(', ')}
              </span>
            )}
            <a href={`tel:${salon.phoneNumber}`} className="chip chip-link">
              <Phone size={14} /> {salon.phoneNumber}
            </a>
            {salon.openingTime && (
              <span className="chip"><Clock size={14} /> {salon.openingTime?.slice(0, 5)}–{salon.closingTime?.slice(0, 5)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Services, grouped by category */}
      <h2 className="section-head">Services menu</h2>
      {services.length === 0 ? (
        <div className="empty-state">
          <Scissors size={48} />
          <h3>No services listed</h3>
          <p>This salon hasn't listed any services yet.</p>
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

      {/* Waitlist (#30) — for days when the salon is fully booked */}
      <div className="booking-panel waitlist-join-panel">
        <h3 className="panel-title"><ListOrdered size={18} /> Fully booked? Join the waitlist</h3>
        <p className="section-sub" style={{ marginBottom: 'var(--space-xs)' }}>
          If a slot opens up on your day, you'll be alerted automatically.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="waitlist-date" className="form-label">Day</label>
            <input
              id="waitlist-date"
              type="date"
              min={todayLocal()}
              className="form-input form-input--plain"
              value={waitlistDate}
              onChange={e => setWaitlistDate(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ margin: 0, width: '110px' }}>
            <label htmlFor="waitlist-party" className="form-label">Party size</label>
            <input
              id="waitlist-party"
              type="number"
              min="1"
              max="20"
              step="1"
              className="form-input form-input--plain"
              value={waitlistPartySize}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                setWaitlistPartySize(Number.isNaN(v) ? '' : Math.min(20, Math.max(1, v)));
              }}
            />
          </div>
          <button
            onClick={handleJoinWaitlist}
            disabled={joiningWaitlist || !waitlistDate}
            className="btn btn-primary btn-sm"
          >
            {joiningWaitlist ? 'Joining…' : 'Join waitlist'}
          </button>
        </div>
      </div>

      {/* Reviews feed */}
      <h2 className="section-head">Reviews ({salon.reviewCount})</h2>
      {reviews.length === 0 ? (
        <div className="empty-state">
          <Star size={48} />
          <h3>No reviews yet</h3>
          <p>Be the first to leave one after your visit.</p>
        </div>
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
              <span className="review-date">{new Date(rev.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
