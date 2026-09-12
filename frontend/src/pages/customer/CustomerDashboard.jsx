import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Search, Star, Scissors, MapPin, Phone, Clock, SlidersHorizontal, X, Bell, Gift, ListOrdered } from 'lucide-react';
import { SkeletonCardGrid } from '../../components/Skeleton.jsx';
import NotificationsPanel from '../../components/NotificationsPanel.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import './customer.css';

const CATEGORIES = [
  'Hair', 'Spa & Massage', 'Facial & Skin', 'Nails',
  'Makeup', 'Bridal', "Men's Grooming", 'Other',
];

const SORTS = [
  { value: '', label: 'Default' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
];

const PAGE_SIZE = 12;

export default function CustomerDashboard() {
  const { userSession } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle('Browse Salons');

  // Salon list + fetch state.
  const [salons, setSalons] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0); // bumped by "Try again" to refire the fetch

  // Favorites.
  const [favoriteSalonIds, setFavoriteSalonIds] = useState(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Notifications — the panel stays mounted so the bell badge is live before
  // the section is opened; visibility is a pure display toggle (same
  // eager-fetch convention as the salon list + favorites below).
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  // Filter state.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(''); // debounced
  const [category, setCategory] = useState('');
  const [pricing, setPricing] = useState('');
  const [minRating, setMinRating] = useState('');
  const [sort, setSort] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Loyalty (#27/#28) — one lazy fetch; the endpoint returns points,
  // lifetimePointsEarned and referralCode together.
  const [loyalty, setLoyalty] = useState(null);

  // Upcoming appointments (#29) — bare array (≤5), fetched once on mount.
  const [upcoming, setUpcoming] = useState([]);

  // Waitlist (#30) — my entries + Leave action.
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [waitlistSalonNames, setWaitlistSalonNames] = useState({}); // salonId → name
  const [leavingWaitlistId, setLeavingWaitlistId] = useState(null);

  // Debounce the search input (300ms).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch salons whenever filters/sort/page change. The ignore flag drops
  // responses from stale requests (fast filter changes used to race and the
  // earlier response could overwrite the newer one).
  useEffect(() => {
    let ignore = false;
    const fetchSalons = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams();
        // `search` (#22): case-insensitive over salon name AND address.
        if (searchQuery) params.set('search', searchQuery);
        if (category) params.set('category', category);
        if (pricing) params.set('pricing', pricing);
        if (minRating) params.set('minRating', minRating);
        if (sort) params.set('sort', sort);
        params.set('page', page);
        params.set('limit', PAGE_SIZE);

        const res = await axios.get(`/api/buisness/getall?${params.toString()}`);
        if (ignore) return;
        if (Array.isArray(res.data)) {
          // Legacy bare-array response (no pagination wrapper).
          setSalons(res.data);
          setTotal(res.data.length);
          setTotalPages(1);
        } else {
          setSalons(res.data.data || []);
          setTotal(res.data.total || 0);
          setTotalPages(res.data.totalPages || 0);
        }
      } catch (err) {
        console.error('Error fetching salons', err);
        if (!ignore) setLoadError(true);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchSalons();
    return () => { ignore = true; };
  }, [searchQuery, category, pricing, minRating, sort, page, retryToken]);

  // Fetch favorites (once).
  useEffect(() => {
    const fetchFavorites = async () => {
      try {
        const res = await axios.get('/api/user/favorites');
        setFavoriteSalonIds(new Set(res.data.map(s => s.id)));
      } catch (err) {
        // Not logged in or no favorites — fine.
      }
    };
    fetchFavorites();
  }, []);

  // Loyalty card (#27/#28) — single lazy fetch, non-2xx degrades to a hidden card.
  useEffect(() => {
    let cancelled = false;
    axios.get('/api/user/loyalty')
      .then(res => { if (!cancelled) setLoyalty(res.data || null); })
      .catch(() => { /* card simply won't render */ });
    return () => { cancelled = true; };
  }, []);

  // Upcoming appointments strip (#29) — non-2xx → empty strip, never breaks render.
  useEffect(() => {
    let cancelled = false;
    axios.get('/api/appointment/upcoming')
      .then(res => { if (!cancelled) setUpcoming(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { /* strip stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  const fetchWaitlistEntries = useCallback(async () => {
    try {
      const res = await axios.get('/api/appointment/waitlist');
      setWaitlistEntries(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('Error fetching waitlist', err);
      setWaitlistEntries([]);
    }
  }, []);

  useEffect(() => { fetchWaitlistEntries(); }, [fetchWaitlistEntries]);

  // Waitlist rows carry plain salonId refs (no association), so resolve each
  // unique salon's name lazily; failures degrade to the "Salon #id" label.
  useEffect(() => {
    const ids = [...new Set(waitlistEntries.map(e => Number(e.salonId)).filter(Boolean))]
      .filter(id => !(id in waitlistSalonNames));
    ids.forEach(id => {
      axios.get(`/api/buisness/getsalonbyId?salonId=${id}`)
        .then(res => setWaitlistSalonNames(prev => ({ ...prev, [id]: res.data?.name || `Salon #${id}` })))
        .catch(() => setWaitlistSalonNames(prev => ({ ...prev, [id]: `Salon #${id}` })));
    });
  }, [waitlistEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeaveWaitlist = async (id) => {
    setLeavingWaitlistId(id);
    try {
      await axios.delete(`/api/appointment/waitlist/${id}`);
      setWaitlistEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error('Error leaving waitlist', err);
      fetchWaitlistEntries();
    } finally {
      setLeavingWaitlistId(null);
    }
  };

  const toggleFavorite = useCallback(async (salonId) => {
    const isFav = favoriteSalonIds.has(salonId);
    const next = new Set(favoriteSalonIds);
    if (isFav) next.delete(salonId); else next.add(salonId);
    setFavoriteSalonIds(next);
    try {
      if (isFav) {
        await axios.delete(`/api/user/favorites/${salonId}`);
      } else {
        await axios.post('/api/user/favorites', { salonId });
      }
    } catch (err) {
      setFavoriteSalonIds(favoriteSalonIds);
    }
  }, [favoriteSalonIds]);

  const clearFilters = () => {
    setSearchInput('');
    setCategory('');
    setPricing('');
    setMinRating('');
    setSort('');
    setPage(1);
  };

  const hasActiveFilters = searchQuery || category || pricing || minRating || sort;

  const displayed = showFavoritesOnly
    ? salons.filter(s => favoriteSalonIds.has(s.id))
    : salons;

  return (
    <div className="container page-shell">
      {/* Header + search — serif headline over a hairline rule (page-head) */}
      <div className="dashboard-header page-head">
        <div>
          <h1 className="dashboard-title">Explore salons</h1>
          <p className="section-sub">Find a beauty partner near you.</p>
        </div>
        <div className="search-bar-container dashboard-search">
          <div className="form-input-wrapper" style={{ flex: 1 }}>
            <Search className="form-input-icon" size={18} />
            <input
              type="text"
              className="form-input"
              placeholder="Search salon name or location…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`btn btn-sm ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
            aria-label="Toggle filters"
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={16} /> Filters
          </button>
          <button
            onClick={() => setShowFavoritesOnly(v => !v)}
            aria-pressed={showFavoritesOnly}
            className={`btn btn-sm ${showFavoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            {showFavoritesOnly ? 'Favorites Only' : 'Favorites'}
          </button>
          <button
            onClick={() => setShowNotifications(v => !v)}
            className={`btn btn-sm ${showNotifications ? 'btn-primary' : 'btn-secondary'}`}
            aria-label="Toggle notifications"
            aria-expanded={showNotifications}
          >
            <Bell size={16} />
            Alerts{unreadNotifs > 0 ? ` (${unreadNotifs})` : ''}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="filter-bar">
          <div className="filter-field">
            <label className="filter-label">Category</label>
            <select className="form-select" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Tier</label>
            <select className="form-select" value={pricing} onChange={e => { setPricing(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="Affordable">Affordable</option>
              <option value="Moderate">Moderate</option>
              <option value="Premium">Premium</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Min rating</label>
            <select className="form-select" value={minRating} onChange={e => { setMinRating(e.target.value); setPage(1); }}>
              <option value="">Any</option>
              <option value="3">3+ ★</option>
              <option value="4">4+ ★</option>
              <option value="4.5">4.5+ ★</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Sort by</label>
            <select className="form-select" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn btn-secondary btn-sm filter-clear">
              <X size={14} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Notifications (toggleable; panel reports its own unread count) */}
      <div style={{ display: showNotifications ? 'block' : 'none', marginBottom: 'var(--space-md)', maxWidth: '800px' }}>
        <NotificationsPanel onUnreadChange={setUnreadNotifs} />
      </div>

      {/* Upcoming appointments strip (#29) */}
      {upcoming.length > 0 && (
        <div className="upcoming-strip" role="list" aria-label="Your upcoming appointments">
          <span className="upcoming-strip-label"><Clock size={14} /> Next up</span>
          {upcoming.map(appt => (
            <div key={appt.id} className="upcoming-chip" role="listitem">
              <strong>{appt.service?.name || 'Appointment'}</strong>
              <span>{appt.salon?.name || ''}</span>
              <span className="upcoming-chip-when">{appt.date} · {String(appt.time).slice(0, 5)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Loyalty (#27/#28) + Waitlist (#30) cards. Full-width single row when
          only one of the two exists — the 2fr/1fr split leaves a dead zone. */}
      {(loyalty || waitlistEntries.length > 0) && (
        <div
          className={loyalty && waitlistEntries.length > 0 ? 'grid-dashboard-split' : 'dashboard-row-single'}
          style={{ marginBottom: 'var(--space-md)' }}
        >
          {loyalty && (
            <div className="booking-panel loyalty-card">
              <h3 className="panel-title"><Gift size={18} /> Loyalty</h3>
              <div className="loyalty-row">
                <div>
                  <div className="loyalty-points">{Number(loyalty.points) || 0}</div>
                  <div className="stat-label">points available</div>
                </div>
                <div className="loyalty-lifetime">{Number(loyalty.lifetimePointsEarned) || 0} earned all-time</div>
              </div>
              {loyalty.referralCode && (
                <div className="referral-code-row">
                  <span className="referral-code-label">Your referral code</span>
                  <code className="referral-code">{loyalty.referralCode}</code>
                </div>
              )}
            </div>
          )}
          {waitlistEntries.length > 0 && (
            <div className="booking-panel">
              <h3 className="panel-title"><ListOrdered size={18} /> Waitlists</h3>
              <div className="waitlist-list">
                {waitlistEntries.map(entry => (
                  <div key={entry.id} className="waitlist-item">
                    <div className="waitlist-item-info">
                      <strong>{waitlistSalonNames[Number(entry.salonId)] || `Salon #${entry.salonId}`}</strong>
                      <span>{entry.date} · party of {entry.partySize || 1}</span>
                    </div>
                    <span className={`badge ${entry.status === 'waiting' ? 'badge-warning' : entry.status === 'notified' ? 'badge-success' : 'badge-secondary'}`}>
                      {entry.status || 'waiting'}
                    </span>
                    {(entry.status || 'waiting') !== 'left' && (
                      <button
                        onClick={() => handleLeaveWaitlist(entry.id)}
                        disabled={leavingWaitlistId === entry.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {leavingWaitlistId === entry.id ? 'Leaving…' : 'Leave'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <SkeletonCardGrid count={6} />
      ) : loadError ? (
        <div className="empty-state">
          <Scissors size={48} />
          <h3>Couldn't load salons</h3>
          <p>Something went wrong on our end.</p>
          <button onClick={() => { setPage(1); setSearchQuery(''); setRetryToken(t => t + 1); }} className="btn btn-primary btn-sm">Try again</button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <Scissors size={48} />
          <h3>No salons found</h3>
          <p>
            {hasActiveFilters ? 'Try adjusting your filters.' : 'We couldn\'t find any partner salons.'}
          </p>
          {hasActiveFilters && <button onClick={clearFilters} className="btn btn-primary btn-sm">Clear filters</button>}
        </div>
      ) : (
        <>
          <div className="grid-cards">
            {displayed.map(salon => (
              <div key={salon.id} className="card">
                <div className="card-header-image">
                  <span className="card-badge">{salon.pricing || 'Moderate'}</span>
                  <Scissors size={36} strokeWidth={1.5} />
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(salon.id); }}
                    className="fav-toggle"
                    aria-label={favoriteSalonIds.has(salon.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={16} fill={favoriteSalonIds.has(salon.id) ? 'currentColor' : 'none'} className={favoriteSalonIds.has(salon.id) ? 'is-fav' : ''} />
                  </button>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2xs)', marginBottom: 'var(--space-2xs)' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>{salon.name}</h3>
                    <div className="rating-inline">
                      {salon.avgRating ? (
                        <>
                          <Star size={14} fill="currentColor" />
                          <span>{Number(salon.avgRating).toFixed(1)}</span>
                          <span className="rating-count">({salon.reviewCount})</span>
                        </>
                      ) : (
                        <span className="rating-none">No ratings</span>
                      )}
                    </div>
                  </div>
                  <div className="card-info"><MapPin size={16} /> {salon.address}</div>
                  <div className="card-info"><Phone size={16} /> {salon.phoneNumber}</div>
                  {salon.openingTime && (
                    <div className="card-info" style={{ marginTop: 'var(--space-3xs)' }}>
                      <Clock size={16} /> {salon.openingTime?.slice(0, 5)}–{salon.closingTime?.slice(0, 5)}
                    </div>
                  )}
                </div>
                <div className="card-footer">
                  {/* Secondary (outline) style — accent discipline: viewing a
                      salon is not a primary conversion action; solid accent is
                      reserved for booking CTAs. */}
                  <button
                    onClick={() => navigate(`/customer/salon/${salon.id}`)}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%' }}
                  >
                    View salon
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn btn-secondary btn-sm"
              >
                ← Previous
              </button>
              <span className="pagination-info">Page {page} of {totalPages} · {total} salons</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn btn-secondary btn-sm"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
