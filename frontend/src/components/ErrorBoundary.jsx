import React from 'react';

/**
 * Catches render errors anywhere in the child tree and shows a styled
 * fallback instead of a blank white screen. The user can reload to recover.
 *
 * Class component — error boundaries require React's legacy lifecycle
 * (getDerivedStateFromError / componentDidCatch); hooks can't do this.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-xl)',
            textAlign: 'center',
            fontFamily: 'var(--font-body)',
            background: 'var(--color-paper)',
            color: 'var(--color-ink)',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-2xl)',
              fontWeight: 500,
              marginBottom: 'var(--space-sm)',
              letterSpacing: '-0.01em',
            }}
          >
            Something went wrong
          </h1>
          <p style={{ color: 'var(--color-ink-2)', maxWidth: '40ch', marginBottom: 'var(--space-lg)' }}>
            An unexpected error occurred while rendering this page. Your data is safe —
            reloading usually fixes it.
          </p>
          <button onClick={this.handleReload} className="btn btn-primary">
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
