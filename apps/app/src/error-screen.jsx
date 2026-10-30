// error-screen.jsx — what the app shows when rendering throws. Without it React unmounts everything
// and the phone shows a white page with no clue why. Styles are inline with fallbacks, because the
// failure may be the stylesheet itself.
import React from 'react';

const STACK_LINES = 12;

// The text a person can read out or copy into a bug report.
export function describeError(error, info) {
  const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
  const stack = String(err.stack || '').split('\n').slice(0, STACK_LINES).join('\n');
  const component = String(info?.componentStack || '').split('\n').filter(Boolean).slice(0, 4).join('\n');
  return [
    `${err.name || 'Error'}: ${err.message || '(no message)'}`,
    stack && `\n${stack}`,
    component && `\nIn:\n${component}`,
    `\n${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
  ].filter(Boolean).join('\n');
}

const box = {
  minHeight: '100vh', boxSizing: 'border-box', padding: 20,
  background: 'var(--bg, #fff)', color: 'var(--text, #111)',
  fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', gap: 12,
};
const button = {
  padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border, #bbb)',
  background: 'var(--surface, #f4f4f4)', color: 'inherit', font: 'inherit', cursor: 'pointer',
};

export function ErrorScreen({ error, info, onReload = () => window.location.reload() }) {
  const [copied, setCopied] = React.useState(false);
  const details = describeError(error, info);
  const copy = async () => {
    try { await navigator.clipboard.writeText(details); setCopied(true); } catch (_) { /* leave the text selectable */ }
  };
  return (
    <div role="alert" style={box}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Something went wrong</h1>
      <p style={{ margin: 0 }}>The app hit an error and could not show this screen. Your saved data has not been changed.</p>
      <pre data-testid="error-details" style={{
        margin: 0, padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap',
        background: 'var(--surface-2, #eee)', userSelect: 'text',
      }}>{details}</pre>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={button} onClick={onReload}>Reload</button>
        <button type="button" style={button} onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Visible in `chrome://inspect` / adb logcat as well.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) return <ErrorScreen error={this.state.error} info={this.state.info} onReload={this.props.onReload} />;
    return this.props.children;
  }
}
