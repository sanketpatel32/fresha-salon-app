import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Scissors, LogOut, Sun, Moon, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

/**
 * Top navigation. Collapses to a hamburger panel below 768px (CSS-driven).
 */
export default function Navbar() {
  const { userSession, handleLogout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="navbar">
      <div className="container nav-container">
        <Link to="/" className="nav-brand" onClick={() => setMenuOpen(false)}>
          <Scissors size={28} /> Fresha
        </Link>
        <button
          className="nav-toggle"
          onClick={() => setMenuOpen(o => !o)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-controls="primary-nav"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav
          id="primary-nav"
          className={`nav-links ${menuOpen ? 'nav-links-expanded' : 'nav-links-collapsed'}`}
        >
          <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>Home</Link>

          {userSession.token && userSession.role === 'customer' && (
            <>
              <Link to="/customer/dashboard" className="nav-link" onClick={() => setMenuOpen(false)}>Find Salons</Link>
              <Link to="/customer/bookings" className="nav-link" onClick={() => setMenuOpen(false)}>My Bookings</Link>
              <Link to="/customer/edit-profile" className="nav-link" onClick={() => setMenuOpen(false)}>Edit Profile</Link>
            </>
          )}

          {userSession.token && userSession.role === 'salon' && (
            <Link to="/salon/dashboard" className="nav-link" onClick={() => setMenuOpen(false)}>Business Console</Link>
          )}

          {userSession.token && userSession.role === 'staff' && (
            <Link to="/staff/dashboard" className="nav-link" onClick={() => setMenuOpen(false)}>Staff Console</Link>
          )}

          {userSession.token && userSession.role === 'admin' && (
            <Link to="/admin/dashboard" className="nav-link" onClick={() => setMenuOpen(false)}>Admin Console</Link>
          )}

          <button
            onClick={toggleTheme}
            className="btn btn-secondary btn-icon-only"
            style={{ padding: '8px', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title="Toggle light/dark mode"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {userSession.token ? (
            <button onClick={handleLogout} className="btn btn-secondary btn-sm">
              <LogOut size={16} /> Logout
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Link to="/user/login" className="btn btn-secondary btn-sm" onClick={() => setMenuOpen(false)}>Sign In</Link>
              <Link to="/buisness/login" className="btn btn-primary btn-sm" onClick={() => setMenuOpen(false)}>Business</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
