import { Component, type ComponentChildren } from 'preact';

/** If a screen crashes, show a way out instead of a blank page. Data in IndexedDB is untouched. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };

  componentDidCatch(error: Error) {
    console.error('[hiyo]', error);
    this.setState({ error });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main class="screen crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Your entries are safe on this phone. Reloading usually fixes it.</p>
        <button class="btn primary block" onClick={() => location.replace(location.pathname)}>
          Reload Hiyo
        </button>
        <button class="btn block" onClick={() => this.setState({ error: null })}>
          Try to continue
        </button>
        <pre>{String(error.stack ?? error.message).slice(0, 800)}</pre>
      </main>
    );
  }
}
