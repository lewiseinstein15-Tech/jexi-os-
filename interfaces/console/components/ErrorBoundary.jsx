import { Component } from 'react';

/**
 * App-wide error boundary. A render crash anywhere in the tree used to blank
 * the whole screen (black page). Now it shows an honest recovery card with the
 * failing screen name and a reload — the OS never silently dies.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, message: (error && error.message) || String(error) };
  }

  componentDidCatch(error, info) {
    console.error('[JEXI UI] render crash:', error, info?.componentStack);
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="min-h-screen bg-void flex items-center justify-center px-4">
          <div className="surface-card max-w-md w-full p-6 rounded-xl border border-status-error/40">
            <p className="text-[10px] font-black tracking-[0.18em] text-status-error mb-2">UI CRASH CAUGHT</p>
            <p className="text-[12px] text-text-primary leading-relaxed mb-3">
              JEXI&apos;s interface hit an unexpected error while rendering this view. The backend is unaffected — your task keeps running.
            </p>
            {this.state.message && (
              <pre className="bg-surface-2 border border-hairline rounded-md p-2.5 mb-4 font-mono text-[9px] text-text-tertiary overflow-x-auto whitespace-pre-wrap break-all">
                {this.state.message.slice(0, 400)}
              </pre>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => this.setState({ crashed: false, message: '' })}
                className="flex-1 bg-brand text-black rounded-md px-3 py-2.5 text-[11px] font-bold"
              >
                TRY AGAIN
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 bg-surface-2 text-text-secondary border border-hairline rounded-md px-3 py-2.5 text-[11px] font-bold"
              >
                RELOAD APP
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
