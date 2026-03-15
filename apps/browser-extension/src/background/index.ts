chrome.runtime.onMessage.addListener(
  (msg: { type: string }, _sender, sendResponse) => {
    if (msg.type !== 'LAUNCH_SIGNAL') return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];

      if (!tab?.url || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab URL found.' });
        return;
      }

      const deepLink = `signal://track?url=${encodeURIComponent(tab.url)}`;

      try {
        // 1. We create a temporary active tab to trigger the launch.
        // We MUST make it active so Chrome shows you the "Allow" prompt!
        const newTab = await chrome.tabs.create({ url: deepLink, active: true });
        
        // 2. We don't auto-close it immediately anymore. 
        // We give you 5 seconds to check the "Always Allow" box and click Open.
        setTimeout(() => {
          if (newTab.id) {
            chrome.tabs.remove(newTab.id).catch(() => {});
          }
        }, 5000);

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: 'Failed to launch.' });
        console.error('Failed to launch.', err)
      }
    });

    return true; 
  }
);