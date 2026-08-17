(function () {
  'use strict';
  var ns = window.__standupTimer;
  var storage = ns.storage;

  var form = document.getElementById('settings-form');
  var durationInput = document.getElementById('duration');
  var debugInput = document.getElementById('debug');
  var status = document.getElementById('status');
  var statusTimer = null;

  storage.getSettings().then(function (settings) {
    durationInput.value = settings.durationSeconds;
    debugInput.checked = settings.debug;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var duration = parseInt(durationInput.value, 10);
    if (isNaN(duration) || duration < 10 || duration > 3600) {
      showStatus('Enter a whole number between 10 and 3600.', true);
      return;
    }

    storage
      .saveSettings({ durationSeconds: duration, debug: debugInput.checked })
      .then(function () {
        showStatus('Saved.', false);
      })
      .catch(function (err) {
        showStatus('Could not save: ' + err.message, true);
      });
  });

  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', isError);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      status.textContent = '';
    }, 3000);
  }
})();
