import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Scissors, Sparkles, Clock, User, Mail, Phone, MapPin, 
  Calendar, CreditCard, Lock, Plus, Edit, Trash2, LogOut, 
  Star, CheckCircle, AlertCircle, Eye, Settings, ShieldAlert, 
  Search, ListFilter, UserCheck, Activity, Award, Sun, Moon
} from 'lucide-react';


/* Global Axios Base URL setup */
axios.defaults.baseURL = window.location.origin;

// Global Axios request/response interceptors for automatic logout on token expiry
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('userId');
      localStorage.removeItem('salonId');
      localStorage.removeItem('staffId');
      window.location.href = '/user/login';
    }
    return Promise.reject(error);
  }
);


// Toast Notification helper
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isSuccess = type === 'success';
  const isError = type === 'error';

  return (
    <div className={`toast ${isSuccess ? 'toast-success' : isError ? 'toast-error' : ''}`}>
      {isSuccess && <CheckCircle size={20} className="text-success" />}
      {isError && <AlertCircle size={20} className="text-danger" />}
      <span>{message}</span>
    </div>
  );
}

export default function App() {
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [userSession, setUserSession] = useState({
    token: localStorage.getItem('token') || '',
    role: localStorage.getItem('role') || '', // 'customer', 'salon', 'staff', 'admin'
    id: localStorage.getItem('userId') || localStorage.getItem('salonId') || localStorage.getItem('staffId') || ''
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };


  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const handleLogin = (token, role, id) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    if (role === 'customer') localStorage.setItem('userId', id);
    else if (role === 'salon') localStorage.setItem('salonId', id);
    else if (role === 'staff') localStorage.setItem('staffId', id);
    
    setUserSession({ token, role, id });
    showToast(`Logged in successfully as ${role}!`, 'success');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('salonId');
    localStorage.removeItem('staffId');
    setUserSession({ token: '', role: '', id: '' });
    showToast('Logged out successfully.', 'success');
  };

  // Configure global axios headers
  useEffect(() => {
    if (userSession.token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${userSession.token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [userSession.token]);

  return (
    <BrowserRouter>
      <div className="app-wrapper">
        <Navbar session={userSession} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />
        
        <Routes>
          <Route path="/" element={<LandingPage />} />
          
          {/* Auth Routes */}
          <Route path="/user/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <UserLogin onLogin={handleLogin} showToast={showToast} />} />
          <Route path="/user/signup" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <UserSignup showToast={showToast} />} />
          <Route path="/buisness/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <SalonLogin onLogin={handleLogin} showToast={showToast} />} />
          <Route path="/buisness/signup" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <SalonSignup showToast={showToast} />} />
          <Route path="/staff/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <StaffLogin onLogin={handleLogin} showToast={showToast} />} />
          <Route path="/admin/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <AdminLogin onLogin={handleLogin} showToast={showToast} />} />

          {/* Protected Routes */}
          <Route path="/customer/dashboard" element={<ProtectedRoute session={userSession} allowedRole="customer"><CustomerDashboard session={userSession} /></ProtectedRoute>} />
          <Route path="/userdashboard" element={<Navigate to="/customer/dashboard" />} /> {/* Backward compatibility */}
          <Route path="/customer/edit-profile" element={<ProtectedRoute session={userSession} allowedRole="customer"><EditProfile session={userSession} showToast={showToast} /></ProtectedRoute>} />
          <Route path="/customer/salonservices/:salonId" element={<ProtectedRoute session={userSession} allowedRole="customer"><SalonServices /></ProtectedRoute>} />
          <Route path="/customer/book/:salonId/:serviceId" element={<ProtectedRoute session={userSession} allowedRole="customer"><AppointmentBooking session={userSession} showToast={showToast} /></ProtectedRoute>} />
          <Route path="/customer/bookings" element={<ProtectedRoute session={userSession} allowedRole="customer"><BookedAppointments session={userSession} showToast={showToast} /></ProtectedRoute>} />
          
          {/* Salon Owner Routes */}
          <Route path="/salon/dashboard" element={<ProtectedRoute session={userSession} allowedRole="salon"><SalonDashboard session={userSession} showToast={showToast} /></ProtectedRoute>} />
          <Route path="/salonsdashboard" element={<Navigate to="/salon/dashboard" />} /> {/* Backward compatibility */}
          
          {/* Staff Owner Routes */}
          <Route path="/staff/dashboard" element={<ProtectedRoute session={userSession} allowedRole="staff"><StaffDashboard session={userSession} showToast={showToast} /></ProtectedRoute>} />
          
          {/* Admin Routes */}
          <Route path="/admin/dashboard" element={<ProtectedRoute session={userSession} allowedRole="admin"><AdminDashboard session={userSession} showToast={showToast} /></ProtectedRoute>} />
          
          {/* Catch All Redirect */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </BrowserRouter>
  );
}

/* Protected Route Component */
function ProtectedRoute({ session, allowedRole, children }) {
  if (!session.token) {
    const loginRedirect = allowedRole === 'customer' ? '/user/login' 
                        : allowedRole === 'salon' ? '/buisness/login' 
                        : allowedRole === 'staff' ? '/staff/login' 
                        : '/admin/login';
    return <Navigate to={loginRedirect} />;
  }
  if (session.role !== allowedRole) {
    return <Navigate to="/" />;
  }
  return children;
}

/* Navbar Component */
function Navbar({ session, onLogout, theme, onToggleTheme }) {
  return (
    <header className="navbar">
      <div className="container nav-container">
        <Link to="/" className="nav-brand">
          <Scissors size={28} /> Fresha
        </Link>
        <nav className="nav-links">
          <Link to="/" className="nav-link">Home</Link>
          
          {session.token && session.role === 'customer' && (
            <>
              <Link to="/customer/dashboard" className="nav-link">Find Salons</Link>
              <Link to="/customer/bookings" className="nav-link">My Bookings</Link>
              <Link to="/customer/edit-profile" className="nav-link">Edit Profile</Link>
            </>
          )}

          {session.token && session.role === 'salon' && (
            <Link to="/salon/dashboard" className="nav-link">Business Console</Link>
          )}

          {session.token && session.role === 'staff' && (
            <Link to="/staff/dashboard" className="nav-link">Staff Console</Link>
          )}

          {session.token && session.role === 'admin' && (
            <Link to="/admin/dashboard" className="nav-link">Admin Console</Link>
          )}

          <button onClick={onToggleTheme} className="btn btn-secondary btn-icon-only" style={{ padding: '8px', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Toggle light/dark mode">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {session.token ? (
            <button onClick={onLogout} className="btn btn-secondary btn-sm">
              <LogOut size={16} /> Logout
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Link to="/user/login" className="btn btn-secondary btn-sm">Sign In</Link>
              <Link to="/buisness/login" className="btn btn-primary btn-sm">Business</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

/* Landing / Hero Page Component */
function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <section className="hero">
        <span className="hero-badge"><Sparkles size={14} style={{ marginRight: '4px' }} /> Discover & Book Beauty Services</span>
        <h1 className="hero-title">
          The Premium <span>Salon Experience</span> at Your Fingertips
        </h1>
        <p className="hero-subtitle">
          Book top-rated styling, hair, spa, and beauty professionals with absolute ease and secure payments.
        </p>
        <div className="hero-cta">
          <button onClick={() => navigate('/user/login')} className="btn btn-primary btn-lg">Explore as Customer</button>
          <button onClick={() => navigate('/buisness/signup')} className="btn btn-accent btn-lg">Join as Partner Salon</button>
        </div>

        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '32px', margin: '40px 0 10px 0' }}>Who Are You?</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Choose your workspace portal below</p>
        
        <div className="role-cards-grid">
          <div onClick={() => navigate('/user/login')} className="role-card">
            <div className="role-icon-wrapper">
              <User size={32} />
            </div>
            <h3>Customer</h3>
            <p>Search premium salons, book appointments, make secure payments and leave feedback.</p>
          </div>

          <div onClick={() => navigate('/buisness/login')} className="role-card">
            <div className="role-icon-wrapper">
              <Sparkles size={32} />
            </div>
            <h3>Salon Owner</h3>
            <p>Manage services, catalog listings, coordinate staff members, and track customer schedules.</p>
          </div>

          <div onClick={() => navigate('/staff/login')} className="role-card">
            <div className="role-icon-wrapper">
              <Scissors size={32} />
            </div>
            <h3>Salon Staff</h3>
            <p>Check assigned bookings, review appointment details, and look at customer service notes.</p>
          </div>

          <div onClick={() => navigate('/admin/login')} className="role-card">
            <div className="role-icon-wrapper">
              <ShieldAlert size={32} />
            </div>
            <h3>System Admin</h3>
            <p>Admin console to monitor global users, salon listings, and resolve bookings.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* User (Customer) Login */
function UserLogin({ onLogin, showToast }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/user/login', { email, password });
      onLogin(res.data.token, 'customer', res.data.userId);
      navigate('/customer/dashboard');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to login', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">Sign in to your customer account</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input 
                type="email" 
                required 
                className="form-input" 
                placeholder="you@example.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        <div className="form-footer">
          Don't have an account? <Link to="/user/signup" className="form-link">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}

/* User (Customer) Signup */
function UserSignup({ showToast }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/user/signup', { name, email, password, phoneNumber });
      showToast('Signup successful! Please sign in.', 'success');
      navigate('/user/login');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to sign up', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Create Account</h2>
          <p className="auth-subtitle">Register a new customer account</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input 
                type="text" 
                required 
                className="form-input" 
                placeholder="John Doe" 
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input 
                type="email" 
                required 
                className="form-input" 
                placeholder="john@example.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input 
                type="tel" 
                required 
                className="form-input" 
                placeholder="9876543210" 
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
        <div className="form-footer">
          Already have an account? <Link to="/user/login" className="form-link">Sign In</Link>
        </div>
      </div>
    </div>
  );
}

/* Salon Login */
function SalonLogin({ onLogin, showToast }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/buisness/login', { email, password });
      onLogin(res.data.token, 'salon', 'salon_owner');
      navigate('/salon/dashboard');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to login', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Partner Login</h2>
          <p className="auth-subtitle">Sign in to manage your salon business</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Business Email</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input 
                type="email" 
                required 
                className="form-input" 
                placeholder="business@salon.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-accent" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Logging in...' : 'Sign In as Partner'}
          </button>
        </form>
        <div className="form-footer">
          Want to partner with us? <Link to="/buisness/signup" className="form-link" style={{ color: 'var(--accent)' }}>Register Salon</Link>
        </div>
      </div>
    </div>
  );
}

/* Salon Signup */
function SalonSignup({ showToast }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [pricing, setPricing] = useState('Premium');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/buisness/signup', { name, email, password, phoneNumber, address, pricing });
      showToast('Salon registered successfully! Please sign in.', 'success');
      navigate('/buisness/login');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to register salon', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: '540px' }}>
        <div className="auth-header">
          <h2 className="auth-title">Salon registration</h2>
          <p className="auth-subtitle">Register your business to start booking customers</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Salon / Brand Name</label>
            <div className="form-input-wrapper">
              <Scissors className="form-input-icon" size={18} />
              <input 
                type="text" 
                required 
                className="form-input" 
                placeholder="Glow Hair & Spa" 
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Business Email</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input 
                type="email" 
                required 
                className="form-input" 
                placeholder="contact@glowsalon.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input 
                type="tel" 
                required 
                className="form-input" 
                placeholder="9876543210" 
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Address</label>
            <div className="form-input-wrapper">
              <MapPin className="form-input-icon" size={18} />
              <input 
                type="text" 
                required 
                className="form-input" 
                placeholder="123 Luxury Road, City Center" 
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Pricing Standard</label>
            <div className="form-input-wrapper">
              <CreditCard className="form-input-icon" size={18} />
              <select className="form-select" value={pricing} onChange={e => setPricing(e.target.value)}>
                <option value="Affordable">Affordable</option>
                <option value="Moderate">Moderate</option>
                <option value="Premium">Premium Luxury</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Secret Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-accent" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Registering...' : 'Register Salon Partner'}
          </button>
        </form>
        <div className="form-footer">
          Already registered? <Link to="/buisness/login" className="form-link" style={{ color: 'var(--accent)' }}>Sign In</Link>
        </div>
      </div>
    </div>
  );
}

/* Staff Login Component */
function StaffLogin({ onLogin, showToast }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/staff/login', { email, password });
      onLogin(res.data.token, 'staff', res.data.staffId);
      navigate('/staff/dashboard');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to login', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Staff Portal</h2>
          <p className="auth-subtitle">Login to check your daily client schedule</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Staff Email</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input 
                type="email" 
                required 
                className="form-input" 
                placeholder="staff@fresha.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-secondary" style={{ width: '100%', marginTop: '12px', background: 'var(--primary)', color: 'white' }}>
            {loading ? 'Logging in...' : 'Sign In as Staff'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* Admin Login Component */
function AdminLogin({ onLogin, showToast }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/admin/login', { email, password });
      onLogin(res.data.token, 'admin', 'system_admin');
      navigate('/admin/dashboard');
    } catch (err) {
      showToast(err.response?.data?.error || 'Invalid credentials', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <ShieldAlert size={28} className="text-danger" /> Admin Console
          </h2>
          <p className="auth-subtitle">Verify administrative authentication</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Admin Username</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input 
                type="text" 
                required 
                className="form-input" 
                placeholder="admin_id" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrapper">
              <Lock className="form-input-icon" size={18} />
              <input 
                type="password" 
                required 
                className="form-input" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-danger" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Authorizing...' : 'Log In to Console'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* Customer Dashboard */
function CustomerDashboard({ session }) {
  const [salons, setSalons] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [favoriteSalonIds, setFavoriteSalonIds] = useState(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSalons = async () => {
      try {
        const res = await axios.get('/api/buisness/getall');
        setSalons(res.data);
      } catch (err) {
        console.error('Error fetching salons', err);
      } finally {
        setLoading(false);
      }
    };
    const fetchFavorites = async () => {
      try {
        const res = await axios.get('/api/user/favorites');
        setFavoriteSalonIds(new Set(res.data.map(s => s.id)));
      } catch (err) {
        // Not logged in or no favorites — fine, ignore.
      }
    };
    fetchSalons();
    fetchFavorites();
  }, []);

  const toggleFavorite = async (salonId) => {
    const isFav = favoriteSalonIds.has(salonId);
    // Optimistic UI update
    const next = new Set(favoriteSalonIds);
    if (isFav) next.delete(salonId); else next.add(salonId);
    setFavoriteSalonIds(next);
    try {
      if (isFav) {
        await axios.delete(`/api/user/favorites/${salonId}`);
      } else {
        await axios.post('/api/user/favorites', { salonId });
      }
    } catch (err) {
      // Revert on failure
      setFavoriteSalonIds(favoriteSalonIds);
    }
  };

  const filteredSalons = salons
    .filter(salon => !showFavoritesOnly || favoriteSalonIds.has(salon.id))
    .filter(salon => 
      salon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      salon.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (salon.pricing && salon.pricing.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '40px', fontWeight: 800 }}>Explore Salons</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Choose a premium beauty partner salon near you</p>
        </div>
        <div className="search-bar-container">
          <div className="form-input-wrapper" style={{ flex: 1 }}>
            <Search className="form-input-icon" size={18} />
            <input 
              type="text" 
              className="form-input" 
              placeholder="Search salon name, location or pricing..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '48px' }}
            />
          </div>
        </div>
        <button
          onClick={() => setShowFavoritesOnly(v => !v)}
          className={`btn btn-sm ${showFavoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
          {showFavoritesOnly ? 'Showing Favorites' : 'Favorites'}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <h2>Finding partner salons...</h2>
        </div>
      ) : filteredSalons.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '40px' }}>
          <Scissors size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No Salons Found</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>We couldn't find any partner salons matching your filters.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {filteredSalons.map(salon => (
            <div key={salon.id} className="card">
              <div className="card-header-image" style={{ background: salon.pricing === 'Premium' ? 'linear-gradient(135deg, #7c3aed, #ec4899)' : salon.pricing === 'Affordable' ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #f59e0b, #d97706)', position: 'relative' }}>
                <span className="card-badge">{salon.pricing || 'Moderate'}</span>
                <Scissors size={40} style={{ opacity: 0.8 }} />
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(salon.id); }}
                  style={{
                    position: 'absolute', top: '8px', right: '8px',
                    background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%',
                    width: '32px', height: '32px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  title={favoriteSalonIds.has(salon.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star size={16} fill={favoriteSalonIds.has(salon.id) ? '#f59e0b' : 'none'} color="#f59e0b" />
                </button>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <h3 className="card-title" style={{ margin: 0 }}>{salon.name}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--warning)', fontWeight: 600 }}>
                    {salon.avgRating ? (
                      <>
                        <Star size={14} fill="currentColor" />
                        <span>{Number(salon.avgRating).toFixed(1)}</span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>({salon.reviewCount})</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>No ratings yet</span>
                    )}
                  </div>
                </div>
                <div className="card-info">
                  <MapPin size={16} />
                  <span>{salon.address}</span>
                </div>
                <div className="card-info">
                  <Phone size={16} />
                  <span>{salon.phoneNumber}</span>
                </div>
                {salon.openingTime && (
                  <div className="card-info" style={{ marginTop: '4px' }}>
                    <Clock size={16} />
                    <span>Open: {salon.openingTime.slice(0, 5)} - {salon.closingTime?.slice(0, 5)}</span>
                  </div>
                )}
              </div>
              <div className="card-footer">
                <button 
                  onClick={() => navigate(`/customer/salonservices/${salon.id}`)} 
                  className="btn btn-primary btn-sm" 
                  style={{ width: '100%' }}
                >
                  View Services
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Salon Services of Selected Salon */
function SalonServices() {
  const { salonId } = useParams();
  const [salon, setSalon] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const salonRes = await axios.get(`/api/buisness/getsalonbyId?salonId=${salonId}`);
        setSalon(salonRes.data);
        const servicesRes = await axios.get(`/api/userdashboard/getAllActiveServicesBySalonId?salonId=${salonId}`);
        setServices(servicesRes.data);
      } catch (err) {
        console.error('Error fetching services details', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [salonId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <h2>Loading salon catalog...</h2>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      {salon && (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '32px', marginBottom: '40px' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '42px', fontWeight: 800 }}>{salon.name}</h1>
          <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <MapPin size={16} /> {salon.address}
          </p>
          <div style={{ display: 'flex', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Star size={14} fill="currentColor" style={{ color: 'var(--warning)' }} />
              <strong>{salon.avgRating ? Number(salon.avgRating).toFixed(1) : 'New'}</strong>
              <span style={{ color: 'var(--text-muted)' }}>· {salon.reviewCount} review{salon.reviewCount === 1 ? '' : 's'}</span>
            </span>
            <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px' }}>
              <strong>Pricing standard:</strong> {salon.pricing || 'Premium'}
            </span>
            {salon.workingDays && (
              <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px' }}>
                <strong>Working days:</strong> {salon.workingDays}
              </span>
            )}
          </div>
        </div>
      )}

      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '28px', marginBottom: '20px' }}>Services Menu</h2>
      
      {services.length === 0 ? (
        <div className="auth-card" style={{ margin: '0 auto', textAlign: 'center', padding: '32px' }}>
          <Sparkles size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
          <h3>No services available</h3>
          <p style={{ color: 'var(--text-secondary)' }}>This salon has not listed any active services yet.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {services.map(service => (
            <div key={service.id} className="card">
              <div className="card-body" style={{ gap: '16px' }}>
                <h3 className="card-title" style={{ fontSize: '22px' }}>{service.name}</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                    <Clock size={16} /> {service.duration} mins
                  </span>
                  <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--primary)' }}>
                    ₹{service.price}
                  </span>
                </div>
              </div>
              <div className="card-footer">
                <button 
                  onClick={() => navigate(`/customer/book/${salonId}/${service.id}`)} 
                  className="btn btn-primary btn-sm" 
                  style={{ width: '100%' }}
                >
                  Book Appointment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Appointment Booking wizard & checkout */
function AppointmentBooking({ session, showToast }) {
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
            <h3 className="panel-title">Select Date & Time Slot</h3>
            <form onSubmit={handleCheckAvailability} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                className="btn btn-secondary" 
                style={{ alignSelf: 'flex-start', background: 'var(--primary)', color: 'white' }}
              >
                {checkingAvailability ? 'Checking slots...' : 'Check Available Staff'}
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
                        <div className="profile-avatar" style={{ width: '40px', height: '40px', fontSize: '14px' }}>
                          {staff.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: '600' }}>{staff.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{staff.phoneNumber}</div>
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
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--primary)' }}>₹{service.price}</span>
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

/* Edit Customer Profile */
function EditProfile({ session, showToast }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await axios.get('/api/user/profile');
        setName(res.data.name || '');
        setEmail(res.data.email || '');
        setPhoneNumber(res.data.phoneNumber || '');
      } catch (err) {
        console.error('Error loading profile', err);
      }
    };
    loadProfile();
  }, [session.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.put('/api/user/edit', { name, email, phoneNumber });
      showToast('Profile updated successfully!', 'success');
    } catch (err) {
      showToast('Failed to update profile details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: '60px 24px', maxWidth: '600px' }}>
      <div className="auth-card" style={{ maxWidth: '100%' }}>
        <div className="auth-header">
          <h2 className="auth-title">Edit Profile</h2>
          <p className="auth-subtitle">Keep your contact details up to date</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div className="form-input-wrapper">
              <User className="form-input-icon" size={18} />
              <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="form-input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-input-wrapper">
              <Phone className="form-input-icon" size={18} />
              <input type="tel" className="form-input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
            {loading ? 'Saving Changes...' : 'Save Profile Details'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* User Booked Appointments list & submit reviews */
function BookedAppointments({ session, showToast }) {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [selectedApptId, setSelectedApptId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [rating, setRating] = useState(0);

  const fetchBookings = async () => {
    try {
      const res = await axios.get(`/api/appointment/getAll?userId=${session.id}`);
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching appointments', err);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [session.id]);

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
    if (!confirm('Cancel this appointment? This cannot be undone.')) return;
    try {
      await axios.put(`/api/appointment/cancel/${apptId}`);
      showToast('Appointment cancelled.', 'success');
      fetchBookings();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to cancel appointment', 'error');
    }
  };

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <h1 className="dashboard-title" style={{ marginBottom: '24px' }}>My Appointments</h1>
      
      {appointments.length === 0 ? (
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
                    <button
                      onClick={() => handleOpenReview(appt.id, appt.userReview, appt.rating)}
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
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

      {showModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Write feedback</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Share your experience with the team.</p>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Your rating</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    title={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star size={28} fill={n <= rating ? '#f59e0b' : 'none'} color="#f59e0b" />
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <textarea 
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
          </div>
        </div>
      )}
    </div>
  );
}

/* Salon Dashboard for Partner Business Owners */
function SalonDashboard({ session, showToast }) {
  const [salon, setSalon] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'services', 'staff', 'details', 'appointments'
  
  // Dashboard Metrics
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Calendar state
  const [calendarWeek, setCalendarWeek] = useState(new Date().toISOString().slice(0, 10));
  const [calendarAppointments, setCalendarAppointments] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Services form state
  const [serviceName, setServiceName] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceDuration, setServiceDuration] = useState('30');
  const [editServiceId, setEditServiceId] = useState(null);

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
  const [salonDays, setSalonDays] = useState('');
  const [salonOpen, setSalonOpen] = useState('');
  const [salonClose, setSalonClose] = useState('');
  const [salonRequiresApproval, setSalonRequiresApproval] = useState(false);

  // Staff review/notes state
  const [selectedApptId, setSelectedApptId] = useState(null);
  const [staffReviewText, setStaffReviewText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);

  const fetchSalonProfile = async () => {
    try {
      const res = await axios.get('/api/buisness/getsalonbyIdSalonId');
      setSalon(res.data);
      setSalonName(res.data.name || '');
      setSalonPhone(res.data.phoneNumber || '');
      setSalonAddress(res.data.address || '');
      setSalonDays(res.data.workingDays || '');
      setSalonOpen(res.data.openingTime?.slice(0, 5) || '');
      setSalonClose(res.data.closingTime?.slice(0, 5) || '');
      setSalonRequiresApproval(res.data.requiresApproval || false);
    } catch (err) {
      console.error('Error fetching salon profile details', err);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await axios.get('/api/salonsdashboard/services/getall');
      setServices(res.data);
    } catch (err) {
      console.error('Error fetching services', err);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await axios.get('/api/salonsdashboard/staff/getallstaff');
      setStaff(res.data);
    } catch (err) {
      console.error('Error fetching staff list', err);
    }
  };

  const fetchAppointments = async () => {
    try {
      const res = await axios.get('/api/appointment/sceduledAppointments');
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching bookings', err);
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

  useEffect(() => {
    fetchSalonProfile();
    fetchServices();
    fetchStaff();
    fetchAppointments();
    fetchAnalytics();
  }, []);

  // Services Management handlers
  const handleAddOrUpdateService = async (e) => {
    e.preventDefault();
    try {
      if (editServiceId) {
        await axios.put(`/api/salonsdashboard/services/update/${editServiceId}`, {
          name: serviceName,
          price: parseFloat(servicePrice),
          duration: parseInt(serviceDuration),
          statusbar: 'active'
        });
        showToast('Service updated successfully!', 'success');
      } else {
        await axios.post('/api/salonsdashboard/services/add', {
          name: serviceName,
          price: parseFloat(servicePrice),
          duration: parseInt(serviceDuration)
        });
        showToast('Service added successfully!', 'success');
      }
      setServiceName('');
      setServicePrice('');
      setServiceDuration('30');
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
    setEditServiceId(service.id);
  };

  const handleDeleteService = async (serviceId) => {
    if (!confirm('Are you sure you want to remove this service?')) return;
    try {
      await axios.delete(`/api/salonsdashboard/services/delete/${serviceId}`);
      showToast('Service removed successfully', 'success');
      fetchServices();
    } catch (err) {
      showToast('Error removing service', 'error');
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
    try {
      await axios.put('/api/buisness/changeSalonDetail', {
        salonId: salon.id,
        name: salonName,
        phoneNumber: salonPhone,
        address: salonAddress,
        workingDays: salonDays,
        openingTime: salonOpen,
        closingTime: salonClose,
        requiresApproval: salonRequiresApproval
      });
      showToast('Salon details updated successfully!', 'success');
      fetchSalonProfile();
    } catch (err) {
      showToast('Failed to update details', 'error');
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

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginTop: '24px' }}>
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
                  {appointments.filter(a => a.status === 'confirmed' || a.status === 'pending').length === 0 ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '32px' }}>
            <div className="booking-panel">
              <h3 className="panel-title">Active Services menu</h3>
              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                {services.length === 0 ? (
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
                              <button onClick={() => handleEditService(s)} className="btn btn-secondary btn-sm" style={{ padding: '6px' }}><Edit size={14} /></button>
                              <button onClick={() => handleDeleteService(s.id)} className="btn btn-danger btn-sm" style={{ padding: '6px' }}><Trash2 size={14} /></button>
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
                  <label className="form-label">Service Title</label>
                  <input type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Hair Styling" value={serviceName} onChange={e => setServiceName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Price (INR)</label>
                  <input type="number" className="form-input" style={{ paddingLeft: '16px' }} placeholder="500" value={servicePrice} onChange={e => setServicePrice(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Duration (Minutes)</label>
                  <select className="form-select" style={{ paddingLeft: '16px' }} value={serviceDuration} onChange={e => setServiceDuration(e.target.value)}>
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
                    <button type="button" onClick={() => { setEditServiceId(null); setServiceName(''); setServicePrice(''); }} className="btn btn-secondary btn-sm">Cancel</button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: Staff members */}
        {activeTab === 'staff' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '32px' }}>
            <div className="booking-panel">
              <h3 className="panel-title">Therapist Directory</h3>
              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                {staff.length === 0 ? (
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
                            <span onClick={() => toggleStaffStatus(st.id, st.statusbar)} className={`badge ${st.statusbar === 'active' ? 'badge-success' : 'badge-danger'}`} style={{ cursor: 'pointer' }}>
                              {st.statusbar || 'active'}
                            </span>
                          </td>
                          <td>
                            <button onClick={() => handleOpenAssign(st)} className="btn btn-secondary btn-sm">
                              Assign
                            </button>
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
                  <label className="form-label">Full Name</label>
                  <input type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Dr. Rose" value={staffName} onChange={e => setStaffName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone Number</label>
                  <input type="tel" className="form-input" style={{ paddingLeft: '16px' }} placeholder="9876543210" value={staffPhone} onChange={e => setStaffPhone(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Login Email</label>
                  <input type="email" className="form-input" style={{ paddingLeft: '16px' }} placeholder="rose@glowsalon.com" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Login Password</label>
                  <input type="password" className="form-input" style={{ paddingLeft: '16px' }} placeholder="••••••••" value={staffPassword} onChange={e => setStaffPassword(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: '12px' }}>Save Staff Member</button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 5: Salon Profile Details */}
        {activeTab === 'details' && (
          <div className="booking-panel" style={{ maxWidth: '800px' }}>
            <h3 className="panel-title">Salon Settings</h3>
            <form onSubmit={handleSaveDetails} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Brand / Salon Name</label>
                <input type="text" className="form-input" style={{ paddingLeft: '16px' }} value={salonName} onChange={e => setSalonName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Business Phone Number</label>
                <input type="tel" className="form-input" style={{ paddingLeft: '16px' }} value={salonPhone} onChange={e => setSalonPhone(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Working Days</label>
                <input type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Mon, Tue, Wed, Thu, Fri, Sat" value={salonDays} onChange={e => setSalonDays(e.target.value)} required />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Salon Address</label>
                <input type="text" className="form-input" style={{ paddingLeft: '16px' }} value={salonAddress} onChange={e => setSalonAddress(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Opening Time</label>
                <input type="time" className="form-input" style={{ paddingLeft: '16px' }} value={salonOpen} onChange={e => setSalonOpen(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Closing Time</label>
                <input type="time" className="form-input" style={{ paddingLeft: '16px' }} value={salonClose} onChange={e => setSalonClose(e.target.value)} required />
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
      {showAssignModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Assign Menu Services</h3>
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
          </div>
        </div>
      )}

      {/* Staff Notes modal */}
      {showNoteModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Add Therapist notes</h3>
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
          </div>
        </div>
      )}
    </div>
  );
}

/* Staff Dashboard Component */
function StaffDashboard({ session, showToast }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteApptId, setNoteApptId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);

  useEffect(() => {
    const fetchStaffSchedules = async () => {
      try {
        const res = await axios.get(`/api/staff/appointments?staffId=${session.id}`);
        setAppointments(res.data);
      } catch (err) {
        console.error('Error fetching schedules', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStaffSchedules();
  }, [session.id]);

  const handleStatusChange = async (apptId, newStatus) => {
    try {
      await axios.put(`/api/appointment/status/${apptId}`, { status: newStatus });
      showToast(`Appointment ${newStatus}.`, 'success');
      // refresh list
      const res = await axios.get(`/api/staff/appointments?staffId=${session.id}`);
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
      const res = await axios.get(`/api/staff/appointments?staffId=${session.id}`);
      setAppointments(res.data);
    } catch (err) {
      showToast('Failed to save note', 'error');
    }
  };

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div className="dashboard-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '36px', fontWeight: 800 }}>Staff Console</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Check your assigned client schedules and booking details</p>
        </div>
        <span className="badge badge-success">Duty: Active</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <h2>Fetching active schedule lists...</h2>
        </div>
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
      {showNoteModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Therapist Note</h3>
            <div className="form-group">
              <textarea
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
          </div>
        </div>
      )}
    </div>
  );
}

/* System Admin Dashboard Console */
function AdminDashboard({ session, showToast }) {
  const [appointments, setAppointments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('bookings'); // 'bookings', 'users'

  const fetchAllAppointments = async () => {
    try {
      const res = await axios.get('/api/admin/appointments/getall');
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching admin appointments', err);
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

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to permanently delete this user? All their bookings will be cascade removed.')) return;
    try {
      await axios.delete(`/api/admin/users/${userId}`);
      showToast('User removed successfully', 'success');
      setUsers(users.filter(u => u.id !== userId));
      fetchAllAppointments();
    } catch (err) {
      showToast('Failed to delete user', 'error');
    }
  };

  const handleDeleteAppointment = async (apptId) => {
    if (!confirm('Are you sure you want to delete this appointment?')) return;
    try {
      await axios.delete(`/api/admin/appointments/${apptId}`);
      showToast('Appointment removed successfully', 'success');
      setAppointments(appointments.filter(a => a.id !== apptId));
    } catch (err) {
      showToast('Failed to delete appointment', 'error');
    }
  };

  useEffect(() => {
    fetchAllAppointments();
  }, []);

  return (
    <div className="container" style={{ padding: '40px 24px' }}>
      <div className="dashboard-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '36px', fontWeight: 800 }}>Admin Console</h1>
          <p style={{ color: 'var(--text-secondary)' }}>System administration dashboard for monitoring active users & bookings</p>
        </div>
      </div>

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
          {appointments.length === 0 ? (
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
    </div>
  );
}
