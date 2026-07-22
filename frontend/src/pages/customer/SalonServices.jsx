import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { MapPin, Star, Sparkles, Clock } from 'lucide-react';
import Skeleton, { SkeletonCardGrid } from '../../components/Skeleton.jsx';

export default function SalonServices() {
  const { salonId } = useParams();
  const [salon, setSalon] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const salonRes = await axios.get(`/api/buisness/getsalonbyId?salonId=${salonId}`);
        setSalon(salonRes.data);
        const servicesRes = await axios.get(`/api/userdashboard/getAllActiveServicesBySalonId?salonId=${salonId}`);
        setServices(servicesRes.data);
      } catch (err) {
        console.error('Error fetching services details', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [salonId]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '40px 24px' }}>
        <div className="salon-hero">
          <Skeleton height="2rem" width="50%" />
          <Skeleton height="1rem" width="70%" />
          <Skeleton height="1.5rem" width="40%" />
        </div>
        <h2 className="section-head"><Skeleton height="1.5rem" width="180px" /></h2>
        <SkeletonCardGrid count={4} />
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      {salon && (
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
            <span className="chip">
              <span className="chip-muted">Pricing:</span> {salon.pricing || 'Premium'}
            </span>
            {salon.workingDays && (
              <span className="chip">
                <span className="chip-muted">Days:</span> {salon.workingDays}
              </span>
            )}
          </div>
        </div>
      )}

      <h2 className="section-head">Services menu</h2>

      {services.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '32px' }}>
          <Sparkles size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
          <h3>No services available</h3>
          <p style={{ color: 'var(--text-secondary)' }}>This salon has not listed any active services yet.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {services.map(service => (
            <div key={service.id} className="card">
              <div className="card-body">
                <h3 className="card-title">{service.name}</h3>
                <div className="service-row">
                  <span className="card-info">
                    <Clock size={16} /> {service.duration} mins
                  </span>
                  <span className="service-price">₹{service.price}</span>
                </div>
              </div>
              <div className="card-footer">
                <button
                  onClick={() => navigate(`/customer/book/${salonId}/${service.id}`)}
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                >
                  Book Appointment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
