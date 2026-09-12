import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Calendar, Star } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import './customer.css';

export default function BookedAppointments() {
  const showToast = useToast();
  const navigate = useNavigate();
  useDocumentTitle('My Appointments');
  // History is paginated ("Load more") — the API clamps limit at 50, and a
  // long demo history otherwise renders as one endless page.
  const PAGE_SIZE = 20;
  const [appointments, setAppointments] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [stuckPayments, setStuckPayments] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [selectedApptId, setSelectedApptId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [cancelTarget, setCancelTarget] = useState(null);

  const fetchPage = useCallback(async (pageToLoad) => {
    if (pageToLoad > 1) setLoadingMore(true); else setLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get(`/api/appointment/getAll?page=${pageToLoad}&limit=${PAGE_SIZE}`);
      // page/limit opts the endpoint into the paginated envelope
      // { data, page, total, totalPages }; fall back to the legacy bare array.
      const rows = Array.isArray(res.data) ? res.data : (res.data.data || []);
      setAppointments(prev => (pageToLoad > 1 ? [...prev, ...rows] : rows));
      if (Array.isArray(res.data)) {
        setTotal(rows.length);
        setTotalPages(1);
      } else {
        setTotal(res.data.total ?? rows.length);
        setTotalPages(res.data.totalPages || 1);
      }
      // Only probe for stuck payments on the initial load. This surfaces
      // "paid but booking not created yet" instead of a bare empty state.
      if (pageToLoad === 1) {
        try {
          const stuck = await axios.get('/api/pay/stuck');
          setStuckPayments(stuck.data);
        } catch {
          // Non-critical — don't fail the whole page over this.
          setStuckPayments([]);
        }
      }
    } catch (err) {
      console.error('Error fetching appointments', err);
      setLoadError(true);
    } finally {
      if (pageToLoad > 1) setLoadingMore(false); else setLoading(false);
    }
  }, []);

  // First page (also re-runs from "Try again" and after review/cancel —
  // both reset to page 1, which is correct since the data changed).
  const fetchBookings = useCallback(() => fetchPage(1), [fetchPage]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPage(next);
  };

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
    <div className="container page-shell">
      <div className="page-head">
        <h1 className="dashboard-title">My Appointments</h1>
      </div>

      {stuckPayments.length > 0 && (
        <div className="stuck-payments-banner">
          {stuckPayments.map(p => (
            <div key={p.orderId} className={p.paymentStatus === 'Slot taken' ? 'stuck-payment-item stuck-payment-danger' : 'stuck-payment-item'}>
              {p.paymentStatus === 'Slot taken' ? (
                <>
                  <strong>Booking couldn't be created</strong>
                  <span> — your payment of ₹{p.orderAmount} for order {p.orderId} was received, but the slot was taken by another booking just before you finished. Please contact us to arrange a refund.</span>
                </>
              ) : (
                <>
                  <strong>Payment received</strong>
                  <span> — we're confirming your booking for order {p.orderId}
                  {p.paymentStatus === 'Success' ? ' (finalizing…)' : ' (awaiting payment confirmation)'}.
                  This usually resolves within a minute. Refresh in a moment.</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={4} cols={6} />
      ) : loadError ? (
        <div className="empty-state">
          <Calendar size={48} />
          <h3>Couldn't load your appointments</h3>
          <p>Something went wrong on our end.</p>
          <button onClick={fetchBookings} className="btn btn-primary btn-sm">Try again</button>
        </div>
      ) : appointments.length === 0 ? (
        <div className="empty-state">
          <Calendar size={48} />
          <h3>No Appointments Booked</h3>
          <p>You don't have any past or scheduled salon appointments.</p>
          <Link to="/customer/dashboard" className="btn btn-primary btn-sm">Find Salons</Link>
        </div>
      ) : (
        <div className="table-container">
          <table className="premium-table appointments-table">
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
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)' }}>{appt.time} - {appt.endTime}</div>
                  </td>
                  <td>
                    {/* Status colour mapping (shared across customer pages):
                        confirmed → success · pending → warning ·
                        cancelled/declined → danger · completed → neutral (terminal) */}
                    <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'cancelled' || appt.status === 'declined' ? 'badge-danger' : appt.status === 'completed' ? 'badge-secondary' : 'badge-warning'}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
                  <td>
                    {appt.userReview ? (
                      <span style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-ink-2)' }}>"{appt.userReview}"</span>
                    ) : (
                      <span className="badge badge-warning">No review left</span>
                    )}
                  </td>
                  <td>
                    {appt.staffReview ? (
                      <span style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-accent)' }}>"{appt.staffReview}"</span>
                    ) : (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>None yet</span>
                    )}
                  </td>
                  <td style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
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
                    {(appt.status === 'confirmed' || appt.status === 'pending') && (() => {
                      // Mirror the server's 24h cancellation window (statusRules.js)
                      // so the button is disabled up-front instead of failing on click.
                      const msUntilStart = new Date(`${appt.date}T${appt.time}`).getTime() - Date.now();
                      const within24h = msUntilStart <= 24 * 60 * 60 * 1000;
                      return (
                        <button
                          onClick={() => handleCancel(appt.id)}
                          disabled={within24h}
                          title={within24h ? 'Cancellations close 24 hours before the appointment' : undefined}
                          className="btn btn-danger btn-sm"
                        >
                          Cancel
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more — the history API is paginated; append pages in place. */}
      {!loading && !loadError && page < totalPages && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-md)' }}>
          <button onClick={handleLoadMore} disabled={loadingMore} className="btn btn-secondary">
            {loadingMore ? 'Loading…' : `Load more (${total - appointments.length} older)`}
          </button>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Write feedback">
        <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>Share your experience with the team.</p>
        <fieldset className="star-fieldset">
          <legend style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2xs)', color: 'var(--color-ink-2)' }}>Your rating</legend>
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
        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
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
