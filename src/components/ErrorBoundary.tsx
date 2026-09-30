import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level error boundary. A render error anywhere in the tree shows a
 * fallback message instead of blanking the whole app (#40). Deliberately
 * plain (no MUI) so it still renders even if the theme or a dependency threw.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the developer console; the UI fallback handles the user.
    console.error('Uncaught render error:', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#121212',
          color: '#e0e0e0',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            padding: '24px 28px',
            borderRadius: 16,
            background: '#1e1e1e',
            border: '1px solid #333',
          }}
        >
          <h1 style={{ fontSize: 20, margin: '0 0 8px', color: '#fff' }}>Vault hit a problem</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 12px', color: '#bdbdbd' }}>
            Something went wrong while drawing the screen. Reload to try again — your notes are
            safe on disk.
          </p>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: '0 0 16px',
              padding: 8,
              borderRadius: 8,
              background: '#000',
              color: '#ff8a80',
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              fontSize: 14,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: '#bb86fc',
              color: '#000',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
