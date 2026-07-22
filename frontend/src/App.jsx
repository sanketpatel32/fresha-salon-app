import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AuthProvider, useAuth, AUTH_EXPIRED_EVENT } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { SkeletonCardGrid } from './components/Skeleton.jsx';

// Landing page stays eager (above-the-fold on /).
import LandingPage from './pages/LandingPage.jsx';

// Route pages are lazy-loaded so each role's surface ships in its own chunk.
const UserLogin = lazy(() => import('./pages/auth/UserLogin.jsx'));
const UserSignup = lazy(() => import('./pages/auth/UserSignup.jsx'));
const SalonLogin = lazy(() => import('./pages/auth/SalonLogin.jsx'));
const SalonSignup = lazy(() => import('./pages/auth/SalonSignup.jsx'));
const StaffLogin = lazy(() => import('./pages/auth/StaffLogin.jsx'));
const AdminLogin = lazy(() => import('./pages/auth/AdminLogin.jsx'));

const CustomerDashboard = lazy(() => import('./pages/customer/CustomerDashboard.jsx'));
const SalonServices = lazy(() => import('./pages/customer/SalonServices.jsx'));
const AppointmentBooking = lazy(() => import('./pages/customer/AppointmentBooking.jsx'));
const EditProfile = lazy(() => import('./pages/customer/EditProfile.jsx'));
const BookedAppointments = lazy(() => import('./pages/customer/BookedAppointments.jsx'));

const SalonDashboard = lazy(() => import('./pages/salon/SalonDashboard.jsx'));
const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));


/* ── Global Axios setup ─────────────────────────────────────────────── */

axios.defaults.baseURL = window.location.origin;

// On 401/403, clear storage and notify the app to redirect via React Router
// (no hard window.location reload — preserves form state and router history).
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);


/* ── App shell ──────────────────────────────────────────────────────── */

/**
 * AuthGatedRoutes lives inside <BrowserRouter> and <AuthProvider> so it can
 * read the session and render ProtectedRoutes. AuthProvider itself uses
 * useNavigate() for the expiry redirect, so it must also be inside Router.
 */
function AuthGatedRoutes() {
  const { userSession } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      {/* Auth Routes — redirect to dashboard if already logged in */}
      <Route path="/user/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <UserLogin />} />
      <Route path="/user/signup" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <UserSignup />} />
      <Route path="/buisness/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <SalonLogin />} />
      <Route path="/buisness/signup" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <SalonSignup />} />
      <Route path="/staff/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <StaffLogin />} />
      <Route path="/admin/login" element={userSession.token ? <Navigate to={`/${userSession.role}/dashboard`} /> : <AdminLogin />} />

      {/* Protected — customer */}
      <Route path="/customer/dashboard" element={<ProtectedRoute allowedRole="customer"><CustomerDashboard /></ProtectedRoute>} />
      <Route path="/userdashboard" element={<Navigate to="/customer/dashboard" />} />
      <Route path="/customer/edit-profile" element={<ProtectedRoute allowedRole="customer"><EditProfile /></ProtectedRoute>} />
      <Route path="/customer/salonservices/:salonId" element={<ProtectedRoute allowedRole="customer"><SalonServices /></ProtectedRoute>} />
      <Route path="/customer/book/:salonId/:serviceId" element={<ProtectedRoute allowedRole="customer"><AppointmentBooking /></ProtectedRoute>} />
      <Route path="/customer/bookings" element={<ProtectedRoute allowedRole="customer"><BookedAppointments /></ProtectedRoute>} />

      {/* Protected — salon */}
      <Route path="/salon/dashboard" element={<ProtectedRoute allowedRole="salon"><SalonDashboard /></ProtectedRoute>} />
      <Route path="/salonsdashboard" element={<Navigate to="/salon/dashboard" />} />

      {/* Protected — staff */}
      <Route path="/staff/dashboard" element={<ProtectedRoute allowedRole="staff"><StaffDashboard /></ProtectedRoute>} />

      {/* Protected — admin */}
      <Route path="/admin/dashboard" element={<ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute>} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <div className="app-wrapper">
              <a href="#main-content" className="skip-link">Skip to content</a>
              <Navbar />
              <main id="main-content" role="main">
                <Suspense fallback={<div className="container" style={{ padding: '40px 24px' }}><SkeletonCardGrid count={4} /></div>}>
                  <AuthGatedRoutes />
                </Suspense>
              </main>
            </div>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
