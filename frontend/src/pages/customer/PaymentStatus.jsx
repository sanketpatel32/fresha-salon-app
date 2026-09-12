import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import './customer.css';

/**
 * Post-checkout landing page.
 *
 * Cashfree redirects the browser here after the customer completes (or
 * abandons) payment. We call the backend's GET /api/pay/:orderId to read the
 * authoritative status, show the customer a clear result, then send them on to
 * their bookings list.
 *
 * This replaces the old behaviour where return_url pointed directly at the
 * backend JSON endpoint, leaving the customer staring at raw JSON.
 */
export default function PaymentStatus() {
  useDocumentTitle('Payment Status');
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const navigate = useNavigate();
  const [state, setState] = useState('loading'); // 'loading' | 'success' | 'failed' | 'slot-taken' | 'error'
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!orderId) {
      setState('error');
      setDetail('No order id was returned with the redirect.');
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const res = await axios.get(`/api/pay/${orderId}`);
        if (cancelled) return;
        const status = res.data.paymentStatus;
        if (status === 'Success') {
          setState('success');
        } else if (status === 'Slot taken') {
          setState('slot-taken');
          setDetail('Your payment was received, but the slot was taken by another booking just before you finished. We will arrange a refund.');
        } else if (status === 'Failure') {
          setState('failed');
          setDetail('The payment did not go through. No charge was made.');
        } else {
          // Still Pending — the webhook may not have arrived yet. Wait briefly
          // and re-check once, since the booking can still materialize.
          setState('loading');
          setDetail('Confirming your payment with the gateway…');
          setTimeout(async () => {
            try {
              const res2 = await axios.get(`/api/pay/${orderId}`);
              if (cancelled) return;
              const s2 = res2.data.paymentStatus;
              if (s2 === 'Success') setState('success');
              else if (s2 === 'Slot taken') {
                setState('slot-taken');
                setDetail('Your payment was received, but the slot was taken by another booking just before you finished. We will arrange a refund.');
              } else if (s2 === 'Failure') {
                setState('failed');
                setDetail('The payment did not go through. No charge was made.');
              } else {
                // Genuinely still pending after a retry — treat as success-pending
                // so the customer isn't left on a spinner; the bookings page will
                // surface the stuck-payment banner if the booking never lands.
                setState('success');
                setDetail('Your payment is being confirmed. Check your bookings in a moment.');
              }
            } catch {
              if (!cancelled) setState('error');
            }
          }, 2500);
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setDetail('We could not confirm your payment. If you were charged, your booking will appear shortly.');
        }
      }
    };

    check();
    return () => { cancelled = true; };
  }, [orderId]);

  return (
    <div className="container page-shell" style={{ maxWidth: '560px' }}>
      {/* Workbench page header — serif headline over a hairline rule */}
      <div className="page-head">
        <h1 className="dashboard-title">Payment status</h1>
      </div>

      <div className="booking-panel" style={{ textAlign: 'center' }}>
        {state === 'loading' && (
          <>
            <Loader2 size={56} className="spinner-icon" style={{ marginBottom: 'var(--space-md)' }} />
            <h2 className="auth-title">Confirming your payment</h2>
            <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-2xs)' }}>{detail || 'One moment…'}</p>
          </>
        )}
        {state === 'success' && (
          <>
            <CheckCircle size={56} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-md)' }} />
            <h2 className="auth-title">Booking confirmed</h2>
            <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-2xs)' }}>{detail || 'Your appointment has been booked successfully.'}</p>
            <button onClick={() => navigate('/customer/bookings')} className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>View my bookings</button>
          </>
        )}
        {state === 'failed' && (
          <>
            <XCircle size={56} style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-md)' }} />
            <h2 className="auth-title">Payment failed</h2>
            <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-2xs)' }}>{detail}</p>
            <button onClick={() => navigate('/customer/dashboard')} className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>Back to salons</button>
          </>
        )}
        {state === 'slot-taken' && (
          <>
            <XCircle size={56} style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-md)' }} />
            <h2 className="auth-title">Slot no longer available</h2>
            <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-2xs)' }}>{detail}</p>
            <button onClick={() => navigate('/customer/dashboard')} className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>Book another time</button>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle size={56} style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-md)' }} />
            <h2 className="auth-title">Couldn't confirm payment</h2>
            <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-2xs)' }}>{detail || 'Please check your bookings — if you were charged, the booking will appear shortly.'}</p>
            <button onClick={() => navigate('/customer/bookings')} className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>Go to bookings</button>
          </>
        )}
      </div>
    </div>
  );
}
