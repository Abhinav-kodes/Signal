import React, { useState, useEffect } from 'react';

// Status of the launch process to manage UI states
type Status = 'idle' | 'loading' | 'success' | 'error';


export default function Popup() {
  const [status, setStatus] = useState<Status>('idle');
  const [currentUrl, setCurrentUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Show the active tab URL in the popup for context
  useEffect(() => {
    // Query Chrome for the active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      // tabs is an array: the first item is the active tab
      if (tabs[0]?.url) {
        // Store the tab's URL in React state
        setCurrentUrl(tabs[0].url); 
      }
    });
    // Empty dependency array ensures this runs only once
  }, []);

  // fuction when button is clicked
  const handleLaunch = () => {

    setStatus('loading');
    setErrorMsg('');

    // send message to Background
    chrome.runtime.sendMessage(
      { type: 'LAUNCH_SIGNAL' },
      (res: { ok: boolean; error?: string }) => {
        // error handling
        if (chrome.runtime.lastError || !res?.ok) {
          setErrorMsg(res?.error ?? chrome.runtime.lastError?.message ?? 'Launch failed.');
          setStatus('error');
          return;
        }
        setStatus('success');
        setTimeout(() => window.close(), 1200);
      }
    );
  };

  const displayUrl = (() => {
    try {
      const u = new URL(currentUrl);
      const path = u.pathname + u.search;
      const truncated = path.length > 30 ? path.slice(0, 30) + '…' : path;
      return u.hostname + truncated;
    } catch { return null; }
  })();

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.logo}>⚡</span>
        <div>
          <div style={styles.title}>Signal</div>
          <div style={styles.subtitle}>No-code web tracker</div>
        </div>
      </div>

      {/* Current page pill */}
      {displayUrl && (
        <div style={styles.urlPill}>
          <span style={styles.dot} />
          {displayUrl}
        </div>
      )}

      {/* Description */}
      <p style={styles.description}>
        Opens this page in the Signal desktop app. Click any element to start tracking it.
      </p>

      {/* Button */}
      <button
        style={{
          ...styles.button,
          ...(status === 'loading' ? styles.buttonDisabled : {}),
          ...(status === 'success' ? styles.buttonSuccess : {}),
        }}
        onClick={handleLaunch}
        disabled={status === 'loading' || status === 'success'}
      >
        {status === 'idle' && 'Open in Signal Desktop'}
        {status === 'loading' && 'Launching…'}
        {status === 'success' && 'Signal is opening!'}
        {status === 'error' && 'Open in Signal Desktop'}
      </button>

      {/* Error */}
      {status === 'error' && (
        <div style={styles.errorBox}>
          {errorMsg}
        </div>
      )}

      {/* Footer hint */}
      <div style={styles.footer}>
        Make sure Signal Desktop is installed and running.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 280,
    padding: '18px 16px 14px',
    background: '#09090b',
    color: '#fafafa',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    fontSize: 28,
    lineHeight: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '-0.3px',
  },
  subtitle: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 1,
  },
  urlPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 20,
    padding: '5px 10px',
    fontSize: 11,
    color: '#a1a1aa',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#22c55e',
    flexShrink: 0,
  },
  description: {
    fontSize: 12,
    color: '#71717a',
    lineHeight: 1.6,
    margin: 0,
  },
  button: {
    width: '100%',
    padding: '10px 16px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  buttonDisabled: {
    background: '#3f3f46',
    cursor: 'not-allowed',
  },
  buttonSuccess: {
    background: '#16a34a',
    cursor: 'default',
  },
  errorBox: {
    background: '#2d0707',
    border: '1px solid #7f1d1d',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 11,
    color: '#fca5a5',
    lineHeight: 1.5,
  },
  footer: {
    fontSize: 10,
    color: '#3f3f46',
    textAlign: 'center',
  },
};
