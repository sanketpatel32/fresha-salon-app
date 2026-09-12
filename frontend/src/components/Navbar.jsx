import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Scissors, LogOut, Sun, Moon, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import './Navbar.css';

/**
 * Top navigation. Collapses to a hamburger panel below 768px (CSS-driven).
 * Active links get .active (accent + hairline underline, per index.css) and
 * aria-current="page".
 */
export default function Navbar() {
  const { userSession, handleLogout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // "/" matches exactly; section routes match themselves and subroutes.
  // The salon profile + booking flow (part of discovery) keeps "Find Salons"
  // lit so the customer nav never sits with no active section.
  const isActive = (to) => {
    if (to === '/') return pathname === '/';
    if (to === '/customer/dashboard') {
      return (
        pathname === to ||
        pathname.startsWith(`${to}/`) ||
        pathname.startsWith('/customer/salon/') ||
        pathname.startsWith('/customer/book/')
      );
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  const linkProps = (to) => ({
    to,
    className: isActive(to) ? 'nav-link active' : 'nav-link',
    'aria-current': isActive(to) ? 'page' : undefined,
    onClick: () => setMenuOpen(false),
  });

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
          <Link {...linkProps('/')}>Home</Link>

          {userSession.token && userSession.role === 'customer' && (
            <>
              <Link {...linkProps('/customer/dashboard')}>Find Salons</Link>
              <Link {...linkProps('/customer/bookings')}>My Bookings</Link>
              <Link {...linkProps('/customer/edit-profile')}>Edit Profile</Link>
            </>
          )}

          {userSession.token && userSession.role === 'salon' && (
            <Link {...linkProps('/salon/dashboard')}>Business Console</Link>
          )}

          {userSession.token && userSession.role === 'staff' && (
            <Link {...linkProps('/staff/dashboard')}>Staff Console</Link>
          )}

          {userSession.token && userSession.role === 'admin' && (
            <Link {...linkProps('/admin/dashboard')}>Admin Console</Link>
          )}

          <div className="nav-actions">
            <button
              onClick={toggleTheme}
              className="btn btn-secondary btn-icon-only nav-icon-btn"
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
              <>
                <Link to="/user/login" className="btn btn-secondary btn-sm" onClick={() => setMenuOpen(false)}>Sign In</Link>
                <Link to="/buisness/login" className="btn btn-primary btn-sm" onClick={() => setMenuOpen(false)}>Business</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
