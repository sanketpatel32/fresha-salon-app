import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calendar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import '../workbench.css';
import './staff.css';

/* Status-badge mapping (design.md): confirmed → success, pending → warning,
   completed → neutral, no-show/cancelled/declined → danger.
   Note: the admin and salon consoles still map completed → badge-info; this
   page follows the neutral mapping and the shared helper should converge on
   one of the two. */
const statusBadgeClass = (status) =>
  status === 'confirmed' ? 'badge-success'
    : status === 'pending' ? 'badge-warning'
      : status === 'completed' ? 'badge-secondary'
        : 'badge-danger';

/* Rows shown per page. The staff API returns the full schedule (no
   limit/offset), so paging happens client-side over the fetched list. */
const PAGE_SIZE = 15;

/* Staff Dashboard Component — Workbench family, single-view console. */
export default function StaffDashboard() {
  const { userSession } = useAuth();
  const showToast = useToast();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteApptId, setNoteApptId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleAppointments = appointments.slice(0, visibleCount);

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
    <div className="console-page">
      <div className="dashboard-header staff-page-head">
        <div>
          <h1 className="dashboard-title">Staff Console</h1>
          <p className="section-sub">Your assigned client schedules and booking details.</p>
        </div>
        <span className="badge badge-success">Duty: Active</span>
      </div>

      {loading ? (
        <SkeletonTable rows={4} cols={7} />
      ) : appointments.length === 0 ? (
        <div className="empty-state">
          <Calendar size={40} />
          <h3 className="empty-state-title">No assigned bookings</h3>
          <p className="empty-state-text">You don't have any customer appointments assigned for today.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="premium-table admin-table staff-table">
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
              {visibleAppointments.map(appt => (
                <tr key={appt.id}>
                  <td><strong>{appt.user?.name}</strong></td>
                  <td>{appt.service?.name}</td>
                  <td className="staff-cell-when">{appt.date} @ {appt.time} - {appt.endTime}</td>
                  <td className="staff-cell-review">
                    {appt.userReview ? (
                      <span className="staff-quote">"{appt.userReview}"</span>
                    ) : (
                      <span className="staff-review-empty">None</span>
                    )}
                  </td>
                  <td className="staff-cell-review">
                    {appt.staffReview ? (
                      <span className="staff-quote staff-quote--internal">"{appt.staffReview}"</span>
                    ) : (
                      <span className="staff-review-empty">None entered by manager</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${statusBadgeClass(appt.status)}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
                  <td>
                    <div className="staff-cell-actions">
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {visibleCount < appointments.length && (
        <div className="staff-load-more">
          <button
            onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
            className="btn btn-secondary"
          >
            Load more (showing {visibleCount} of {appointments.length})
          </button>
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
        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
          <button onClick={() => setShowNoteModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveNote} className="btn btn-primary btn-sm">Save Note</button>
        </div>
      </Modal>
    </div>
  );
}
