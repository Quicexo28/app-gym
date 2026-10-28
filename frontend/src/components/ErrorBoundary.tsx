import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container stack" role="alert">
        <section className="surface stack compactStack">
          <h3>Algo salió mal</h3>
          <div className="quickActions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              Recargar
            </button>
          </div>
        </section>
      </div>
    );
  }
}
