import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { CreditCard } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';

export default function AppointmentBooking() {
  const showToast = useToast();
  const { salonId, serviceId } = useParams();
  const [service, setService] = useState(null);
  const [salon, setSalon] = useState(null);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableStaff, setAvailableStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const navigate = useNavigate();

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
      try {
        const servRes = await axios.get(`/api/salonsdashboard/services/get/${serviceId}`);
        setService(servRes.data);
        const salonRes = await axios.get(`/api/buisness/getsalonbyId?salonId=${salonId}`);
        setSalon(salonRes.data);
      } catch (err) {
        console.error('Error fetching appointment data details', err);
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
      setAvailableStaff(res.data);
      if (res.data.length > 0) {
        setSelectedStaffId(res.data[0].id);
        showToast('Staff slots checked successfully!', 'success');
      } else {
        setSelectedStaffId('');
        showToast('No staff members available for this slot.', 'error');
      }
    } catch (err) {
      showToast('Error checking slot availability', 'error');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handlePayAndBook = async () => {
    if (!selectedStaffId) {
      showToast('Please select an available staff member first', 'error');
      return;
    }
    setBookingLoading(true);
    try {
      // 1. Call Payment Endpoint to generate cashfree transaction
      const paymentPayload = {
        servicePrice: service.price,
        dateSelect: selectedDate,
        time: selectedTime,
        staffId: parseInt(selectedStaffId),
        serviceId: parseInt(serviceId),
        salonId: parseInt(salonId),
        duration: service.duration
      };

      const res = await axios.post('/api/pay/', paymentPayload);
      const { paymentSessionId, orderId } = res.data;

      // 2. Launch Cashfree SDK checkout
      if (window.Cashfree) {
        const cashfree = window.Cashfree({ mode: "sandbox" });
        let checkoutOptions = {
          paymentSessionId: paymentSessionId,
          redirectTarget: "_self"
        };
        showToast("Opening secure checkout portal...", "success");
        await cashfree.checkout(checkoutOptions);
      } else {
        // Fallback for environment check failures
        showToast("Cashfree checkout SDK loaded incorrectly. Simulating success...", "warning");
        setTimeout(async () => {
          try {
            await axios.get(`/api/pay/${orderId}`);
            showToast("Simulated payment success!", "success");
            navigate('/customer/bookings');
          } catch (paymentErr) {
            showToast("Failed to simulate status check", "error");
          }
        }, 1500);
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Error processing transaction', 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <h1 className="dashboard-title" style={{ marginBottom: '24px' }}>Configure Booking</h1>

      {service && salon && (
        <div className="booking-grid">
          {/* Left panel: Date/Time settings */}
          <div className="booking-panel">
            <h3 className="panel-title">Select date &amp; time slot</h3>
            <form onSubmit={handleCheckAvailability} className="form-stack">
              <div className="form-group">
                <label className="form-label">Available Date</label>
                <div className="date-selector-grid">
                  {dates.map(date => {
                    const dateObj = new Date(date);
                    const isSelected = selectedDate === date;
                    return (
                      <div
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`slot-btn ${isSelected ? 'selected' : ''}`}
                      >
                        <div style={{ fontSize: '12px', opacity: 0.8 }}>{dateObj.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{dateObj.getDate()}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Time Slot (Working Hours: {salon.openingTime?.slice(0,5)} - {salon.closingTime?.slice(0,5)})</label>
                <div className="time-selector-grid">
                  {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'].map(time => {
                    const isSelected = selectedTime === time;
                    return (
                      <div
                        key={time}
                        onClick={() => setSelectedTime(time)}
                        className={`slot-btn ${isSelected ? 'selected' : ''}`}
                      >
                        {time}
                      </div>
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
              <div style={{ marginTop: '16px' }}>
                <h3 className="panel-title">Select Assigned Therapist</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {availableStaff.map(staff => {
                    const isSelected = selectedStaffId === staff.id;
                    return (
                      <div
                        key={staff.id}
                        onClick={() => setSelectedStaffId(staff.id)}
                        className={`staff-select-card ${isSelected ? 'selected' : ''}`}
                      >
                        <div className="profile-avatar staff-avatar">
                          {staff.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="staff-meta">
                          <div className="staff-name">{staff.name}</div>
                          <div className="staff-phone">{staff.phoneNumber}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--bg-primary)', padding: '16px', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', marginTop: '16px' }}>
                Select a slot above and search for available staff members.
              </div>
            )}
          </div>

          {/* Right panel: Summary */}
          <div className="booking-panel" style={{ height: 'fit-content' }}>
            <h3 className="panel-title">Summary & Checkout</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Salon</span>
                <strong>{salon.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Service</span>
                <strong>{service.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                <span>{service.duration} mins</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Date / Time</span>
                <span>{selectedDate} @ {selectedTime}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Amount Due</span>
                <span className="summary-amount">₹{service.price}</span>
              </div>
            </div>

            <button
              onClick={handlePayAndBook}
              disabled={bookingLoading || !selectedStaffId}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: '16px' }}
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
                    const paymentPayload = {
                      servicePrice: service.price,
                      dateSelect: selectedDate,
                      time: selectedTime,
                      staffId: parseInt(selectedStaffId),
                      serviceId: parseInt(serviceId),
                      salonId: parseInt(salonId),
                      duration: service.duration
                    };
                    const res = await axios.post('/api/pay/', paymentPayload);
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
                style={{ width: '100%', marginTop: '8px', fontSize: '12px', borderStyle: 'dashed' }}
              >
                Simulate Secure Booking (Fast Dev Bypass)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
