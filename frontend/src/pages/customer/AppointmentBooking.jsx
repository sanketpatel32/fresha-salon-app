import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { CreditCard, AlertCircle } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { SkeletonCardGrid } from '../../components/Skeleton.jsx';
import Modal from '../../components/Modal.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import './customer.css';

export default function AppointmentBooking() {
  const showToast = useToast();
  useDocumentTitle('Configure Booking');
  const { salonId, serviceId } = useParams();
  const [service, setService] = useState(null);
  const [salon, setSalon] = useState(null);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableStaff, setAvailableStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  // Demo payments: when the server has no Cashfree keys it returns a session
  // id prefixed "demo-" and we show a simulated checkout instead of the
  // Cashfree drop-in (which would fail — there is no gateway order behind it).
  const [demoCheckout, setDemoCheckout] = useState(null); // { orderId }
  const navigate = useNavigate();

  // Booking extras (#23/#25/#26): free-text note for the salon, group
  // headcount, and an optional gratuity — all optional and threaded through
  // the existing payment-create payload.
  const NOTE_MAX = 500;
  const [customerNote, setCustomerNote] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [tipAmount, setTipAmount] = useState('');

  // Load next 7 dates
  useEffect(() => {
    const datesArr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      datesArr.push(`${year}-${month}-${day}`);
    }
    setDates(datesArr);
    setSelectedDate(datesArr[0]);
    setSelectedTime('10:00');
  }, []);

  // Fetch service & salon data
  useEffect(() => {
    const fetchData = async () => {
      setFetchLoading(true);
      setFetchError(false);
      try {
        // Customer-accessible endpoints only. The salon dashboard's
        // /api/salonsdashboard/services/get/:id is salon-role-only and 403s
        // for a customer token, so the service is resolved from the salon's
        // public active-services list instead.
        const [servRes, salonRes] = await Promise.all([
          axios.get('/api/userdashboard/getAllActiveServicesBySalonId', { params: { salonId } }),
          axios.get('/api/buisness/getsalonbyId', { params: { salonId } }),
        ]);
        const services = Array.isArray(servRes.data) ? servRes.data : [];
        const found = services.find(s => s.id === Number(serviceId));
        if (!found) {
          setFetchError(true);
          return;
        }
        setService(found);
        setSalon(salonRes.data);
      } catch (err) {
        console.error('Error fetching appointment data details', err);
        setFetchError(true);
      } finally {
        setFetchLoading(false);
      }
    };
    fetchData();
  }, [salonId, serviceId]);

  const handleCheckAvailability = async (e) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) return;
    setCheckingAvailability(true);
    try {
      const res = await axios.post('/api/appointment/check', {
        dateSelect: selectedDate,
        time: selectedTime,
        salonId: parseInt(salonId),
        serviceId: parseInt(serviceId),
        duration: service.duration
      });
      // Envelope: availableStaff list + informational slotStepMinutes.
      const staff = (res.data && res.data.availableStaff) || [];
      setAvailableStaff(staff);
      if (staff.length > 0) {
        setSelectedStaffId(staff[0].id);
        showToast('Staff slots checked successfully!', 'success');
      } else {
        setSelectedStaffId('');
        showToast('No staff members available for this slot.', 'error');
      }
    } catch (err) {
      // Surface the specific reason from the server (e.g. "The salon is closed
      // on this day", "This salon opens at 09:00") instead of a generic message,
      // so the customer knows what to change.
      showToast(err.response?.data?.message || 'Error checking slot availability', 'error');
    } finally {
      setCheckingAvailability(false);
    }
  };

  // Build the payment payload with the optional booking extras attached.
  const buildPaymentPayload = () => {
    const payload = {
      servicePrice: service.price,
      dateSelect: selectedDate,
      time: selectedTime,
      staffId: parseInt(selectedStaffId),
      serviceId: parseInt(serviceId),
      salonId: parseInt(salonId),
      duration: service.duration,
      partySize: Math.min(20, Math.max(1, parseInt(partySize, 10) || 1)),
    };
    if (customerNote.trim()) payload.customerNote = customerNote.trim();
    const tip = parseFloat(tipAmount);
    if (!Number.isNaN(tip) && tip > 0) payload.tipAmount = tip;
    return payload;
  };

  const handlePayAndBook = async () => {
    if (!selectedStaffId) {
      showToast('Please select an available staff member first', 'error');
      return;
    }
    setBookingLoading(true);
    try {
      // 1. Call Payment Endpoint to generate cashfree transaction
      const res = await axios.post('/api/pay/', buildPaymentPayload());
      const { paymentSessionId, orderId } = res.data;

      // 2a. Demo mode — no gateway behind this session. Show the simulated
      // checkout; the drop-in SDK cannot open a session that doesn't exist
      // at Cashfree, so never hand it one.
      if (typeof paymentSessionId === 'string' && paymentSessionId.startsWith('demo-')) {
        setDemoCheckout({ orderId });
        return;
      }

      // 2b. Launch Cashfree SDK checkout
      if (window.Cashfree) {
        // Mode must match the server environment — prod keys against the sandbox
        // gateway (or vice versa) will fail. The server selects env from NODE_ENV
        // in services/cashfreeServices.js, so we derive the client mode the same way.
        const mode = import.meta.env.PROD ? 'production' : 'sandbox';
        const cashfree = window.Cashfree({ mode });
        let checkoutOptions = {
          paymentSessionId: paymentSessionId,
          redirectTarget: "_self"
        };
        showToast("Opening secure checkout portal...", "success");
        // With redirectTarget "_self" the browser is redirected to the return_url
        // (the /payment-status SPA route), so this promise may never resolve —
        // the SPA unloads. If it DOES resolve (e.g. popup mode), route through the
        // same status page for a consistent confirmation UX.
        await cashfree.checkout(checkoutOptions);
        navigate(`/payment-status?orderId=${orderId}`);
      } else {
        // Fallback for environment check failures (dev SDK not loaded)
        showToast("Cashfree checkout SDK loaded incorrectly. Simulating success...", "warning");
        setTimeout(() => {
          navigate(`/payment-status?orderId=${orderId}`);
        }, 1500);
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Error processing transaction', 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  // Demo checkout: settle the fake order on the server, then land on the same
  // status page the real Cashfree redirect uses. `?simulate=failure` flips the
  // order to Failure (it sticks — later plain polls keep it failed), so the
  // failure UX is demonstrable too.
  const handleDemoPay = async (simulateFailure) => {
    const { orderId } = demoCheckout;
    setDemoCheckout(null);
    if (simulateFailure) {
      try {
        await axios.get(`/api/pay/${orderId}?simulate=failure`);
      } catch (err) {
        console.error('Demo failure simulation failed:', err);
      }
    }
    navigate(`/payment-status?orderId=${orderId}`);
  };

  // Estimated charge for the demo modal (display only — the server computed
  // the authoritative amount when it created the order).
  const demoEstimate = (() => {
    if (!demoCheckout || !service) return 0;
    const tip = parseFloat(tipAmount);
    return (parseFloat(service.price) || 0) + (!Number.isNaN(tip) && tip > 0 ? tip : 0);
  })();

  return (
    <div className="container page-shell">
      <div className="page-head">
        <h1 className="dashboard-title">Configure Booking</h1>
      </div>

      {fetchLoading ? (
        <SkeletonCardGrid count={2} />
      ) : fetchError ? (
        <div className="empty-state">
          <CreditCard size={48} />
          <h3>Couldn't load this booking</h3>
          <p>The service or salon couldn't be found. It may have been removed.</p>
          <Link to="/customer/dashboard" className="btn btn-primary btn-sm">Back to salons</Link>
        </div>
      ) : service && salon ? (
        <div className="booking-grid">
          {/* Left panel: Date/Time settings */}
          <div className="booking-panel">
            <h3 className="panel-title">Select date &amp; time slot</h3>
            <form onSubmit={handleCheckAvailability} className="form-stack">
              <div className="form-group">
                <label className="form-label">Available Date</label>
                <div className="date-selector-grid" role="group" aria-label="Available dates">
                  {dates.map(date => {
                    const dateObj = new Date(date + 'T00:00:00');
                    const isSelected = selectedDate === date;
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => {
                          setSelectedDate(date);
                          // Slot changed — previous availability check is stale.
                          setAvailableStaff([]);
                          setSelectedStaffId('');
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`}
                        className={`slot-btn ${isSelected ? 'selected' : ''}`}
                      >
                        <span style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>{dateObj.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>{dateObj.getDate()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Time Slot (Working Hours: {salon.openingTime?.slice(0,5)} - {salon.closingTime?.slice(0,5)})</label>
                <div className="time-selector-grid" role="group" aria-label="Time slots">
                  {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'].map(time => {
                    const isSelected = selectedTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => {
                          setSelectedTime(time);
                          // Slot changed — previous availability check is stale.
                          setAvailableStaff([]);
                          setSelectedStaffId('');
                        }}
                        aria-pressed={isSelected}
                        className={`slot-btn ${isSelected ? 'selected' : ''}`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={checkingAvailability}
                className="btn btn-primary"
              >
                {checkingAvailability ? 'Checking slots…' : 'Check available staff'}
              </button>
            </form>

            {availableStaff.length > 0 ? (
              <div style={{ marginTop: 'var(--space-sm)' }}>
                <h3 className="panel-title">Select Assigned Therapist</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                  {availableStaff.map(staff => {
                    const isSelected = selectedStaffId === staff.id;
                    return (
                      <button
                        key={staff.id}
                        type="button"
                        onClick={() => setSelectedStaffId(staff.id)}
                        aria-pressed={isSelected}
                        className={`staff-select-card ${isSelected ? 'selected' : ''}`}
                      >
                        <span className="profile-avatar staff-avatar" aria-hidden="true">
                          {staff.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="staff-meta">
                          <span className="staff-name">{staff.name}</span>
                          <span className="staff-phone">{staff.phoneNumber}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--color-paper)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', textAlign: 'center', marginTop: 'var(--space-sm)' }}>
                Select a slot above and search for available staff members.
              </div>
            )}
          </div>

          {/* Right panel: Summary */}
          <div className="booking-panel" style={{ height: 'fit-content' }}>
            <h3 className="panel-title">Summary & Checkout</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-rule)', paddingBottom: 'var(--space-xs)' }}>
                <span style={{ color: 'var(--color-ink-2)' }}>Salon</span>
                <strong>{salon.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-rule)', paddingBottom: 'var(--space-xs)' }}>
                <span style={{ color: 'var(--color-ink-2)' }}>Service</span>
                <strong>{service.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-rule)', paddingBottom: 'var(--space-xs)' }}>
                <span style={{ color: 'var(--color-ink-2)' }}>Duration</span>
                <span>{service.duration} mins</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-rule)', paddingBottom: 'var(--space-xs)' }}>
                <span style={{ color: 'var(--color-ink-2)' }}>Date / Time</span>
                <span>{selectedDate} @ {selectedTime}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-rule)', paddingBottom: 'var(--space-xs)' }}>
                <span style={{ color: 'var(--color-ink-2)' }}>Amount Due</span>
                <span className="summary-amount">₹{service.price}{Number(tipAmount) > 0 ? ` + ₹${Number(tipAmount)} tip` : ''}</span>
              </div>

              {/* Booking extras (#23 note · #25 party size · #26 tip) */}
              <div className="booking-extras">
                <div className="form-group" style={{ marginBottom: 'var(--space-xs)' }}>
                  <label htmlFor="booking-note" className="form-label">
                    Note for the salon <span className="char-counter">{customerNote.length}/{NOTE_MAX}</span>
                  </label>
                  <textarea
                    id="booking-note"
                    className="form-textarea"
                    rows={3}
                    maxLength={NOTE_MAX}
                    placeholder="e.g. Please use hypoallergenic products; running 5 minutes late."
                    value={customerNote}
                    onChange={e => setCustomerNote(e.target.value.slice(0, NOTE_MAX))}
                  />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="party-size" className="form-label">Party size (1–20)</label>
                    <input
                      id="party-size"
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      className="form-input form-input--plain"
                      value={partySize}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setPartySize(Number.isNaN(v) ? '' : Math.min(20, Math.max(1, v)));
                      }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="tip-amount" className="form-label">Tip (optional)</label>
                    <input
                      id="tip-amount"
                      type="number"
                      min="0"
                      step="1"
                      className="form-input form-input--plain"
                      placeholder="0"
                      value={tipAmount}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setTipAmount(e.target.value === '' ? '' : String(Math.max(0, v)));
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handlePayAndBook}
              disabled={bookingLoading || !selectedStaffId}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 'var(--space-sm)' }}
            >
              <CreditCard size={20} />
              {bookingLoading ? 'Launching Checkout...' : 'Secure Pay & Confirm'}
            </button>

            {/* Fail-safe Simulator button during local testing */}
            {import.meta.env.DEV && (
              <button
                onClick={async () => {
                  if (!selectedStaffId) return showToast('Please select staff', 'error');
                  setBookingLoading(true);
                  try {
                    const res = await axios.post('/api/pay/', buildPaymentPayload());
                    const { orderId } = res.data;
                    await axios.get(`/api/pay/${orderId}`);
                    showToast("Local simulator payment success!", "success");
                    navigate('/customer/bookings');
                  } catch (simErr) {
                    showToast("Local simulator booking error", "error");
                  } finally {
                    setBookingLoading(false);
                  }
                }}
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', marginTop: 'var(--space-2xs)', borderStyle: 'dashed' }}
              >
                Simulate Secure Booking (Fast Dev Bypass)
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Demo checkout — shown when the backend has no Cashfree credentials
          (or PAYMENTS_MODE=demo). Simulates the gateway so the full
          book → pay → confirm flow works without real keys. */}
      <Modal
        open={!!demoCheckout}
        onClose={() => setDemoCheckout(null)}
        title="Demo checkout"
      >
        <div style={{ textAlign: 'center', padding: 'var(--space-xs) 0' }}>
          <AlertCircle size={48} style={{ color: 'var(--color-accent)', marginBottom: 'var(--space-sm)' }} />
          <p style={{ color: 'var(--color-ink-2)', marginBottom: 'var(--space-3xs)' }}>
            This deployment runs payments in <strong>demo mode</strong> — no Cashfree
            keys are configured, so no real money moves.
          </p>
          <p className="summary-amount" style={{ fontSize: 'var(--text-2xl)', margin: 'var(--space-md) 0 var(--space-3xs)' }}>
            ₹{demoEstimate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          <p style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-md)' }}>
            {service?.name} at {salon?.name}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => handleDemoPay(false)} className="btn btn-primary">
              Pay (simulate success)
            </button>
            <button onClick={() => handleDemoPay(true)} className="btn btn-secondary">
              Simulate failure
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
