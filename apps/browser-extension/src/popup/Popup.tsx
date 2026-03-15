import React, { useState, useEffect } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function Popup() {
  const [status, setStatus] = useState<Status>('idle');
  const [currentUrl, setCurrentUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentUrl(tabs[0].url); 
      }
    });
  }, []);

  const handleLaunch = () => {
    setStatus('loading');
    setErrorMsg('');

    chrome.runtime.sendMessage(
      { type: 'LAUNCH_SIGNAL' },
      (res: { ok: boolean; error?: string }) => {
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
      const truncated = path.length > 35 ? path.slice(0, 35) + '…' : path;
      return u.hostname + truncated;
    } catch { return 'Detecting URL...'; }
  })();

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.brand}>
          <img src="/48x48.png" style={styles.icon} alt="Signal Logo" />
          <span style={styles.title}>Signal</span>
        </div>
        <div style={styles.badge}>TRACKER</div>
      </div>

      <div style={styles.divider} />

      {/* Target Info */}
      <div style={styles.infoSection}>
        <div style={styles.label}>TARGET_URL</div>
        <div style={styles.urlBox}>
          {displayUrl}
        </div>
      </div>

      {/* Action Button */}
      <button
        style={{
          ...styles.button,
          ...(status === 'loading' ? styles.buttonLoading : {}),
          ...(status === 'success' ? styles.buttonSuccess : {}),
        }}
        onClick={handleLaunch}
        disabled={status === 'loading' || status === 'success'}
      >
        {status === 'idle' && 'Open in Desktop'}
        {status === 'loading' && 'Launching...'}
        {status === 'success' && 'Launched.'}
        {status === 'error' && 'Retry Launch'}
      </button>

      {/* Error Output */}
      {status === 'error' && (
        <div style={styles.errorBox}>
          <span style={styles.errorLabel}>ERR: </span>
          {errorMsg}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 260,
    padding: '16px',
    background: '#09090B', // Zinc 950
    color: '#FAFAFA', // Zinc 50
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    border: '1px solid #27272A', // Zinc 800
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  icon: {
    width: '16px',
    height: '16px',
    filter: 'invert(1)',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  badge: {
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#A1A1AA', // Zinc 400
    border: '1px solid #27272A',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  divider: {
    height: '1px',
    background: '#27272A', // Zinc 800
    width: '100%',
  },
  infoSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#71717A', // Zinc 500
    letterSpacing: '0.05em',
  },
  urlBox: {
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    fontSize: '11px',
    color: '#D4D4D8', // Zinc 300
    background: '#18181B', // Zinc 900
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #27272A',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  button: {
    width: '100%',
    padding: '10px',
    background: '#FAFAFA', // White button
    color: '#09090B', // Black text
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  buttonLoading: {
    background: '#27272A',
    color: '#A1A1AA',
    cursor: 'wait',
  },
  buttonSuccess: {
    background: '#18181B',
    color: '#FAFAFA',
    border: '1px solid #27272A',
    cursor: 'default',
  },
  errorBox: {
    fontSize: '11px',
    color: '#FCA5A5', // Red 300
    background: '#450A0A', // Red 950
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #7F1D1D', // Red 900
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  },
  errorLabel: {
    fontWeight: 700,
  }
};