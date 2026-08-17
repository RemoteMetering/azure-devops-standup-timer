(function () {
  'use strict';
  var ns = (window.__standupTimer = window.__standupTimer || {});

  // Firefox exposes chrome.* with callback support alongside browser.*,
  // so callback style works identically in Chrome, Edge and Firefox.
  var api = globalThis.chrome || globalThis.browser;

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        api.storage.sync.get(ns.DEFAULT_SETTINGS, function (items) {
          if (api.runtime && api.runtime.lastError) {
            resolve(Object.assign({}, ns.DEFAULT_SETTINGS));
            return;
          }
          resolve(Object.assign({}, ns.DEFAULT_SETTINGS, items));
        });
      } catch (e) {
        resolve(Object.assign({}, ns.DEFAULT_SETTINGS));
      }
    });
  }

  function saveSettings(partial) {
    return new Promise(function (resolve, reject) {
      try {
        api.storage.sync.set(partial, function () {
          if (api.runtime && api.runtime.lastError) {
            reject(new Error(api.runtime.lastError.message));
            return;
          }
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function onSettingsChanged(callback) {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      callback(changes);
    });
  }

  ns.storage = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    onSettingsChanged: onSettingsChanged
  };
})();
