import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Calendar, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';

export default function BookedAppointments() {
  const { userSession } = useAuth();
  const showToast = useToast();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [stuckPayments, setStuckPayments] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [selectedApptId, setSelectedApptId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [cancelTarget, setCancelTarget] = useState(null);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get(`/api/appointment/getAll?userId=${userSession.id}`);
      setAppointments(res.data);
      // Only probe for stuck payments when there's reason to: the list is short.
      // This surfaces "paid but booking not created yet" instead of a bare empty state.
      try {
        const stuck = await axios.get('/api/pay/stuck');
        setStuckPayments(stuck.data);
      } catch {
        // Non-critical — don't fail the whole page over this.
        setStuckPayments([]);
      }
    } catch (err) {
      console.error('Error fetching appointments', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userSession.id]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleOpenReview = (apptId, currentReview, currentRating) => {
    setSelectedApptId(apptId);
    setReviewText(currentReview || '');
    setRating(currentRating || 0);
    setShowModal(true);
  };

  const handleSubmitReview = async () => {
    try {
      await axios.put(`/api/appointment/review/${selectedApptId}`, { review: reviewText, rating });
      showToast('Review submitted successfully!', 'success');
      setShowModal(false);
      fetchBookings();
    } catch (err) {
      showToast('Failed to submit review', 'error');
    }
  };

  const handleCancel = async (apptId) => {
    setCancelTarget(apptId);
  };

  const confirmCancel = async () => {
    try {
      await axios.put(`/api/appointment/cancel/${cancelTarget}`);
      showToast('Appointment cancelled.', 'success');
      fetchBookings();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to cancel appointment', 'error');
    } finally {
      setCancelTarget(null);
    }
  };

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <h1 className="dashboard-title" style={{ marginBottom: '24px' }}>My Appointments</h1>

      {stuckPayments.length > 0 && (
        <div className="stuck-payments-banner">
          {stuckPayments.map(p => (
            <div key={p.orderId} className="stuck-payment-item">
              <strong>Payment received</strong>
              <span> — we're confirming your booking for order {p.orderId}
              {p.paymentStatus === 'Success' ? ' (finalizing…)' : ' (awaiting payment confirmation)'}.
              This usually resolves within a minute. Refresh in a moment.</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={4} cols={6} />
      ) : loadError ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>Couldn't load your appointments</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Something went wrong on our end.</p>
          <button onClick={fetchBookings} className="btn btn-primary btn-sm" style={{ marginTop: '20px' }}>Try again</button>
        </div>
      ) : appointments.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No Appointments Booked</h3>
          <p style={{ color: 'var(--text-secondary)' }}>You don't have any past or scheduled salon appointments.</p>
          <Link to="/customer/dashboard" className="btn btn-primary btn-sm" style={{ marginTop: '20px' }}>Find Salons</Link>
        </div>
      ) : (
        <div className="table-container">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Salon</th>
                <th>Service</th>
                <th>Staff Assigned</th>
                <th>Scheduled Slot</th>
                <th>Status</th>
                <th>Your Feedback</th>
                <th>Therapist Note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map(appt => (
                <tr key={appt.id}>
                  <td><strong>{appt.salon?.name}</strong></td>
                  <td>{appt.service?.name}</td>
                  <td>{appt.staff?.name}</td>
                  <td>
                    <div>{appt.date}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{appt.time} - {appt.endTime}</div>
                  </td>
                  <td>
                    <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : appt.status === 'cancelled' ? 'badge-danger' : appt.status === 'declined' ? 'badge-danger' : 'badge-warning'}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
                  <td>
                    {appt.userReview ? (
                      <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{appt.userReview}"</span>
                    ) : (
                      <span className="badge badge-warning">No review left</span>
                    )}
                  </td>
                  <td>
                    {appt.staffReview ? (
                      <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--primary)' }}>"{appt.staffReview}"</span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None yet</span>
                    )}
                  </td>
                  <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      onClick={() => navigate(`/customer/book/${appt.salon?.id || appt.salonId}/${appt.service?.id || appt.serviceId}`)}
                      className="btn btn-secondary btn-sm"
                    >
                      Book Again
                    </button>
                    {appt.status === 'completed' && (
                      <button
                        onClick={() => handleOpenReview(appt.id, appt.userReview, appt.rating)}
                        className="btn btn-secondary btn-sm"
                      >
                        <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                      </button>
                    )}
                    {(appt.status === 'confirmed' || appt.status === 'pending') && (
                      <button
                        onClick={() => handleCancel(appt.id)}
                        className="btn btn-danger btn-sm"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Write feedback">
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Share your experience with the team.</p>
        <fieldset className="star-fieldset">
          <legend style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Your rating</legend>
          <div className="star-picker" role="radiogroup" aria-label="Star rating">
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="star-btn"
                role="radio"
                aria-checked={n === rating}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                title={`${n} star${n > 1 ? 's' : ''}`}
              >
                <Star size={28} fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </fieldset>
        <div className="form-group">
          <label htmlFor="review-text" className="form-label">Your review</label>
          <textarea
            id="review-text"
            className="form-textarea"
            placeholder="Write your review here..."
            value={reviewText}
            onChange={e => setReviewText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={() => setShowModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSubmitReview} className="btn btn-primary btn-sm">Submit Review</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel appointment?"
        message="This appointment will be cancelled. This action cannot be undone."
        confirmLabel="Yes, cancel it"
        danger
        onConfirm={confirmCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
