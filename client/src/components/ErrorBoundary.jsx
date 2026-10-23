import { Component } from 'react';

// A rendering bug must never leave the user with a blank white page. `resetKey` (the current URL)
// clears the error when they navigate elsewhere; the layout around it stays usable.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it for developers / monitoring; the UI below is for the person using the app.
    console.error('UI error:', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-slate-600">
          This page hit an unexpected problem. Nothing you did has been lost.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-6 overflow-x-auto rounded bg-slate-100 p-3 text-left text-xs">
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
