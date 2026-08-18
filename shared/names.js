(function () {
  'use strict';
  var ns = (window.__standupTimer = window.__standupTimer || {});

  // The board only exposes display names, read from a persona aria-label
  // such as "Marco Muller". There is no username or email in that markup,
  // so entries are matched against the display name. Punctuation collapses
  // to whitespace so an alias typed as "marco.muller" still matches.
  function normaliseName(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // True when the entry is the whole display name or a run of whole words
  // inside it. Whole words only, so "marco" matches "Marco Muller" while
  // "marc" matches neither.
  function nameMatchesEntry(displayName, entry) {
    var name = normaliseName(displayName);
    var needle = normaliseName(entry);
    if (!name || !needle) return false;
    return (' ' + name + ' ').indexOf(' ' + needle + ' ') !== -1;
  }

  function matchesAnyEntry(displayName, entries) {
    if (!entries || !entries.length) return false;
    for (var i = 0; i < entries.length; i++) {
      if (nameMatchesEntry(displayName, entries[i])) return true;
    }
    return false;
  }

  // Accepts newline, comma or semicolon separated text from the options
  // page. Entries that normalise to the same thing collapse to the first
  // spelling typed.
  function parseNameList(text) {
    var parts = String(text == null ? '' : text).split(/[\n,;]+/);
    // Null prototype so an entry like "constructor" cannot read a
    // truthy value off Object.prototype and be dropped as a duplicate.
    var seen = Object.create(null);
    var list = [];
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i].trim();
      var key = normaliseName(raw);
      if (!key || seen[key]) continue;
      seen[key] = true;
      list.push(raw);
    }
    return list;
  }

  ns.names = {
    normaliseName: normaliseName,
    nameMatchesEntry: nameMatchesEntry,
    matchesAnyEntry: matchesAnyEntry,
    parseNameList: parseNameList
  };
})();
