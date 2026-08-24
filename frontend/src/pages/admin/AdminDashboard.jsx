import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Trash2, Search, CreditCard, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';

/* System Admin Dashboard Console */
export default function AdminDashboard() {
  const { userSession } = useAuth();
  const showToast = useToast();
  const [appointments, setAppointments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('bookings'); // 'bookings', 'users'
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'user'|'appointment', id }

  // Platform stats (#26/#27 additions): tips captured + outstanding loyalty
  // points. Non-2xx degrades to a hidden stats row, never a broken console.
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get('/api/admin/stats')
      .then(res => { if (!cancelled && res.data) setStats(res.data); })
      .catch(err => { console.error('Error fetching admin stats', err); });
    return () => { cancelled = true; };
  }, []);

  const fetchAllAppointments = async () => {
    setBookingsLoading(true);
    try {
      const res = await axios.get('/api/admin/appointments/getall');
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching admin appointments', err);
    } finally {
      setBookingsLoading(false);
    }
  };

  const handleSearchUsers = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.get(`/api/admin/users/search?searchTerm=${searchTerm}`);
      setUsers(res.data);
      if (res.data.length === 0) {
        showToast('No users found matching search term', 'error');
      }
    } catch (err) {
      showToast('Error searching users', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = (userId) => {
    setPendingDelete({ type: 'user', id: userId });
  };

  const handleDeleteAppointment = (apptId) => {
    setPendingDelete({ type: 'appointment', id: apptId });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { type, id } = pendingDelete;
    try {
      if (type === 'user') {
        await axios.delete(`/api/admin/users/${id}`);
        showToast('User removed successfully', 'success');
        setUsers(prev => prev.filter(u => u.id !== id));
        fetchAllAppointments();
      } else {
        await axios.delete(`/api/admin/appointments/${id}`);
        showToast('Appointment removed successfully', 'success');
        setAppointments(prev => prev.filter(a => a.id !== id));
      }
    } catch (err) {
      showToast(`Failed to delete ${type}`, 'error');
    } finally {
      setPendingDelete(null);
    }
  };

  useEffect(() => {
    fetchAllAppointments();
  }, []);

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div className="dashboard-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 className="dashboard-title">Admin console</h1>
          <p className="section-sub">Monitor active users and bookings across the platform.</p>
        </div>
      </div>

      {/* Platform stats — tips (#26) + outstanding loyalty points (#27) */}
      {stats && (
        <div className="stats-grid" style={{ marginBottom: '24px' }}>
          <div className="stat-card">
            <div className="stat-icon warning"><CreditCard size={24} /></div>
            <div>
              <div className="stat-value">₹{Number(stats.totalTips || 0).toLocaleString()}</div>
              <div className="stat-label">Tips captured (all time)</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon primary"><Star size={24} /></div>
            <div>
              <div className="stat-value">{Number(stats.totalLoyaltyOutstanding || 0).toLocaleString()}</div>
              <div className="stat-label">Loyalty points outstanding</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('bookings')} className={`btn ${activeTab === 'bookings' ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
          Manage Appointments ({appointments.length})
        </button>
        <button onClick={() => setActiveTab('users')} className={`btn ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
          Manage Users
        </button>
      </div>

      {activeTab === 'bookings' && (
        <div className="booking-panel">
          <h3 className="panel-title">Active Global Appointments</h3>
          {bookingsLoading ? (
            <SkeletonTable rows={4} cols={6} />
          ) : appointments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              No global schedules found.
            </div>
          ) : (
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Salon</th>
                    <th>Customer Name</th>
                    <th>Requested Service</th>
                    <th>Assigned Staff</th>
                    <th>Scheduled Slot</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map(appt => (
                    <tr key={appt.id}>
                      <td><strong>{appt.salon?.name}</strong></td>
                      <td>
                        <strong>{appt.user?.name}</strong>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{appt.user?.phoneNumber}</div>
                      </td>
                      <td>{appt.service?.name} (₹{appt.service?.price})</td>
                      <td>{appt.staff?.name}</td>
                      <td>{appt.date} @ {appt.time}</td>
                      <td>
                        <button onClick={() => handleDeleteAppointment(appt.id)} className="btn btn-danger btn-sm" style={{ padding: '6px' }}>
                          <Trash2 size={14} /> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="booking-panel">
          <h3 className="panel-title">User Accounts Directory</h3>
          <form onSubmit={handleSearchUsers} className="search-bar-container" style={{ margin: '16px 0 24px 0', maxWidth: '500px' }}>
            <div className="form-input-wrapper" style={{ flex: 1 }}>
              <Search className="form-input-icon" size={18} />
              <input
                type="text"
                className="form-input"
                placeholder="Search user by name, email or phone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
          </form>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}>Searching...</div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              Search directory to display user accounts.
            </div>
          ) : (
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Email Address</th>
                    <th>Phone Number</th>
                    <th>Created Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><strong>{u.name}</strong></td>
                      <td>{u.email}</td>
                      <td>{u.phoneNumber}</td>
                      <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button onClick={() => handleDeleteUser(u.id)} className="btn btn-danger btn-sm" style={{ padding: '6px' }}>
                          <Trash2 size={14} /> Delete User
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.type === 'user' ? 'Delete user?' : 'Delete appointment?'}
        message={
          pendingDelete?.type === 'user'
            ? 'This user will be permanently deleted. All their bookings will be cascade-removed. This cannot be undone.'
            : 'This appointment will be permanently deleted. This cannot be undone.'
        }
        confirmLabel={pendingDelete?.type === 'user' ? 'Delete user' : 'Delete appointment'}
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
