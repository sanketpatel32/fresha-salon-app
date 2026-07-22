import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Gate: requires a token + a matching role. Redirects to the role-appropriate
 * login if unauthenticated, or to / if the role doesn't match.
 */
export default function ProtectedRoute({ allowedRole, children }) {
  const { userSession } = useAuth();

  if (!userSession.token) {
    const loginRedirect =
      allowedRole === 'customer' ? '/user/login'
      : allowedRole === 'salon' ? '/buisness/login'
      : allowedRole === 'staff' ? '/staff/login'
      : '/admin/login';
    return <Navigate to={loginRedirect} />;
  }
  if (userSession.role !== allowedRole) {
    return <Navigate to="/" />;
  }
  return children;
}
