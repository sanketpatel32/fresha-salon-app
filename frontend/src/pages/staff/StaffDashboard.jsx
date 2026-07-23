import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calendar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';

/* Staff Dashboard Component */
export default function StaffDashboard() {
  const { userSession } = useAuth();
  const showToast = useToast();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteApptId, setNoteApptId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);

  useEffect(() => {
    const fetchStaffSchedules = async () => {
      try {
        const res = await axios.get(`/api/staff/appointments?staffId=${userSession.id}`);
        setAppointments(res.data);
      } catch (err) {
        console.error('Error fetching schedules', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStaffSchedules();
  }, [userSession.id]);

  const handleStatusChange = async (apptId, newStatus) => {
    try {
      await axios.put(`/api/appointment/status/${apptId}`, { status: newStatus });
      showToast(`Appointment ${newStatus}.`, 'success');
      // refresh list
      const res = await axios.get(`/api/staff/appointments?staffId=${userSession.id}`);
      setAppointments(res.data);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const handleOpenNote = (apptId, currentNote) => {
    setNoteApptId(apptId);
    setNoteText(currentNote || '');
    setShowNoteModal(true);
  };

  const handleSaveNote = async () => {
    try {
      await axios.put(`/api/appointment/staffreview/${noteApptId}`, { review: noteText });
      showToast('Note saved.', 'success');
      setShowNoteModal(false);
      const res = await axios.get(`/api/staff/appointments?staffId=${userSession.id}`);
      setAppointments(res.data);
    } catch (err) {
      showToast('Failed to save note', 'error');
    }
  };

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div className="dashboard-header" style={{ marginBottom: '32px' }}>
        <div>
          <div>
            <h1 className="dashboard-title">Staff console</h1>
            <p className="section-sub">Your assigned client schedules and booking details.</p>
          </div>
        </div>
        <span className="badge badge-success">Duty: Active</span>
      </div>

      {loading ? (
        <SkeletonTable rows={4} cols={7} />
      ) : appointments.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No assigned bookings</h3>
          <p style={{ color: 'var(--text-secondary)' }}>You don't have any customer appointments assigned for today.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Requested Service</th>
                <th>Appointment Slot</th>
                <th>Customer Review Notes</th>
                <th>Internal Therapist Notes</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map(appt => (
                <tr key={appt.id}>
                  <td><strong>{appt.user?.name}</strong></td>
                  <td>{appt.service?.name}</td>
                  <td>{appt.date} @ {appt.time} - {appt.endTime}</td>
                  <td>
                    {appt.userReview ? (
                      <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{appt.userReview}"</span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None</span>
                    )}
                  </td>
                  <td>
                    {appt.staffReview ? (
                      <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--primary)' }}>"{appt.staffReview}"</span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None entered by manager</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : 'badge-danger'}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {appt.status === 'pending' && (
                      <>
                        <button onClick={() => handleStatusChange(appt.id, 'confirmed')} className="btn btn-primary btn-sm">Accept</button>
                        <button onClick={() => handleStatusChange(appt.id, 'declined')} className="btn btn-danger btn-sm">Decline</button>
                      </>
                    )}
                    {appt.status === 'confirmed' && (
                      <button onClick={() => handleStatusChange(appt.id, 'completed')} className="btn btn-secondary btn-sm">Mark Complete</button>
                    )}
                    <button onClick={() => handleOpenNote(appt.id, appt.staffReview)} className="btn btn-secondary btn-sm">
                      {appt.staffReview ? 'Edit Note' : 'Add Note'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={showNoteModal} onClose={() => setShowNoteModal(false)} title="Therapist Note">
        <div className="form-group">
          <label htmlFor="staff-note-text" className="form-label">Note</label>
          <textarea
            id="staff-note-text"
            className="form-textarea"
            placeholder="Service notes, client preferences, follow-up..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={() => setShowNoteModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveNote} className="btn btn-primary btn-sm">Save Note</button>
        </div>
      </Modal>
    </div>
  );
}
