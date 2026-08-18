(function () {
  'use strict';
  var ns = window.__standupTimer;
  var storage = ns.storage;
  var names = ns.names;

  var form = document.getElementById('settings-form');
  var durationInput = document.getElementById('duration');
  var extraNamesInput = document.getElementById('extra-names');
  var extraSecondsInput = document.getElementById('extra-seconds');
  var countOvertimeInput = document.getElementById('count-overtime');
  var debugInput = document.getElementById('debug');
  var status = document.getElementById('status');
  var statusTimer = null;

  storage.getSettings().then(function (settings) {
    durationInput.value = settings.durationSeconds;
    extraNamesInput.value = (settings.extraTimeNames || []).join('\n');
    extraSecondsInput.value = settings.extraTimeSeconds;
    countOvertimeInput.checked = settings.countOvertime;
    debugInput.checked = settings.debug;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var duration = parseInt(durationInput.value, 10);
    if (isNaN(duration) || duration < 10 || duration > 3600) {
      showStatus('Enter a whole number between 10 and 3600.', true);
      return;
    }

    var extraSeconds = parseInt(extraSecondsInput.value, 10);
    if (isNaN(extraSeconds) || extraSeconds < 0 || extraSeconds > 3600) {
      showStatus('Extra time must be a whole number between 0 and 3600.', true);
      return;
    }

    // Parsing also drops blanks and duplicates, so the saved list matches
    // what the timer will actually match against.
    var extraNames = names.parseNameList(extraNamesInput.value);
    extraNamesInput.value = extraNames.join('\n');

    storage
      .saveSettings({
        durationSeconds: duration,
        extraTimeNames: extraNames,
        extraTimeSeconds: extraSeconds,
        countOvertime: countOvertimeInput.checked,
        debug: debugInput.checked
      })
      .then(function () {
        showStatus(savedMessage(extraNames, extraSeconds), false);
      })
      .catch(function (err) {
        showStatus('Could not save: ' + err.message, true);
      });
  });

  // Names with no extra seconds, or seconds with no names, save cleanly but
  // do nothing. Say so rather than letting the user assume it took effect.
  function savedMessage(extraNames, extraSeconds) {
    if (extraNames.length && extraSeconds === 0) {
      return 'Saved. Extra time is 0 seconds, so the list has no effect.';
    }
    if (!extraNames.length && extraSeconds > 0) {
      return 'Saved. No names listed, so nobody gets extra time.';
    }
    return 'Saved.';
  }

  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', isError);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      status.textContent = '';
    }, 5000);
  }
})();
