(function () {
  'use strict';

  // Same dual-namespace approach as shared/storage.js: Firefox exposes
  // chrome.* with callback support alongside browser.*.
  var api = globalThis.chrome || globalThis.browser;

  // The toolbar button has no popup, so a click opens the options page.
  api.action.onClicked.addListener(function () {
    api.runtime.openOptionsPage();
  });

  api.commands.onCommand.addListener(function (command) {
    if (command !== 'reset-timer') return;
    // Only the active tab is targeted. Querying by URL would need the tabs
    // or host permission, and the person using the shortcut is looking at
    // the board anyway.
    api.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs.length) return;
      api.tabs.sendMessage(
        tabs[0].id,
        { type: 'standup-timer:reset' },
        function () {
          // Reading lastError swallows the expected "no receiving end"
          // error on tabs without the content script.
          void api.runtime.lastError;
        }
      );
    });
  });
})();
