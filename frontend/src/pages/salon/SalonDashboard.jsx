import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Scissors, Activity, Calendar, ListFilter, UserCheck, Settings,
  CreditCard, CheckCircle, Clock, Plus, Edit, Trash2, Star
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/* Salon Dashboard for Partner Business Owners */
export default function SalonDashboard() {
  const { userSession } = useAuth();
  const showToast = useToast();
  useDocumentTitle('Salon Console');
  const [salon, setSalon] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'services', 'staff', 'details', 'appointments'

  // Dashboard Metrics
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [staffLoading, setStaffLoading] = useState(true);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);

  // Calendar state
  const [calendarWeek, setCalendarWeek] = useState(new Date().toISOString().slice(0, 10));
  const [calendarAppointments, setCalendarAppointments] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Services form state
  const [serviceName, setServiceName] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceDuration, setServiceDuration] = useState('30');
  const [serviceCategory, setServiceCategory] = useState('Other');
  const [editServiceId, setEditServiceId] = useState(null);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState(null);

  // Staff form state
  const [staffName, setStaffName] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedStaffServices, setSelectedStaffServices] = useState([]);
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Salon details form state
  const [salonName, setSalonName] = useState('');
  const [salonPhone, setSalonPhone] = useState('');
  const [salonAddress, setSalonAddress] = useState('');
  // Working days stored as a Set of lowercase day codes ('sun','mon',...) so
  // the value matches what the backend availabilityService expects. Previously
  // this was a free-text string, which was saved verbatim and broke the
  // salon-hours enforcement (validateSalonHours requires an array).
  const [salonDays, setSalonDays] = useState(new Set(['mon','tue','wed','thu','fri','sat']));
  const [salonOpen, setSalonOpen] = useState('');
  const [salonClose, setSalonClose] = useState('');
  const [salonRequiresApproval, setSalonRequiresApproval] = useState(false);

  // Staff review/notes state
  const [selectedApptId, setSelectedApptId] = useState(null);
  const [staffReviewText, setStaffReviewText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);

  // Blockout state
  const [blockouts, setBlockouts] = useState([]);
  const [showBlockoutModal, setShowBlockoutModal] = useState(false);
  const [blockoutStaffId, setBlockoutStaffId] = useState(null);
  const [blockoutDate, setBlockoutDate] = useState('');
  const [blockoutStart, setBlockoutStart] = useState('');
  const [blockoutEnd, setBlockoutEnd] = useState('');
  const [blockoutReason, setBlockoutReason] = useState('');

  const fetchSalonProfile = async () => {
    try {
      const res = await axios.get('/api/buisness/getsalonbyIdSalonId');
      setSalon(res.data);
      setSalonName(res.data.name || '');
      setSalonPhone(res.data.phoneNumber || '');
      setSalonAddress(res.data.address || '');
      // workingDays is stored as a JSON array of lowercase codes. Normalize on
      // load in case any legacy row holds capitalized/full-day strings.
      const rawDays = Array.isArray(res.data.workingDays) ? res.data.workingDays : ['mon','tue','wed','thu','fri','sat'];
      setSalonDays(new Set(rawDays.map(d => String(d).slice(0, 3).toLowerCase())));
      setSalonOpen(res.data.openingTime?.slice(0, 5) || '');
      setSalonClose(res.data.closingTime?.slice(0, 5) || '');
      setSalonRequiresApproval(res.data.requiresApproval || false);
    } catch (err) {
      console.error('Error fetching salon profile details', err);
    }
  };

  const fetchServices = async () => {
    setServicesLoading(true);
    try {
      const res = await axios.get('/api/salonsdashboard/services/getall');
      setServices(res.data);
    } catch (err) {
      console.error('Error fetching services', err);
    } finally {
      setServicesLoading(false);
    }
  };

  const fetchStaff = async () => {
    setStaffLoading(true);
    try {
      const res = await axios.get('/api/salonsdashboard/staff/getallstaff');
      setStaff(res.data);
    } catch (err) {
      console.error('Error fetching staff list', err);
    } finally {
      setStaffLoading(false);
    }
  };

  const fetchAppointments = async () => {
    setAppointmentsLoading(true);
    try {
      const res = await axios.get('/api/appointment/sceduledAppointments');
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching bookings', err);
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const res = await axios.get('/api/salonsdashboard/analytics');
      setAnalytics(res.data);
    } catch (err) {
      console.error('Error fetching analytics', err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const fetchCalendar = async (weekDate) => {
    setCalendarLoading(true);
    try {
      const res = await axios.get(`/api/salonsdashboard/calendar?week=${weekDate}`);
      setCalendarAppointments(res.data);
    } catch (err) {
      console.error('Error fetching calendar', err);
    } finally {
      setCalendarLoading(false);
    }
  };

  const fetchBlockouts = async () => {
    try {
      const res = await axios.get('/api/salonsdashboard/staff/blockouts');
      setBlockouts(res.data);
    } catch (err) {
      console.error('Error fetching blockouts', err);
    }
  };

  useEffect(() => {
    fetchSalonProfile();
    fetchServices();
    fetchStaff();
    fetchAppointments();
    fetchAnalytics();
    fetchBlockouts();
  }, []);

  // Services Management handlers
  const handleAddOrUpdateService = async (e) => {
    e.preventDefault();
    try {
      if (editServiceId) {
        await axios.put(`/api/salonsdashboard/services/update/${editServiceId}`, {
          name: serviceName,
          category: serviceCategory,
          price: parseFloat(servicePrice),
          duration: parseInt(serviceDuration),
          statusbar: 'active'
        });
        showToast('Service updated successfully!', 'success');
      } else {
        await axios.post('/api/salonsdashboard/services/add', {
          name: serviceName,
          category: serviceCategory,
          price: parseFloat(servicePrice),
          duration: parseInt(serviceDuration)
        });
        showToast('Service added successfully!', 'success');
      }
      setServiceName('');
      setServicePrice('');
      setServiceDuration('30');
      setServiceCategory('Other');
      setEditServiceId(null);
      fetchServices();
    } catch (err) {
      showToast('Error saving service information', 'error');
    }
  };

  const handleEditService = (service) => {
    setServiceName(service.name);
    setServicePrice(service.price);
    setServiceDuration(service.duration);
    setServiceCategory(service.category || 'Other');
    setEditServiceId(service.id);
  };

  const handleDeleteService = async (serviceId) => {
    setDeleteServiceTarget(serviceId);
  };

  const confirmDeleteService = async () => {
    try {
      await axios.delete(`/api/salonsdashboard/services/delete/${deleteServiceTarget}`);
      showToast('Service removed successfully', 'success');
      fetchServices();
    } catch (err) {
      showToast('Error removing service', 'error');
    } finally {
      setDeleteServiceTarget(null);
    }
  };

  // Staff Management handlers
  const handleAddStaff = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/salonsdashboard/staff/add', {
        name: staffName,
        phoneNumber: staffPhone,
        email: staffEmail,
        password: staffPassword
      });
      showToast('Staff member added successfully!', 'success');
      setStaffName('');
      setStaffPhone('');
      setStaffEmail('');
      setStaffPassword('');
      fetchStaff();
    } catch (err) {
      showToast('Error adding staff member', 'error');
    }
  };

  const toggleStaffStatus = async (staffId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await axios.put('/api/salonsdashboard/staff/updateStatus', {
        staffId,
        status: newStatus
      });
      showToast(`Staff status set to ${newStatus}`, 'success');
      fetchStaff();
    } catch (err) {
      showToast('Error updating status', 'error');
    }
  };

  const handleOpenAssign = (staffMember) => {
    setSelectedStaffId(staffMember.id);
    const assignedIds = staffMember.services?.map(s => s.id) || [];
    setSelectedStaffServices(assignedIds);
    setShowAssignModal(true);
  };

  const handleSaveAssignedServices = async () => {
    try {
      await axios.put(`/api/salonsdashboard/staff/assignServices?staffid=${selectedStaffId}`, {
        services: selectedStaffServices
      });
      showToast('Staff services assigned successfully!', 'success');
      setShowAssignModal(false);
      fetchStaff();
    } catch (err) {
      showToast('Failed to assign services', 'error');
    }
  };

  // Salon profile details update
  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!salon) return;
    if (salonDays.size === 0) {
      showToast('Select at least one working day.', 'error');
      return;
    }
    if (salonClose <= salonOpen) {
      showToast('Closing time must be after opening time.', 'error');
      return;
    }
    try {
      // Persist working days as an ordered array of lowercase codes, matching
      // the shape availabilityService.validateSalonHours expects.
      const DAY_ORDER = ['sun','mon','tue','wed','thu','fri','sat'];
      const workingDays = DAY_ORDER.filter(d => salonDays.has(d));
      await axios.put('/api/buisness/changeSalonDetail', {
        salonId: salon.id,
        name: salonName,
        phoneNumber: salonPhone,
        address: salonAddress,
        workingDays,
        openingTime: salonOpen,
        closingTime: salonClose,
        requiresApproval: salonRequiresApproval
      });
      showToast('Salon details updated successfully!', 'success');
      fetchSalonProfile();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update details', 'error');
    }
  };

  // Staff Review updates
  const handleOpenStaffNote = (apptId, currentNote) => {
    setSelectedApptId(apptId);
    setStaffReviewText(currentNote || '');
    setShowNoteModal(true);
  };

  const handleSaveStaffNote = async () => {
    try {
      await axios.put(`/api/appointment/staffreview/${selectedApptId}`, { review: staffReviewText });
      showToast('Therapist note saved successfully!', 'success');
      setShowNoteModal(false);
      fetchAppointments();
    } catch (err) {
      showToast('Failed to submit staff note', 'error');
    }
  };

  const handleApptStatus = async (apptId, newStatus) => {
    try {
      await axios.put(`/api/appointment/status/${apptId}`, { status: newStatus });
      showToast(`Appointment ${newStatus}.`, 'success');
      fetchAppointments();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const handleOpenBlockout = (staffId) => {
    setBlockoutStaffId(staffId);
    setBlockoutDate(new Date().toISOString().slice(0, 10));
    setBlockoutStart('12:00');
    setBlockoutEnd('13:00');
    setBlockoutReason('');
    setShowBlockoutModal(true);
  };

  const handleSaveBlockout = async () => {
    // Guard: a blockout that ends before it starts is nonsensical and the
    // availability checker would never match it.
    if (blockoutEnd <= blockoutStart) {
      showToast('End time must be after the start time.', 'error');
      return;
    }
    try {
      await axios.post('/api/salonsdashboard/staff/blockouts', {
        staffId: blockoutStaffId,
        date: blockoutDate,
        startTime: blockoutStart,
        endTime: blockoutEnd,
        reason: blockoutReason,
      });
      showToast('Blockout added.', 'success');
      setShowBlockoutModal(false);
      fetchBlockouts();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to add blockout', 'error');
    }
  };

  const handleRemoveBlockout = async (id) => {
    try {
      await axios.delete(`/api/salonsdashboard/staff/blockouts/${id}`);
      showToast('Blockout removed.', 'success');
      fetchBlockouts();
    } catch (err) {
      showToast('Failed to remove blockout', 'error');
    }
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar navigation */}
      <aside className="sidebar">
        {salon && (
          <div className="sidebar-profile">
            <div className="profile-avatar">
              <Scissors size={24} />
            </div>
            <div className="profile-info">
              <h4>{salon.name}</h4>
              <p>Business Owner</p>
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          <button onClick={() => setActiveTab('dashboard')} className={`btn sidebar-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Activity size={18} /> Dashboard Overview
          </button>
          <button onClick={() => setActiveTab('appointments')} className={`btn sidebar-nav-item ${activeTab === 'appointments' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Calendar size={18} /> Schedules ({appointments.length})
          </button>
          <button onClick={() => { setActiveTab('calendar'); fetchCalendar(calendarWeek); }} className={`btn sidebar-nav-item ${activeTab === 'calendar' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Calendar size={18} /> Calendar
          </button>
          <button onClick={() => setActiveTab('services')} className={`btn sidebar-nav-item ${activeTab === 'services' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <ListFilter size={18} /> Catalog Services
          </button>
          <button onClick={() => setActiveTab('staff')} className={`btn sidebar-nav-item ${activeTab === 'staff' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <UserCheck size={18} /> Manage Staff
          </button>
          <button onClick={() => setActiveTab('reviews')} className={`btn sidebar-nav-item ${activeTab === 'reviews' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Star size={18} /> Reviews
          </button>
          <button onClick={() => setActiveTab('details')} className={`btn sidebar-nav-item ${activeTab === 'details' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Settings size={18} /> Salon Settings
          </button>
        </nav>
      </aside>

      {/* Main console content */}
      <main className="main-content">

        {/* Tab 1: Overview */}
        {activeTab === 'dashboard' && (
          <>
            <div className="dashboard-header">
              <h2 className="dashboard-title">Console Dashboard</h2>
              <span className="badge badge-info">Partner Status: Active</span>
            </div>

            {analyticsLoading && !analytics ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading analytics...</div>
            ) : analytics ? (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon success"><CreditCard size={24} /></div>
                    <div>
                      <div className="stat-value">₹{Number(analytics.totalRevenue || 0).toLocaleString()}</div>
                      <div className="stat-label">Total Revenue (paid)</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon primary"><Calendar size={24} /></div>
                    <div>
                      <div className="stat-value">{Object.values(analytics.statusCounts).reduce((a, b) => a + b, 0)}</div>
                      <div className="stat-label">Total Bookings</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon accent"><CheckCircle size={24} /></div>
                    <div>
                      <div className="stat-value">{analytics.statusCounts.completed || 0}</div>
                      <div className="stat-label">Completed</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon warning"><Clock size={24} /></div>
                    <div>
                      <div className="stat-value">{(analytics.statusCounts.pending || 0) + (analytics.statusCounts.confirmed || 0)}</div>
                      <div className="stat-label">Upcoming</div>
                    </div>
                  </div>
                </div>

                <div className="grid-dashboard-split" style={{ marginTop: '24px' }}>
                  {/* Bar chart: bookings per day, last 7 days */}
                  <div className="booking-panel">
                    <h3 className="panel-title">Bookings — Last 7 Days</h3>
                    {(() => {
                      const data = analytics.bookingsPerDay || [];
                      const max = Math.max(1, ...data.map(d => d.count));
                      return (
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '160px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                          {data.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{d.count}</div>
                              <div style={{
                                width: '100%', maxWidth: '48px',
                                height: `${(d.count / max) * 120}px`,
                                minHeight: d.count > 0 ? '8px' : '2px',
                                background: d.count > 0 ? 'var(--primary)' : 'var(--border-color)',
                                borderRadius: '6px 6px 0 0',
                                transition: 'height 0.3s ease',
                              }} />
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Top services */}
                  <div className="booking-panel">
                    <h3 className="panel-title">Top Services</h3>
                    {(analytics.topServices || []).length === 0 ? (
                      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>No bookings yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
                        {(analytics.topServices || []).map((s, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge badge-info">{i + 1}</span>
                              <strong>{s.name}</strong>
                            </span>
                            <span style={{ color: 'var(--text-secondary)' }}>{s.count} booking{s.count === 1 ? '' : 's'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="booking-panel" style={{ marginTop: '24px' }}>
                  <h3 className="panel-title">Upcoming Client Bookings</h3>
                  {appointmentsLoading ? (
                    <SkeletonTable rows={3} cols={6} />
                  ) : appointments.filter(a => a.status === 'confirmed' || a.status === 'pending').length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No upcoming bookings.</div>
                  ) : (
                    <div className="table-container">
                      <table className="premium-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Service</th>
                            <th>Assigned Staff</th>
                            <th>Date / Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {appointments
                            .filter(a => a.status === 'confirmed' || a.status === 'pending')
                            .slice(0, 5)
                            .map(appt => (
                              <tr key={appt.id}>
                                <td>
                                  <strong>{appt.user?.name}</strong>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{appt.user?.phoneNumber}</div>
                                </td>
                                <td>{appt.service?.name}</td>
                                <td>{appt.staff?.name}</td>
                                <td>{appt.date} @ {appt.time}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Unable to load analytics.</div>
            )}
          </>
        )}

        {/* Tab 2: Appointments & Notes */}
        {activeTab === 'appointments' && (
          <>
            <div className="dashboard-header">
              <h2 className="dashboard-title">Appointment Schedules</h2>
            </div>

            {appointments.length === 0 ? (
              <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
                <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
                <h3>No Bookings</h3>
                <p style={{ color: 'var(--text-secondary)' }}>Your salon has no booked appointments yet.</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Customer Details</th>
                      <th>Service details</th>
                      <th>Assigned Therapist</th>
                      <th>Scheduled Slot</th>
                      <th>Status</th>
                      <th>Customer Feedback</th>
                      <th>Therapist Note</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map(appt => (
                      <tr key={appt.id}>
                        <td>
                          <strong>{appt.user?.name}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{appt.user?.phoneNumber}</div>
                        </td>
                        <td>{appt.service?.name}</td>
                        <td>{appt.staff?.name}</td>
                        <td>{appt.date} @ {appt.time}</td>
                        <td>
                          <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : 'badge-danger'}`}>
                            {appt.status || 'confirmed'}
                          </span>
                        </td>
                        <td>
                          {appt.userReview ? (
                            <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{appt.userReview}"</span>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No feedback</span>
                          )}
                        </td>
                        <td>
                          {appt.staffReview ? (
                            <span style={{ fontSize: '13px', fontStyle: 'italic', color: 'var(--primary)' }}>"{appt.staffReview}"</span>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None</span>
                          )}
                        </td>
                        <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {appt.status === 'pending' && (
                            <>
                              <button onClick={() => handleApptStatus(appt.id, 'confirmed')} className="btn btn-primary btn-sm">Accept</button>
                              <button onClick={() => handleApptStatus(appt.id, 'declined')} className="btn btn-danger btn-sm">Decline</button>
                            </>
                          )}
                          {appt.status === 'confirmed' && (
                            <button onClick={() => handleApptStatus(appt.id, 'completed')} className="btn btn-secondary btn-sm">Mark Complete</button>
                          )}
                          <button onClick={() => handleOpenStaffNote(appt.id, appt.staffReview)} className="btn btn-secondary btn-sm">
                            <Plus size={14} /> Staff Note
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'calendar' && (
          <>
            <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="dashboard-title">Weekly Schedule</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => {
                  const prev = new Date(calendarWeek);
                  prev.setDate(prev.getDate() - 7);
                  const prevStr = prev.toISOString().slice(0, 10);
                  setCalendarWeek(prevStr);
                  fetchCalendar(prevStr);
                }} className="btn btn-secondary btn-sm">← Prev Week</button>
                <button onClick={() => {
                  const next = new Date(calendarWeek);
                  next.setDate(next.getDate() + 7);
                  const nextStr = next.toISOString().slice(0, 10);
                  setCalendarWeek(nextStr);
                  fetchCalendar(nextStr);
                }} className="btn btn-secondary btn-sm">Next Week →</button>
              </div>
            </div>

            {(() => {
              // Compute the 7 days of the week containing calendarWeek.
              const base = new Date(calendarWeek);
              const dayOfWeek = (base.getDay() + 6) % 7;
              const monday = new Date(base);
              monday.setDate(base.getDate() - dayOfWeek);
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                return d.toISOString().slice(0, 10);
              });

              const staffRows = staff.length > 0 ? staff : [];

              if (calendarLoading) {
                return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading calendar...</div>;
              }

              if (staffRows.length === 0) {
                return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Add staff members to see the schedule grid.</div>;
              }

              return (
                <div style={{ overflowX: 'auto' }}>
                  <table className="premium-table" style={{ minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)' }}>Staff</th>
                        {days.map(d => (
                          <th key={d} style={{ textAlign: 'center' }}>
                            <div>{new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>{new Date(d).getDate()}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map(st => (
                        <tr key={st.id}>
                          <td style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)', fontWeight: 600 }}>{st.name}</td>
                          {days.map(d => {
                            const dayAppts = calendarAppointments.filter(a => a.staffId === st.id && a.date === d);
                            return (
                              <td key={d} style={{ verticalAlign: 'top', padding: '6px', minWidth: '120px' }}>
                                {dayAppts.length === 0 ? (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {dayAppts.map(a => (
                                      <div key={a.id} style={{
                                        background: a.status === 'cancelled' || a.status === 'declined' ? 'var(--bg-tertiary)' : 'var(--primary)',
                                        color: a.status === 'cancelled' || a.status === 'declined' ? 'var(--text-muted)' : 'white',
                                        padding: '4px 6px', borderRadius: '4px', fontSize: '11px',
                                        textDecoration: a.status === 'cancelled' || a.status === 'declined' ? 'line-through' : 'none',
                                      }} title={`${a.user?.name || ''} — ${a.service?.name || ''} (${a.status})`}>
                                        <div style={{ fontWeight: 600 }}>{a.time}</div>
                                        <div style={{ opacity: 0.9 }}>{a.user?.name || 'Customer'}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}

        {/* Tab 3: Services Catalog */}
        {activeTab === 'services' && (
          <div className="grid-with-sidebar">
            <div className="booking-panel">
              <h3 className="panel-title">Active Services menu</h3>
              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                {servicesLoading ? (
                  <SkeletonTable rows={3} cols={3} />
                ) : services.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    No services configured.
                  </div>
                ) : (
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Service Title</th>
                        <th>Duration</th>
                        <th>Price</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map(s => (
                        <tr key={s.id}>
                          <td><strong>{s.name}</strong></td>
                          <td>{s.duration} mins</td>
                          <td>₹{s.price}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleEditService(s)} aria-label={`Edit service ${s.name}`} className="btn btn-secondary btn-sm" style={{ padding: '6px' }}><Edit size={14} /></button>
                              <button onClick={() => handleDeleteService(s.id)} aria-label={`Delete service ${s.name}`} className="btn btn-danger btn-sm" style={{ padding: '6px' }}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="booking-panel" style={{ height: 'fit-content' }}>
              <h3 className="panel-title">{editServiceId ? 'Edit Service' : 'Add New Service'}</h3>
              <form onSubmit={handleAddOrUpdateService}>
                <div className="form-group">
                  <label htmlFor="service-name" className="form-label">Service Title</label>
                  <input id="service-name" type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Hair Styling" value={serviceName} onChange={e => setServiceName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="service-category" className="form-label">Category</label>
                  <select id="service-category" className="form-select" style={{ paddingLeft: '16px' }} value={serviceCategory} onChange={e => setServiceCategory(e.target.value)}>
                    <option value="Hair">Hair</option>
                    <option value="Spa & Massage">Spa & Massage</option>
                    <option value="Facial & Skin">Facial & Skin</option>
                    <option value="Nails">Nails</option>
                    <option value="Makeup">Makeup</option>
                    <option value="Bridal">Bridal</option>
                    <option value="Men's Grooming">Men's Grooming</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="service-price" className="form-label">Price (INR)</label>
                  <input id="service-price" type="number" min="1" step="1" className="form-input" style={{ paddingLeft: '16px' }} placeholder="500" value={servicePrice} onChange={e => setServicePrice(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="service-duration" className="form-label">Duration (Minutes)</label>
                  <select id="service-duration" className="form-select" style={{ paddingLeft: '16px' }} value={serviceDuration} onChange={e => setServiceDuration(e.target.value)}>
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes</option>
                    <option value="45">45 Minutes</option>
                    <option value="60">60 Minutes</option>
                    <option value="90">90 Minutes</option>
                    <option value="120">120 Minutes</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>Save Service</button>
                  {editServiceId && (
                    <button type="button" onClick={() => { setEditServiceId(null); setServiceName(''); setServicePrice(''); setServiceCategory('Other'); }} className="btn btn-secondary btn-sm">Cancel</button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: Staff members */}
        {activeTab === 'staff' && (
          <div className="grid-with-sidebar">
            <div className="booking-panel">
              <h3 className="panel-title">Therapist Directory</h3>
              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                {staffLoading ? (
                  <SkeletonTable rows={3} cols={4} />
                ) : staff.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    No staff members added.
                  </div>
                ) : (
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Therapist Details</th>
                        <th>Assigned Catalog Services</th>
                        <th>Duty Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map(st => (
                        <tr key={st.id}>
                          <td>
                            <strong>{st.name}</strong>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{st.email}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {st.services && st.services.map(ser => (
                                <span key={ser.id} className="badge badge-info" style={{ fontSize: '11px' }}>{ser.name}</span>
                              ))}
                              {(!st.services || st.services.length === 0) && (
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No assigned services</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => toggleStaffStatus(st.id, st.statusbar)}
                              aria-pressed={st.statusbar !== 'inactive'}
                              aria-label={`Staff status: ${st.statusbar || 'active'}. Click to toggle.`}
                              className={`badge ${st.statusbar === 'active' ? 'badge-success' : 'badge-danger'}`}
                              style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                            >
                              {st.statusbar || 'active'}
                            </button>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                              <button onClick={() => handleOpenAssign(st)} className="btn btn-secondary btn-sm">Assign</button>
                              <button onClick={() => handleOpenBlockout(st.id)} className="btn btn-secondary btn-sm">Block out</button>
                            </div>
                            {blockouts.filter(b => b.staffId === st.id).length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {blockouts.filter(b => b.staffId === st.id).map(b => (
                                  <span key={b.id} className="badge badge-warning" style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <span>{b.date} {b.startTime}-{b.endTime}{b.reason ? ` · ${b.reason}` : ''}</span>
                                    <button onClick={() => handleRemoveBlockout(b.id)} aria-label={`Remove blockout on ${b.date}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}>×</button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="booking-panel" style={{ height: 'fit-content' }}>
              <h3 className="panel-title">Add Therapist</h3>
              <form onSubmit={handleAddStaff}>
                <div className="form-group">
                  <label htmlFor="staff-name" className="form-label">Full Name</label>
                  <input id="staff-name" type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Dr. Rose" value={staffName} onChange={e => setStaffName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-phone" className="form-label">Phone Number</label>
                  <input id="staff-phone" type="tel" pattern="[0-9]{10}" title="Enter a 10-digit phone number" className="form-input" style={{ paddingLeft: '16px' }} placeholder="9876543210" value={staffPhone} onChange={e => setStaffPhone(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-email" className="form-label">Login Email</label>
                  <input id="staff-email" type="email" className="form-input" style={{ paddingLeft: '16px' }} placeholder="rose@glowsalon.com" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-password" className="form-label">Login Password</label>
                  <input id="staff-password" type="password" minLength={8} title="At least 8 characters" className="form-input" style={{ paddingLeft: '16px' }} placeholder="••••••••" value={staffPassword} onChange={e => setStaffPassword(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: '12px' }}>Save Staff Member</button>
              </form>
            </div>
          </div>
        )}

        {/* Tab: Reviews — aggregate rating + the customer reviews already cached */}
        {activeTab === 'reviews' && (
          <div className="booking-panel" style={{ maxWidth: '800px' }}>
            <h3 className="panel-title">Customer Reviews</h3>
            <div className="reviews-summary">
              <div className="reviews-summary-score">
                <Star size={28} fill="currentColor" />
                <span>{salon && salon.avgRating ? Number(salon.avgRating).toFixed(1) : '—'}</span>
              </div>
              <div className="reviews-summary-meta">
                <strong>{salon && salon.avgRating ? Number(salon.avgRating).toFixed(1) : 'No ratings yet'}</strong>
                <span>out of 5 · {salon ? salon.reviewCount : 0} review{(salon && salon.reviewCount) === 1 ? '' : 's'}</span>
              </div>
            </div>

            {appointmentsLoading ? (
              <SkeletonTable rows={3} cols={3} />
            ) : (() => {
              const reviewed = appointments
                .filter(a => a.rating || a.userReview)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
              return reviewed.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  No reviews yet. Reviews appear here once customers leave feedback on completed appointments.
                </div>
              ) : (
                <div className="reviews-list-owner">
                  {reviewed.map(a => (
                    <div key={a.id} className="review-card-owner">
                      <div className="review-card-owner-head">
                        <strong>{a.user?.name || 'Customer'}</strong>
                        {a.rating && (
                          <span className="review-stars" aria-label={`${a.rating} out of 5 stars`}>
                            {[1,2,3,4,5].map(n => (
                              <Star key={n} size={14} fill={n <= a.rating ? 'currentColor' : 'none'} />
                            ))}
                          </span>
                        )}
                      </div>
                      {a.userReview ? (
                        <p className="review-card-owner-text">“{a.userReview}”</p>
                      ) : (
                        <p className="review-card-owner-text" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Rating only — no written review.</p>
                      )}
                      <div className="review-card-owner-foot">
                        <span>{a.service?.name}</span>
                        <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Tab 5: Salon Profile Details */}
        {activeTab === 'details' && (
          <div className="booking-panel" style={{ maxWidth: '800px' }}>
            <h3 className="panel-title">Salon Settings</h3>
            <form onSubmit={handleSaveDetails} className="grid-two-col">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="salon-name-settings" className="form-label">Brand / Salon Name</label>
                <input id="salon-name-settings" type="text" className="form-input" style={{ paddingLeft: '16px' }} value={salonName} onChange={e => setSalonName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-phone-settings" className="form-label">Business Phone Number</label>
                <input id="salon-phone-settings" type="tel" pattern="[0-9]{10}" title="10-digit phone number" className="form-input" style={{ paddingLeft: '16px' }} value={salonPhone} onChange={e => setSalonPhone(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Working Days</label>
                <div className="weekday-checkboxes" role="group" aria-label="Working days">
                  {[
                    { code: 'sun', label: 'Sun' },
                    { code: 'mon', label: 'Mon' },
                    { code: 'tue', label: 'Tue' },
                    { code: 'wed', label: 'Wed' },
                    { code: 'thu', label: 'Thu' },
                    { code: 'fri', label: 'Fri' },
                    { code: 'sat', label: 'Sat' },
                  ].map(d => {
                    const checked = salonDays.has(d.code);
                    return (
                      <label key={d.code} className={`weekday-chip ${checked ? 'weekday-chip-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(salonDays);
                            if (e.target.checked) next.add(d.code); else next.delete(d.code);
                            setSalonDays(next);
                          }}
                        />
                        {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="salon-address-settings" className="form-label">Salon Address</label>
                <input id="salon-address-settings" type="text" className="form-input" style={{ paddingLeft: '16px' }} value={salonAddress} onChange={e => setSalonAddress(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-open" className="form-label">Opening Time</label>
                <input id="salon-open" type="time" className="form-input" style={{ paddingLeft: '16px' }} value={salonOpen} onChange={e => setSalonOpen(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-close" className="form-label">Closing Time</label>
                <input id="salon-close" type="time" className="form-input" style={{ paddingLeft: '16px' }} value={salonClose} onChange={e => setSalonClose(e.target.value)} required />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="requiresApproval"
                  checked={salonRequiresApproval}
                  onChange={e => setSalonRequiresApproval(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="requiresApproval" style={{ cursor: 'pointer' }}>
                  <strong>Require approval for new bookings</strong>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    When on, new paid bookings start as "pending" until a staff member or you accept them. When off, bookings are "confirmed" instantly.
                  </div>
                </label>
              </div>
              <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                <button type="submit" className="btn btn-primary">Save Salon Profile</button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Assign services modal */}
      <Modal open={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign Menu Services">
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Select services that this therapist can perform.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
          {services.map(ser => {
            const isChecked = selectedStaffServices.includes(ser.id);
            return (
              <label key={ser.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    if (isChecked) {
                      setSelectedStaffServices(selectedStaffServices.filter(id => id !== ser.id));
                    } else {
                      setSelectedStaffServices([...selectedStaffServices, ser.id]);
                    }
                  }}
                />
                <span>{ser.name} (₹{ser.price})</span>
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
          <button onClick={() => setShowAssignModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveAssignedServices} className="btn btn-primary btn-sm">Save Assignments</button>
        </div>
      </Modal>

      {/* Staff Notes modal */}
      <Modal open={showNoteModal} onClose={() => setShowNoteModal(false)} title="Add Therapist notes">
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Leave internal instructions or review notes regarding the service.</p>
        <div className="form-group">
          <textarea
            className="form-textarea"
            placeholder="Client requested soft styling, noted..."
            value={staffReviewText}
            onChange={e => setStaffReviewText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={() => setShowNoteModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveStaffNote} className="btn btn-primary btn-sm">Save Note</button>
        </div>
      </Modal>

      <Modal open={showBlockoutModal} onClose={() => setShowBlockoutModal(false)} title="Block out staff time">
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Mark this staff member unavailable for a specific date and time range. Blocked slots won't show as bookable.</p>
        <div className="form-group">
          <label htmlFor="blockout-date" className="form-label">Date</label>
          <input id="blockout-date" type="date" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutDate} onChange={e => setBlockoutDate(e.target.value)} required />
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="blockout-start" className="form-label">Start time</label>
            <input id="blockout-start" type="time" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutStart} onChange={e => setBlockoutStart(e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="blockout-end" className="form-label">End time</label>
            <input id="blockout-end" type="time" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutEnd} onChange={e => setBlockoutEnd(e.target.value)} required />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="blockout-reason" className="form-label">Reason (optional)</label>
          <input id="blockout-reason" type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Lunch, leave, etc." value={blockoutReason} onChange={e => setBlockoutReason(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={() => setShowBlockoutModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveBlockout} className="btn btn-primary btn-sm">Save Blockout</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteServiceTarget !== null}
        title="Remove service?"
        message="This service will be removed from your catalog. Existing bookings are not affected."
        confirmLabel="Remove service"
        danger
        onConfirm={confirmDeleteService}
        onClose={() => setDeleteServiceTarget(null)}
      />
    </div>
  );
}
