import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Search, Star, Scissors, MapPin, Phone, Clock, SlidersHorizontal, X } from 'lucide-react';
import { SkeletonCardGrid } from '../../components/Skeleton.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

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

  // Favorites.
  const [favoriteSalonIds, setFavoriteSalonIds] = useState(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Filter state.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(''); // debounced
  const [category, setCategory] = useState('');
  const [pricing, setPricing] = useState('');
  const [minRating, setMinRating] = useState('');
  const [sort, setSort] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Debounce the search input (300ms).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch salons whenever filters/sort/page change.
  useEffect(() => {
    const fetchSalons = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams();
        if (searchQuery) params.set('q', searchQuery);
        if (category) params.set('category', category);
        if (pricing) params.set('pricing', pricing);
        if (minRating) params.set('minRating', minRating);
        if (sort) params.set('sort', sort);
        params.set('page', page);
        params.set('limit', PAGE_SIZE);

        const res = await axios.get(`/api/buisness/getall?${params.toString()}`);
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
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchSalons();
  }, [searchQuery, category, pricing, minRating, sort, page]);

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
    <div className="container" style={{ padding: '40px 24px' }}>
      {/* Header + search */}
      <div className="dashboard-header" style={{ marginBottom: '20px' }}>
        <div>
          <h1 className="dashboard-title">Explore salons</h1>
          <p className="section-sub">Find a beauty partner near you.</p>
        </div>
        <div className="search-bar-container">
          <div className="form-input-wrapper" style={{ flex: 1 }}>
            <Search className="form-input-icon" size={18} />
            <input
              type="text"
              className="form-input"
              placeholder="Search salon name or location…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              style={{ paddingLeft: '48px' }}
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
            className={`btn btn-sm ${showFavoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            {showFavoritesOnly ? 'Favorites' : 'Favorites'}
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

      {/* Results */}
      {loading ? (
        <SkeletonCardGrid count={6} />
      ) : loadError ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>Couldn't load salons</h3>
          <p style={{ color: 'var(--color-ink-2)', marginTop: '8px' }}>Something went wrong on our end.</p>
          <button onClick={() => { setPage(1); setSearchQuery(''); }} className="btn btn-primary btn-sm" style={{ marginTop: '16px' }}>Try again</button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No salons found</h3>
          <p style={{ color: 'var(--color-ink-2)', marginTop: '8px' }}>
            {hasActiveFilters ? 'Try adjusting your filters.' : 'We couldn\'t find any partner salons.'}
          </p>
          {hasActiveFilters && <button onClick={clearFilters} className="btn btn-primary btn-sm" style={{ marginTop: '16px' }}>Clear filters</button>}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
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
                    <div className="card-info" style={{ marginTop: '4px' }}>
                      <Clock size={16} /> {salon.openingTime?.slice(0, 5)}–{salon.closingTime?.slice(0, 5)}
                    </div>
                  )}
                </div>
                <div className="card-footer">
                  <button
                    onClick={() => navigate(`/customer/salon/${salon.id}`)}
                    className="btn btn-primary btn-sm"
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
