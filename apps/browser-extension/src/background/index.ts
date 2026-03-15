/*
  Background message handler for launching the Signal desktop app.

  Flow:
  1. The popup sends a message with type 'LAUNCH_SIGNAL'.
  2. This listener receives the message in the background script.
  3. It retrieves the URL of the currently active tab.
  4. A deep link is created: signal://track?url=<encoded_url>.
  5. Chrome opens a temporary tab with this deep link.
  6. The OS detects the custom protocol (signal://) and launches the Electron app.
  7. The temporary tab is automatically closed after a few seconds.

  This mechanism allows a Chrome extension to trigger a native desktop application
  using a registered custom protocol.
*/

chrome.runtime.onMessage.addListener( // Listen for messages sent within the extension (e.g., popup → background)
  (msg: { type: string }, _sender, sendResponse) => {

    // If not 'LAUNCH_SIGNAL' then return 
    if (msg.type !== 'LAUNCH_SIGNAL') return;

    /*  
      Query the currently active tab in the current window.

      Example result:
      tabs = [
        {
          id: 123,
          url: "https://google.com"
        }
      ]
    */

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0]; // The active tab will always be the first element

      // Validate that the tab has a URL and an ID
      if (!tab?.url || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab URL found.' });
        return;
      }

      // Create a deep link (custom protocol URL) that launches the Signal Electron app
      // encodeURIComponent ensures the URL is safely embedded inside another URL
      const deepLink = `signal://track?url=${encodeURIComponent(tab.url)}`;

      try {
        // Create a temporary tab to trigger the deep link
        // It must be active so Chrome shows the "Allow external app" prompt
        const newTab = await chrome.tabs.create({ url: deepLink, active: true });
        
        // Give the user ~5 seconds to accept the prompt and open the app,
        // then automatically close the temporary tab
        setTimeout(() => {
          if (newTab.id) {
            chrome.tabs.remove(newTab.id).catch(() => {});
          }
        }, 5000);

        // Send success response to the sender
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: 'Failed to launch.' });
        console.error('Failed to launch.', err)
      }
    });

    // Required because sendResponse is used asynchronously (tells the chrome to keep the message channel open)
    return true; 
  }
);