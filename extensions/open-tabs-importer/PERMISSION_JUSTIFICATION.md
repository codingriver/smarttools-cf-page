# Permission Justification — SmartTools Open Tabs Importer

## Why This Extension Needs `<all_urls>`

### What the Extension Does

This extension helps users save the current active page or import currently open Chrome/Edge browser tabs into their personal SmartTools bookmark manager. SmartTools is a self-hosted bookmark tool — every user deploys it to their own domain (e.g., `https://smarttools-xxx.pages.dev`, `https://bookmarks.mydomain.com`, or a local deployment).

The critical challenge: **the extension cannot know the user's SmartTools domain in advance** because each user deploys SmartTools to their own hosting.

### How `<all_urls>` Is Actually Used

The extension has two components that interact with web pages:

#### 1. Content Script (`pending-import.js`)
- Injected into all pages because the extension cannot predict which domain the user has deployed SmartTools to.
- **On non-SmartTools pages**: the script immediately exits without performing any action. It checks `chrome.storage.local` for a pending import; if the current page doesn't match the configured SmartTools domain, it does nothing.
- **On the SmartTools config page** (`/config.html`): it listens for a `postMessage` from the extension and displays the import confirmation UI. This is the only page where it performs meaningful work.
- This script has no network access, does not read DOM content, does not collect or transmit any user data from third-party sites.

#### 2. `chrome.scripting.executeScript` (via Popup / Background)
- Used to inject tab data directly into the SmartTools config page via `window.postMessage`.
- This is how tab titles and URLs are actually delivered to the user's SmartTools instance.
- Only targeted at the specific SmartTools tab the user has open.

### What `<all_urls>` Is NOT Used For

- ❌ Reading or scraping content from any website
- ❌ Collecting browsing history
- ❌ Intercepting network requests
- ❌ Injecting ads, trackers, or third-party scripts
- ❌ Accessing cookies, passwords, or credentials from any site
- ❌ Communicating with any server other than the user's own SmartTools instance

### Comparison with Alternative Approaches

We considered these alternatives but they all have significant drawbacks:

| Alternative | Problem |
|---|---|
| Require user to enter domain in manifest | Users cannot install from Chrome Web Store with dynamic permissions |
| Restrict to a specific domain (e.g., `*.pages.dev`) | Blocks users who self-host SmartTools on other domains |
| Remove auto-delivery, require manual copy/paste | Severely degrades UX for an import tool |
| Request permission dynamically on first use | Not supported for content script injection; only for API calls |

### Security Notes

- The extension requests the minimum permissions necessary for its import functionality.
- `tabs` permission is used only to read the active tab or selected tab titles, URLs, and favicon URLs — no browsing history or sensitive data.
- All imported data stays within the user's own browser and their own SmartTools deployment.
- The extension does not communicate with any server other than the user's configured SmartTools backend.
- No data is collected, aggregated, or sent to any third party.

### If You Have Questions

If you have concerns about this permission during review, please reach out — we are happy to provide additional technical detail about why `<all_urls>` is the only feasible approach for a cross-domain import tool where each user controls their own target domain.
