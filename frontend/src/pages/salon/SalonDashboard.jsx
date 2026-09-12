import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Scissors, Activity, Calendar, ListFilter, UserCheck, Settings,
  CreditCard, CheckCircle, Clock, Plus, Edit, Trash2, Star, Bell,
  BarChart3, ListOrdered
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Modal from '../../components/Modal.jsx';
import NotificationsPanel from '../../components/NotificationsPanel.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import '../workbench.css';
import './salon.css';

/* Shared status-badge mapping (design.md): confirmed/paid → success,
   pending → warning, completed → accent (info), cancelled/declined → danger.
   Identical ternary on the admin, salon and staff consoles. */
const statusBadgeClass = (status) =>
  status === 'confirmed' ? 'badge-success'
    : status === 'pending' ? 'badge-warning'
      : status === 'completed' ? 'badge-info'
        : 'badge-danger';

/* Standard header right-slot badge — the same element on every console tab
   so all tab headers read as one pattern (h1 · hairline · partner status). */
const partnerStatusBadge = (
  <span className="badge badge-success">Partner Status: Active</span>
);

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

  // Local-timezone YYYY-MM-DD — UTC "today" (toISOString) is wrong between
  // local midnight and the UTC rollover (e.g. IST 00:00–05:30).
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Calendar state
  const [calendarWeek, setCalendarWeek] = useState(todayLocal());
  const [calendarAppointments, setCalendarAppointments] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Services form state
  const [serviceName, setServiceName] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceDuration, setServiceDuration] = useState('30');
  const [serviceCategory, setServiceCategory] = useState('Other');
  const [editServiceId, setEditServiceId] = useState(null);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState(null);
  const [savingService, setSavingService] = useState(false);

  // Staff form state
  const [staffName, setStaffName] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedStaffServices, setSelectedStaffServices] = useState([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);

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

  // Notifications tab — unread count is reported by NotificationsPanel itself.
  const [notifCount, setNotifCount] = useState(0);

  // Blockout state
  const [blockouts, setBlockouts] = useState([]);
  const [showBlockoutModal, setShowBlockoutModal] = useState(false);
  const [blockoutStaffId, setBlockoutStaffId] = useState(null);
  const [blockoutDate, setBlockoutDate] = useState('');
  const [blockoutStart, setBlockoutStart] = useState('');
  const [blockoutEnd, setBlockoutEnd] = useState('');
  const [blockoutReason, setBlockoutReason] = useState('');

  // Weekly working hours editor (#24) — 7 day rows from GET /hours, saved
  // wholesale via PUT. Keys are "0".."6" (Sun..Sat), values {open, close, closed}.
  const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];
  const DAY_NAMES = { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' };
  const [weeklyHours, setWeeklyHours] = useState(null);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);

  // Revenue & top-services analytics (#31) — inline SVG chart, no chart libs.
  const [revenueDays, setRevenueDays] = useState(30);
  const [revenueData, setRevenueData] = useState(null);
  const [topServicesWindow, setTopServicesWindow] = useState([]);
  const [revenueLoading, setRevenueLoading] = useState(false);

  // Waitlist day sheet (#30) — who is queued for a given date.
  const [waitlistDay, setWaitlistDay] = useState(todayLocal());
  const [dayWaitlist, setDayWaitlist] = useState([]);
  const [dayWaitlistLoading, setDayWaitlistLoading] = useState(false);

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

  // ── Weekly hours (#24) / analytics (#31) / waitlist day sheet (#30) ──────
  // Lazy-loaded on first tab visit, mirroring the Calendar tab's convention.
  const fetchHours = async () => {
    setHoursLoading(true);
    try {
      const res = await axios.get('/api/salonsdashboard/hours');
      // The endpoint always returns a complete effective schedule; normalize
      // defensively anyway so a malformed row can't crash the editor.
      const wh = res.data?.weeklyHours || {};
      const normalized = {};
      DAY_KEYS.forEach(k => {
        const d = wh[k] || {};
        normalized[k] = {
          open: typeof d.open === 'string' ? d.open.slice(0, 5) : '09:00',
          close: typeof d.close === 'string' ? d.close.slice(0, 5) : '17:00',
          closed: Boolean(d.closed),
        };
      });
      setWeeklyHours(normalized);
    } catch (err) {
      console.error('Error fetching working hours', err);
      showToast('Could not load working hours.', 'error');
    } finally {
      setHoursLoading(false);
    }
  };

  const handleHourChange = (key, field, value) => {
    setWeeklyHours(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleSaveHours = async () => {
    if (!weeklyHours) return;
    // Mirror the server schema client-side: open days need both times and
    // close after open.
    for (const k of DAY_KEYS) {
      const d = weeklyHours[k];
      if (!d.closed) {
        if (!d.open || !d.close) {
          showToast(`${DAY_NAMES[k]} needs both times, or mark it closed.`, 'error');
          return;
        }
        if (d.close <= d.open) {
          showToast(`Closing time must be after opening time on ${DAY_NAMES[k]}.`, 'error');
          return;
        }
      }
    }
    setHoursSaving(true);
    try {
      await axios.put('/api/salonsdashboard/hours', { weeklyHours });
      showToast('Working hours updated successfully!', 'success');
      fetchSalonProfile();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update working hours', 'error');
    } finally {
      setHoursSaving(false);
    }
  };

  const fetchRevenueAnalytics = async (days = revenueDays) => {
    setRevenueLoading(true);
    try {
      const [revRes, topRes] = await Promise.all([
        axios.get(`/api/salonsdashboard/analytics/revenue?days=${days}`),
        axios.get(`/api/salonsdashboard/analytics/top-services?days=${days}`),
      ]);
      setRevenueData(revRes.data || null);
      setTopServicesWindow(Array.isArray(topRes.data) ? topRes.data : []);
    } catch (err) {
      console.error('Error fetching revenue analytics', err);
      showToast('Could not load revenue analytics.', 'error');
      setRevenueData(null);
      setTopServicesWindow([]);
    } finally {
      setRevenueLoading(false);
    }
  };

  const fetchDayWaitlist = async (date = waitlistDay) => {
    if (!date) return;
    setDayWaitlistLoading(true);
    try {
      const res = await axios.get(`/api/salonsdashboard/waitlist?date=${date}`);
      setDayWaitlist(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching waitlist', err);
      setDayWaitlist([]);
    } finally {
      setDayWaitlistLoading(false);
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
    if (savingService) return;
    setSavingService(true);
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
    } finally {
      setSavingService(false);
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
    if (savingStaff) return;
    setSavingStaff(true);
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
    } finally {
      setSavingStaff(false);
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
      await axios.put('/api/salonsdashboard/staff/assignServices', {
        staffId: selectedStaffId,
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
    setBlockoutDate(todayLocal());
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
          <button onClick={() => setActiveTab('notifications')} className={`btn sidebar-nav-item ${activeTab === 'notifications' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Bell size={18} /> Notifications{notifCount > 0 ? ` (${notifCount})` : ''}
          </button>
          <button onClick={() => { setActiveTab('hours'); if (!weeklyHours) fetchHours(); }} className={`btn sidebar-nav-item ${activeTab === 'hours' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Clock size={18} /> Working Hours
          </button>
          <button onClick={() => { setActiveTab('analytics'); if (!revenueData) fetchRevenueAnalytics(); }} className={`btn sidebar-nav-item ${activeTab === 'analytics' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <BarChart3 size={18} /> Revenue Analytics
          </button>
          <button onClick={() => { setActiveTab('waitlist'); fetchDayWaitlist(); }} className={`btn sidebar-nav-item ${activeTab === 'waitlist' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <ListOrdered size={18} /> Waitlist
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
              <h1 className="dashboard-title">Console Dashboard</h1>
              {partnerStatusBadge}
            </div>

            {analyticsLoading && !analytics ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Loading analytics...</div>
            ) : analytics ? (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon"><CreditCard size={24} /></div>
                    <div>
                      <div className="stat-value">₹{Number(analytics.totalRevenue || 0).toLocaleString()}</div>
                      <div className="stat-label">Total Revenue (paid)</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon"><Calendar size={24} /></div>
                    <div>
                      <div className="stat-value">{Object.values(analytics.statusCounts).reduce((a, b) => a + b, 0)}</div>
                      <div className="stat-label">Total Bookings</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon"><CheckCircle size={24} /></div>
                    <div>
                      <div className="stat-value">{analytics.statusCounts.completed || 0}</div>
                      <div className="stat-label">Completed</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon"><Clock size={24} /></div>
                    <div>
                      <div className="stat-value">{(analytics.statusCounts.pending || 0) + (analytics.statusCounts.confirmed || 0)}</div>
                      <div className="stat-label">Upcoming</div>
                    </div>
                  </div>
                </div>

                <div className="grid-dashboard-split">
                  {/* Bar chart: bookings per day, last 7 days */}
                  <div className="booking-panel">
                    <h3 className="panel-title">Bookings — Last 7 Days</h3>
                    {(() => {
                      const data = analytics.bookingsPerDay || [];
                      const max = Math.max(1, ...data.map(d => d.count));
                      return (
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-xs)', height: '160px', padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--color-rule)' }}>
                          {data.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3xs)' }}>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{d.count}</div>
                              <div style={{
                                width: '100%', maxWidth: '48px',
                                height: `${(d.count / max) * 120}px`,
                                minHeight: d.count > 0 ? '8px' : '2px',
                                background: d.count > 0 ? 'var(--color-accent)' : 'var(--color-rule)',
                                borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
                              }} />
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
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
                      <div className="empty-state-text" style={{ padding: 'var(--space-xs) 0' }}>No bookings yet.</div>
                    ) : (
                      <div className="top-services-list">
                        {(analytics.topServices || []).map((s, i) => (
                          <div key={i} className="top-service-row">
                            <span className="top-service-main">
                              <span className="badge badge-secondary">{i + 1}</span>
                              <strong className="top-service-name">{s.name}</strong>
                            </span>
                            <span className="top-service-count">
                              <strong>{s.count}</strong>
                              booking{s.count === 1 ? '' : 's'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="booking-panel">
                  <h3 className="panel-title">Upcoming Client Bookings</h3>
                  {appointmentsLoading ? (
                    <SkeletonTable rows={3} cols={6} />
                  ) : appointments.filter(a => a.status === 'confirmed' || a.status === 'pending').length === 0 ? (
                    <div className="empty-state">No upcoming bookings.</div>
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
                                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{appt.user?.phoneNumber}</div>
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
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Unable to load analytics.</div>
            )}
          </>
        )}

        {/* Tab 2: Appointments & Notes */}
        {activeTab === 'appointments' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Appointment Schedules</h1>
              {partnerStatusBadge}
            </div>

            {appointments.length === 0 ? (
              <div className="empty-state">
                <Calendar size={40} />
                <h3 className="empty-state-title">No bookings</h3>
                <p className="empty-state-text">Your salon has no booked appointments yet.</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Customer Details</th>
                      <th>Service Details</th>
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
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{appt.user?.phoneNumber}</div>
                        </td>
                        <td>{appt.service?.name}</td>
                        <td>{appt.staff?.name}</td>
                        <td>{appt.date} @ {appt.time}</td>
                        <td>
                          <span className={`badge ${statusBadgeClass(appt.status)}`}>
                            {appt.status || 'confirmed'}
                          </span>
                        </td>
                        <td>
                          {appt.userReview ? (
                            <span style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-ink-2)' }}>"{appt.userReview}"</span>
                          ) : (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>No feedback</span>
                          )}
                        </td>
                        <td>
                          {appt.staffReview ? (
                            <span style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-accent)' }}>"{appt.staffReview}"</span>
                          ) : (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>None</span>
                          )}
                        </td>
                        <td>
                          <div className="appt-actions">
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
                          </div>
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
            <div className="dashboard-header">
              <h1 className="dashboard-title">Weekly Schedule</h1>
              <div className="salon-header-controls">
                {partnerStatusBadge}
                <div className="window-selector">
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
                return <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Loading calendar...</div>;
              }

              if (staffRows.length === 0) {
                return <div className="empty-state">Add staff members to see the schedule grid.</div>;
              }

              return (
                <div style={{ overflowX: 'auto' }}>
                  <table className="premium-table" style={{ minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--color-paper-2)' }}>Staff</th>
                        {days.map(d => (
                          <th key={d} style={{ textAlign: 'center' }}>
                            <div>{new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontWeight: 400 }}>{new Date(d + 'T00:00:00').getDate()}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map(st => (
                        <tr key={st.id}>
                          <td style={{ position: 'sticky', left: 0, background: 'var(--color-paper-2)', fontWeight: 600 }}>{st.name}</td>
                          {days.map(d => {
                            const dayAppts = calendarAppointments.filter(a => a.staffId === st.id && a.date === d);
                            return (
                              <td key={d} style={{ verticalAlign: 'top', padding: 'var(--space-3xs)', minWidth: '120px' }}>
                                {dayAppts.length === 0 ? (
                                  <span style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)' }}>—</span>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3xs)' }}>
                                    {dayAppts.map(a => (
                                      <div key={a.id} style={{
                                        background: a.status === 'cancelled' || a.status === 'declined' ? 'var(--color-paper-3)' : 'var(--color-accent)',
                                        color: a.status === 'cancelled' || a.status === 'declined' ? 'var(--color-ink-3)' : 'var(--color-accent-ink)',
                                        padding: 'var(--space-3xs)', borderRadius: 'var(--radius-2xs)', fontSize: 'var(--text-xs)',
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
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Catalog Services</h1>
              {partnerStatusBadge}
            </div>
            <div className="grid-with-sidebar">
              <div className="booking-panel">
                <h3 className="panel-title">Active Services Menu</h3>
              <div className="table-container table-flush">
                {servicesLoading ? (
                  <SkeletonTable rows={3} cols={3} />
                ) : services.length === 0 ? (
                  <div className="empty-state">
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
                            <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
                              <button onClick={() => handleEditService(s)} aria-label={`Edit service ${s.name}`} className="btn btn-secondary btn-sm"><Edit size={14} /></button>
                              <button onClick={() => handleDeleteService(s.id)} aria-label={`Delete service ${s.name}`} className="btn btn-danger btn-sm"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="booking-panel salon-side-panel">
              <h3 className="panel-title">{editServiceId ? 'Edit Service' : 'Add New Service'}</h3>
              <form onSubmit={handleAddOrUpdateService}>
                <div className="form-group">
                  <label htmlFor="service-name" className="form-label">Service Title</label>
                  <input id="service-name" type="text" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="Hair Styling" value={serviceName} onChange={e => setServiceName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="service-category" className="form-label">Category</label>
                  <select id="service-category" className="form-select" style={{ paddingLeft: 'var(--space-sm)' }} value={serviceCategory} onChange={e => setServiceCategory(e.target.value)}>
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
                  <input id="service-price" type="number" min="1" step="1" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="500" value={servicePrice} onChange={e => setServicePrice(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="service-duration" className="form-label">Duration (Minutes)</label>
                  <select id="service-duration" className="form-select" style={{ paddingLeft: 'var(--space-sm)' }} value={serviceDuration} onChange={e => setServiceDuration(e.target.value)}>
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes</option>
                    <option value="45">45 Minutes</option>
                    <option value="60">60 Minutes</option>
                    <option value="90">90 Minutes</option>
                    <option value="120">120 Minutes</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2xs)', marginTop: 'var(--space-sm)' }}>
                  <button type="submit" disabled={savingService} className="btn btn-primary btn-sm" style={{ flex: 1 }}>Save Service</button>
                  {editServiceId && (
                    <button type="button" onClick={() => { setEditServiceId(null); setServiceName(''); setServicePrice(''); setServiceCategory('Other'); }} className="btn btn-secondary btn-sm">Cancel</button>
                  )}
                </div>
              </form>
              </div>
            </div>
          </>
        )}

        {/* Tab 4: Staff members */}
        {activeTab === 'staff' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Manage Staff</h1>
              {partnerStatusBadge}
            </div>
            <div className="grid-with-sidebar">
            <div className="booking-panel">
              <h3 className="panel-title">Therapist Directory</h3>
              <div className="table-container table-flush">
                {staffLoading ? (
                  <SkeletonTable rows={3} cols={4} />
                ) : staff.length === 0 ? (
                  <div className="empty-state">
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
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{st.email}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3xs)' }}>
                              {st.services && st.services.map(ser => (
                                <span key={ser.id} className="badge badge-secondary">{ser.name}</span>
                              ))}
                              {(!st.services || st.services.length === 0) && (
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>No assigned services</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => toggleStaffStatus(st.id, st.statusbar)}
                              aria-pressed={st.statusbar !== 'inactive'}
                              aria-label={`Staff status: ${st.statusbar || 'active'}. Click to toggle.`}
                              className={`badge ${st.statusbar === 'active' ? 'badge-success' : 'badge-secondary'}`}
                              style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                            >
                              {st.statusbar || 'active'}
                            </button>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 'var(--space-3xs)', marginBottom: 'var(--space-2xs)' }}>
                              <button onClick={() => handleOpenAssign(st)} className="btn btn-secondary btn-sm">Assign</button>
                              <button onClick={() => handleOpenBlockout(st.id)} className="btn btn-secondary btn-sm">Block out</button>
                            </div>
                            {blockouts.filter(b => b.staffId === st.id).length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3xs)' }}>
                                {blockouts.filter(b => b.staffId === st.id).map(b => (
                                  <span key={b.id} className="badge badge-warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2xs)' }}>
                                    <span>{b.date} {b.startTime}-{b.endTime}{b.reason ? ` · ${b.reason}` : ''}</span>
                                    <button onClick={() => handleRemoveBlockout(b.id)} aria-label={`Remove blockout on ${b.date}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-2)', padding: 0 }}>×</button>
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

            <div className="booking-panel salon-side-panel">
              <h3 className="panel-title">Add Therapist</h3>
              <form onSubmit={handleAddStaff}>
                <div className="form-group">
                  <label htmlFor="staff-name" className="form-label">Full Name</label>
                  <input id="staff-name" type="text" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="Dr. Rose" value={staffName} onChange={e => setStaffName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-phone" className="form-label">Phone Number</label>
                  <input id="staff-phone" type="tel" pattern="[0-9]{10}" title="Enter a 10-digit phone number" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="9876543210" value={staffPhone} onChange={e => setStaffPhone(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-email" className="form-label">Login Email</label>
                  <input id="staff-email" type="email" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="rose@glowsalon.com" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-password" className="form-label">Login Password</label>
                  <input id="staff-password" type="password" minLength={8} title="At least 8 characters" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="••••••••" value={staffPassword} onChange={e => setStaffPassword(e.target.value)} required />
                </div>
                <button type="submit" disabled={savingStaff} className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 'var(--space-xs)' }}>Save Staff Member</button>
              </form>
              </div>
            </div>
          </>
        )}

        {/* Tab: Reviews — aggregate rating + the customer reviews already cached */}
        {activeTab === 'reviews' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Reviews</h1>
              {partnerStatusBadge}
            </div>
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
                <div className="empty-state">
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
                        <p className="review-card-owner-text" style={{ color: 'var(--color-ink-3)', fontStyle: 'italic' }}>Rating only — no written review.</p>
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
          </>
        )}

        {/* Tab: Notifications — shared panel (own notifications, mark read) */}
        {activeTab === 'notifications' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Notifications</h1>
              {partnerStatusBadge}
            </div>
            <div style={{ maxWidth: '800px' }}>
              <NotificationsPanel onUnreadChange={setNotifCount} />
            </div>
          </>
        )}

        {/* Tab: Working Hours (#24) — per-day weekly schedule editor */}
        {activeTab === 'hours' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Weekly Working Hours</h1>
              {partnerStatusBadge}
            </div>
            {hoursLoading ? (
              <SkeletonTable rows={7} cols={4} />
            ) : !weeklyHours ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Unable to load working hours.</div>
            ) : (
              <div className="booking-panel" style={{ maxWidth: '720px' }}>
                <h3 className="panel-title">Opening Times by Day</h3>
                <p className="section-sub" style={{ marginBottom: 'var(--space-sm)' }}>
                  Days marked closed ignore their times. Bookings outside these windows are rejected automatically.
                </p>
                <div className="hours-editor">
                  {DAY_KEYS.map(k => {
                    const d = weeklyHours[k];
                    return (
                      <div key={k} className={`hours-row ${d.closed ? 'hours-row-closed' : ''}`}>
                        <span className="hours-day">{DAY_NAMES[k]}</span>
                        <label className="hours-closed-toggle">
                          <input
                            type="checkbox"
                            checked={d.closed}
                            onChange={e => handleHourChange(k, 'closed', e.target.checked)}
                          />
                          Closed
                        </label>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[k]} opening time`}
                          className="form-input"
                          disabled={d.closed}
                          value={d.open}
                          onChange={e => handleHourChange(k, 'open', e.target.value)}
                        />
                        <span className="hours-dash">–</span>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[k]} closing time`}
                          className="form-input"
                          disabled={d.closed}
                          value={d.close}
                          onChange={e => handleHourChange(k, 'close', e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={handleSaveHours}
                  disabled={hoursSaving || hoursLoading}
                  className="btn btn-primary"
                  style={{ marginTop: 'var(--space-sm)' }}
                >
                  {hoursSaving ? 'Saving…' : 'Save Weekly Hours'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Tab: Revenue Analytics (#31) — inline SVG chart + top services */}
        {activeTab === 'analytics' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Revenue Analytics</h1>
              <div className="salon-header-controls">
                {partnerStatusBadge}
                <div className="window-selector" role="group" aria-label="Analytics window">
                  {[7, 30, 90].map(n => (
                    <button
                      key={n}
                      onClick={() => { setRevenueDays(n); fetchRevenueAnalytics(n); }}
                      aria-pressed={revenueDays === n}
                      className={`btn btn-sm ${revenueDays === n ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      {n} days
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {revenueLoading && !revenueData ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Loading analytics...</div>
            ) : !revenueData ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-ink-3)' }}>Unable to load revenue analytics.</div>
            ) : (() => {
              const series = revenueData.series || [];
              const totals = revenueData.totals || {};
              const W = 640; const H = 220; const PAD_X = 34; const PAD_Y = 24;
              const maxRev = Math.max(1, ...series.map(s => s.revenue));
              const stepX = series.length > 1 ? (W - PAD_X * 2) / (series.length - 1) : 0;
              const points = series.map((s, i) => {
                const x = PAD_X + i * stepX;
                const y = H - PAD_Y - (s.revenue / maxRev) * (H - PAD_Y * 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              });
              const linePath = points.length ? `M ${points.join(' L ')}` : '';
              const areaPath = points.length
                ? `M ${PAD_X},${H - PAD_Y} L ${points.join(' L ')} L ${(PAD_X + (series.length - 1) * stepX).toFixed(1)},${H - PAD_Y} Z`
                : '';
              const ticks = [0, Math.floor(series.length / 2), series.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
              return (
                <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-icon"><CreditCard size={24} /></div>
                      <div>
                        <div className="stat-value">₹{Number(totals.revenue || 0).toLocaleString()}</div>
                        <div className="stat-label">Revenue ({revenueDays}d, incl. tips)</div>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon"><CreditCard size={24} /></div>
                      <div>
                        <div className="stat-value">₹{Number(totals.tips || 0).toLocaleString()}</div>
                        <div className="stat-label">Tips</div>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon"><Calendar size={24} /></div>
                      <div>
                        <div className="stat-value">{totals.bookings || 0}</div>
                        <div className="stat-label">Paid bookings</div>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon"><CheckCircle size={24} /></div>
                      <div>
                        <div className="stat-value">₹{Number(totals.discounts || 0).toLocaleString()}</div>
                        <div className="stat-label">Promo discounts</div>
                      </div>
                    </div>
                  </div>

                  <div className="booking-panel">
                    <h3 className="panel-title">Daily Revenue — Last {revenueData.days} Days</h3>
                    <div className="revenue-chart">
                      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily revenue over the last ${revenueData.days} days`} preserveAspectRatio="none">
                        <line x1={PAD_X} y1={H - PAD_Y} x2={W - PAD_X / 2} y2={H - PAD_Y} className="rev-axis" />
                        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={H - PAD_Y} className="rev-axis" />
                        {areaPath && <path d={areaPath} className="rev-area" />}
                        {linePath && <path d={linePath} className="rev-line" />}
                        {!areaPath && (
                          <text x={W / 2} y={H / 2} textAnchor="middle" className="rev-empty-text">No paid bookings in this window</text>
                        )}
                        {ticks.map(i => {
                          const s = series[i];
                          if (!s) return null;
                          const x = PAD_X + i * stepX;
                          const label = new Date(`${s.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          return (
                            <text key={i} x={x} y={H - 6} textAnchor="middle" className="rev-tick-label">{label}</text>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  <div className="booking-panel">
                    <h3 className="panel-title">Top Services ({revenueDays}d, completed)</h3>
                    {topServicesWindow.length === 0 ? (
                      <div className="empty-state-text" style={{ padding: 'var(--space-xs) 0' }}>No completed bookings in this window yet.</div>
                    ) : (
                      <div className="top-services-list">
                        {topServicesWindow.map((s, i) => (
                          <div key={s.serviceId ?? i} className="top-service-row">
                            <span className="top-service-main">
                              <span className="badge badge-secondary">{i + 1}</span>
                              <strong className="top-service-name">{s.name}</strong>
                            </span>
                            <span className="top-service-count">
                              <strong>{s.bookings}</strong>
                              booking{s.bookings === 1 ? '' : 's'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </>
        )}

        {/* Tab: Waitlist day sheet (#30) */}
        {activeTab === 'waitlist' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Waitlist</h1>
              <div className="salon-header-controls">
                {partnerStatusBadge}
                <input
                  type="date"
                  aria-label="Waitlist date"
                  className="form-input salon-date-inline"
                  value={waitlistDay}
                  onChange={e => setWaitlistDay(e.target.value)}
                />
                <button onClick={() => fetchDayWaitlist()} className="btn btn-primary btn-sm" disabled={!waitlistDay}>
                  Load
                </button>
              </div>
            </div>

            <div className="booking-panel">
              <h3 className="panel-title">Queue for {waitlistDay || '—'}</h3>
              {dayWaitlistLoading ? (
                <SkeletonTable rows={3} cols={5} />
              ) : dayWaitlist.length === 0 ? (
                <div className="empty-state">
                  Nobody is waiting for this day.
                </div>
              ) : (
                <div className="table-container table-flush">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Customer</th>
                        <th>Party Size</th>
                        <th>Status</th>
                        <th>Notified At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayWaitlist.map((w, i) => (
                        <tr key={w.id}>
                          <td>{i + 1}</td>
                          <td><strong>{w.customerName || `User #${w.userId}`}</strong></td>
                          <td>{w.partySize || 1}</td>
                          <td>
                            <span className={`badge ${w.status === 'waiting' ? 'badge-warning' : w.status === 'notified' ? 'badge-success' : 'badge-secondary'}`}>
                              {w.status || 'waiting'}
                            </span>
                          </td>
                          <td>{w.notifiedAt ? new Date(w.notifiedAt).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tab 5: Salon Profile Details */}
        {activeTab === 'details' && (
          <>
            <div className="dashboard-header">
              <h1 className="dashboard-title">Salon Settings</h1>
              {partnerStatusBadge}
            </div>
            <div className="booking-panel" style={{ maxWidth: '800px' }}>
              <h3 className="panel-title">Business Profile</h3>
            <form onSubmit={handleSaveDetails} className="grid-two-col">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="salon-name-settings" className="form-label">Brand / Salon Name</label>
                <input id="salon-name-settings" type="text" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={salonName} onChange={e => setSalonName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-phone-settings" className="form-label">Business Phone Number</label>
                <input id="salon-phone-settings" type="tel" pattern="[0-9]{10}" title="10-digit phone number" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={salonPhone} onChange={e => setSalonPhone(e.target.value)} required />
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
                <input id="salon-address-settings" type="text" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={salonAddress} onChange={e => setSalonAddress(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-open" className="form-label">Opening Time</label>
                <input id="salon-open" type="time" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={salonOpen} onChange={e => setSalonOpen(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="salon-close" className="form-label">Closing Time</label>
                <input id="salon-close" type="time" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={salonClose} onChange={e => setSalonClose(e.target.value)} required />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <input
                  type="checkbox"
                  id="requiresApproval"
                  checked={salonRequiresApproval}
                  onChange={e => setSalonRequiresApproval(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="requiresApproval" style={{ cursor: 'pointer' }}>
                  <strong>Require approval for new bookings</strong>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)' }}>
                    When on, new paid bookings start as "pending" until a staff member or you accept them. When off, bookings are "confirmed" instantly.
                  </div>
                </label>
              </div>
              <div style={{ gridColumn: 'span 2', marginTop: 'var(--space-xs)' }}>
                <button type="submit" className="btn btn-primary">Save Salon Profile</button>
              </div>
            </form>
            </div>
          </>
        )}
      </main>

      {/* Assign services modal */}
      <Modal open={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign Menu Services">
        <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>Select services that this therapist can perform.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)', maxHeight: '250px', overflowY: 'auto' }}>
          {services.map(ser => {
            const isChecked = selectedStaffServices.includes(ser.id);
            return (
              <label key={ser.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2xs)', fontSize: 'var(--text-md)', cursor: 'pointer' }}>
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
        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
          <button onClick={() => setShowAssignModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveAssignedServices} className="btn btn-primary btn-sm">Save Assignments</button>
        </div>
      </Modal>

      {/* Staff Notes modal */}
      <Modal open={showNoteModal} onClose={() => setShowNoteModal(false)} title="Add Therapist Notes">
        <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>Leave internal instructions or review notes regarding the service.</p>
        <div className="form-group">
          <textarea
            className="form-textarea"
            placeholder="Client requested soft styling, noted..."
            value={staffReviewText}
            onChange={e => setStaffReviewText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
          <button onClick={() => setShowNoteModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={handleSaveStaffNote} className="btn btn-primary btn-sm">Save Note</button>
        </div>
      </Modal>

      <Modal open={showBlockoutModal} onClose={() => setShowBlockoutModal(false)} title="Block out staff time">
        <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>Mark this staff member unavailable for a specific date and time range. Blocked slots won't show as bookable.</p>
        <div className="form-group">
          <label htmlFor="blockout-date" className="form-label">Date</label>
          <input id="blockout-date" type="date" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={blockoutDate} onChange={e => setBlockoutDate(e.target.value)} required />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="blockout-start" className="form-label">Start time</label>
            <input id="blockout-start" type="time" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={blockoutStart} onChange={e => setBlockoutStart(e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="blockout-end" className="form-label">End time</label>
            <input id="blockout-end" type="time" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} value={blockoutEnd} onChange={e => setBlockoutEnd(e.target.value)} required />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="blockout-reason" className="form-label">Reason (optional)</label>
          <input id="blockout-reason" type="text" className="form-input" style={{ paddingLeft: 'var(--space-sm)' }} placeholder="Lunch, leave, etc." value={blockoutReason} onChange={e => setBlockoutReason(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
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
