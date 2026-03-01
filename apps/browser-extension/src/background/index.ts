chrome.runtime.onMessage.addListener(
  (msg: { type: string }, _sender, sendResponse) => {
    if (msg.type !== 'LAUNCH_SIGNAL') return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];

      if (!tab?.url || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab URL found.' });
        return;
      }

      // Grab cookies so Electron can load the page as the authenticated user
      const cookies = await chrome.cookies.getAll({ url: tab.url });
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const deepLink =
        `signal://track` +
        `?url=${encodeURIComponent(tab.url)}` +
        `&cookie=${encodeURIComponent(cookieHeader)}`;

      // Opening a tab with a custom protocol triggers the OS → opens Electron
      await chrome.tabs.create({ url: deepLink, active: false });

      sendResponse({ ok: true });
    });

    return true; // keeps the channel open for the async callback
  }
);
