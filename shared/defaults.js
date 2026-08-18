(function () {
  'use strict';
  var ns = (window.__standupTimer = window.__standupTimer || {});
  ns.DEFAULT_SETTINGS = Object.freeze({
    durationSeconds: 90,
    // People who get longer than the base duration, matched on display
    // name. Frozen because the default object is shared by reference when
    // storage holds no value, so nothing may mutate it in place.
    extraTimeNames: Object.freeze([]),
    extraTimeSeconds: 30,
    countOvertime: true,
    debug: false
  });
})();
