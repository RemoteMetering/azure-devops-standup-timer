# Stand-up timer for the Azure DevOps sprints taskboard

A browser extension that shows a countdown label on the sprints taskboard at dev.azure.com. It has no controls on screen. It only reacts to how you already run stand-up:

- Active only when Group by is Assigned To and the person filter is All.
- Expanding a person's group starts the countdown for that person.
- Expanding another person switches to them and restarts the countdown.
- Collapsing the tracked person resets and hides the timer.
- Expand all and Collapse all are ignored so bulk actions never start a timer.
- When time runs out the label flashes red.

The time per person is set on the extension's options page (default 90 seconds).

## Why a browser extension

Azure DevOps marketplace extensions run in sandboxed iframes at fixed contribution points. They cannot overlay the taskboard, read the view options, or observe expand and collapse. A content script can, at the cost of depending on undocumented page markup (see maintenance below).

## Install for local testing

- Chrome: open `chrome://extensions`, enable Developer mode, choose Load unpacked, select this folder.
- Edge: open `edge://extensions`, enable Developer mode, choose Load unpacked, select this folder.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on, select `manifest.json`. Temporary add-ons unload when Firefox restarts.

After changing any file, use the reload button on the extensions page and refresh the taskboard tab.

## Troubleshooting after an Azure DevOps UI change

The selectors were verified against a live board in August 2026: the taskboard is a Bolt table grid, person group rows are table rows whose first cell holds a vss-Persona element with the name in aria-label, and a collapsed group carries a taskboard-collapsed-row cell class. The expand chevrons do not use aria-expanded. If Microsoft changes any of this the timer stops recognising groups. Work down this ladder:

1. Open the taskboard tab, open the browser console, filter on `standup-timer`. You must see `content script loaded on ...`. If not, the script never injected: reload the extension on the extensions page, refresh the taskboard tab (content scripts do not inject into tabs that were already open), and confirm the URL starts with `https://dev.azure.com/`.
2. Open the extension options, tick debug logging, then refresh the taskboard tab.
3. Set Group by to Assigned To and the person filter to All. The console now prints a `diagnostics` object showing which selector candidates matched, a sample of board rows, and which person groups were recognised, plus a `scan:` line whenever the recognised picture changes.
4. Expand and collapse a person and watch for `countdown started for ...` messages.

If the diagnostics show zero person groups or wrong names, the selectors in `content/selectors.js` need adjusting. Copy the diagnostics object plus the outerHTML of one person group header row (right click the row in devtools, Copy, Copy outerHTML) and update that file. All DOM knowledge lives there and nowhere else.

## How it works

- `content/taskboard-timer.js` watches for SPA navigation to `/_sprints/taskboard/`, then observes the board for `aria-expanded` changes and node replacements. A small state machine (inactive, idle, running, expired) drives the label. The countdown uses a stored deadline so background tab throttling cannot drift it.
- `content/selectors.js` holds every selector as an ordered candidate list with fallbacks.
- `shared/storage.js` wraps `chrome.storage.sync` so settings sync across the browsers and propagate live to open tabs.

## Known limits

- Detecting Person = All is inferred from seeing two or more person groups. With a single person on the board the timer stays idle rather than guess wrong.
- Identity detection prefers structural markers (avatar images, persona elements) but the final fallback reads header text, which is weaker on non English display languages.
- An Azure DevOps UI update can break the selectors. Symptoms: the label never appears. Fix: the debug steps above, then edit `content/selectors.js`.
