import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Search, Star, Scissors, MapPin, Phone, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { SkeletonCardGrid } from '../../components/Skeleton.jsx';

export default function CustomerDashboard() {
  const { userSession } = useAuth();
  const [salons, setSalons] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [favoriteSalonIds, setFavoriteSalonIds] = useState(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSalons = async () => {
      try {
        const res = await axios.get('/api/buisness/getall');
        setSalons(res.data);
      } catch (err) {
        console.error('Error fetching salons', err);
      } finally {
        setLoading(false);
      }
    };
    const fetchFavorites = async () => {
      try {
        const res = await axios.get('/api/user/favorites');
        setFavoriteSalonIds(new Set(res.data.map(s => s.id)));
      } catch (err) {
        // Not logged in or no favorites — fine, ignore.
      }
    };
    fetchSalons();
    fetchFavorites();
  }, []);

  const toggleFavorite = async (salonId) => {
    const isFav = favoriteSalonIds.has(salonId);
    // Optimistic UI update
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
      // Revert on failure
      setFavoriteSalonIds(favoriteSalonIds);
    }
  };

  const filteredSalons = salons
    .filter(salon => !showFavoritesOnly || favoriteSalonIds.has(salon.id))
    .filter(salon =>
      salon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      salon.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (salon.pricing && salon.pricing.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h1 className="dashboard-title">Explore salons</h1>
          <p className="section-sub">Choose a beauty partner salon near you.</p>
        </div>
        <div className="search-bar-container">
          <div className="form-input-wrapper" style={{ flex: 1 }}>
            <Search className="form-input-icon" size={18} />
            <input
              type="text"
              className="form-input"
              placeholder="Search salon name, location or pricing..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '48px' }}
            />
          </div>
        </div>
        <button
          onClick={() => setShowFavoritesOnly(v => !v)}
          className={`btn btn-sm ${showFavoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
          {showFavoritesOnly ? 'Showing Favorites' : 'Favorites'}
        </button>
      </div>

      {loading ? (
        <SkeletonCardGrid count={6} />
      ) : filteredSalons.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No Salons Found</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>We couldn't find any partner salons matching your filters.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {filteredSalons.map(salon => (
            <div key={salon.id} className="card">
              <div className="card-header-image">
                <span className="card-badge">{salon.pricing || 'Moderate'}</span>
                <Scissors size={36} strokeWidth={1.5} />
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(salon.id); }}
                  className="fav-toggle"
                  aria-label={favoriteSalonIds.has(salon.id) ? 'Remove from favorites' : 'Add to favorites'}
                  title={favoriteSalonIds.has(salon.id) ? 'Remove from favorites' : 'Add to favorites'}
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
                      <span className="rating-none">No ratings yet</span>
                    )}
                  </div>
                </div>
                <div className="card-info">
                  <MapPin size={16} />
                  <span>{salon.address}</span>
                </div>
                <div className="card-info">
                  <Phone size={16} />
                  <span>{salon.phoneNumber}</span>
                </div>
                {salon.openingTime && (
                  <div className="card-info" style={{ marginTop: '4px' }}>
                    <Clock size={16} />
                    <span>Open: {salon.openingTime.slice(0, 5)} - {salon.closingTime?.slice(0, 5)}</span>
                  </div>
                )}
              </div>
              <div className="card-footer">
                <button
                  onClick={() => navigate(`/customer/salonservices/${salon.id}`)}
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                >
                  View Services
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
