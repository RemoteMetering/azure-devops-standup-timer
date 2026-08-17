(function () {
  'use strict';
  var ns = (window.__standupTimer = window.__standupTimer || {});

  // All DOM knowledge about the Azure DevOps taskboard lives in this file.
  // The New Boards Hub DOM is undocumented and changes between sprints, so
  // every lookup walks an ordered candidate list. When the board markup
  // changes, this is the only file that should need editing. Turn on debug
  // in the extension options to see which candidates miss.

  var debugEnabled = false;
  var loggedMisses = {};

  function setDebug(value) {
    debugEnabled = !!value;
  }

  function debugLog() {
    if (!debugEnabled) return;
    var args = ['[standup-timer]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  }

  function logMiss(name, candidates) {
    if (!debugEnabled || loggedMisses[name]) return;
    loggedMisses[name] = true;
    console.warn('[standup-timer] no element matched "' + name + '". Candidates tried:', candidates);
  }

  function firstMatch(root, name, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var el = root.querySelector(candidates[i]);
      if (el) return el;
    }
    logMiss(name, candidates);
    return null;
  }

  var BOARD_CONTAINER_CANDIDATES = [
    '[data-testid*="taskboard" i]',
    'div[class*="taskboard-content" i]',
    'div[class*="taskboard-grid" i]',
    // Last resort: the route watcher only calls this on the taskboard URL,
    // so scoping to the main content region is safe and guarantees the
    // observers attach even when the class names above have changed.
    '[role="main"]',
    'main'
  ];

  // A real board container is a content region, never a control. Verified
  // against a live board where [class*="taskboard"] matched the Column
  // Options button and silently broke everything downstream.
  var INTERACTIVE_TAGS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };

  function isPlausibleContainer(el) {
    return !INTERACTIVE_TAGS[el.tagName] && el.childElementCount > 0;
  }

  function findBoardContainer() {
    for (var i = 0; i < BOARD_CONTAINER_CANDIDATES.length; i++) {
      var matches = document.querySelectorAll(BOARD_CONTAINER_CANDIDATES[i]);
      for (var j = 0; j < matches.length; j++) {
        if (isPlausibleContainer(matches[j])) return matches[j];
      }
    }
    logMiss('board container', BOARD_CONTAINER_CANDIDATES);
    return null;
  }

  // Used only by diagnose() to report which avatar markers exist on the
  // page after an Azure DevOps UI change.
  var IDENTITY_CANDIDATES = [
    'img[src*="GraphProfile" i]',
    'img[src*="MemberAvatars" i]',
    '.vss-Persona[aria-label]',
    '[class*="persona" i]',
    '[class*="identity" i]',
    '[role="img"][aria-label]'
  ];

  // Verified against a live board (2026-08): the taskboard is a Bolt table
  // grid. A person group renders as a tr whose FIRST td holds a
  // div.vss-Persona with the display name in aria-label, wrapped in a
  // .identity-view control. A collapsed group's row carries
  // td.taskboard-collapsed-row. The expand chevrons do NOT use
  // aria-expanded, so detection is row based, not toggle based.
  function findGrid(container) {
    return (
      container.querySelector(
        'table[role="grid"], [role="treegrid"], ' +
        'table[class*="taskboard" i], table[class*="bolt-table" i]'
      ) || container
    );
  }

  var PERSONA_IN_ROW =
    '.vss-Persona[aria-label], ' +
    '[class*="persona" i][role="img"][aria-label], ' +
    '[class*="identity" i] [role="img"][aria-label]';

  function isCollapsedRow(row) {
    if (row.querySelector('td[class*="collapsed" i]')) return true;
    return typeof row.className === 'string' && /collapsed/i.test(row.className);
  }

  // Returns [{ key, name, header, expanded }], one entry per person group
  // row. Deduped by name because sticky table implementations can render a
  // row twice.
  function getPersonGroups(container) {
    var grid = findGrid(container);
    var rows = grid.querySelectorAll('tr');
    var groups = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var firstTd = row.querySelector('td');
      if (!firstTd) continue;
      var persona = firstTd.querySelector(PERSONA_IN_ROW);
      if (!persona) continue;
      // Avatars on task cards are persona elements too, but they sit
      // inside card containers. Group headers do not.
      if (persona.closest('[class*="card" i]')) continue;
      // Grouped by Parents renders a work item link in the header cell.
      if (firstTd.querySelector('a[href*="/_workitems/edit/"]')) continue;
      var name = (persona.getAttribute('aria-label') || '').trim();
      if (!name || seen[name]) continue;
      seen[name] = true;
      groups.push({
        key: name,
        name: name,
        header: row,
        expanded: !isCollapsedRow(row)
      });
    }
    return groups;
  }

  // True only when we are confident the Person filter is set to All.
  // Two or more person groups can only render with the filter on All, since
  // filtering to one person leaves a single group. A single group is
  // ambiguous (one person team versus filtered board), so we stay idle
  // rather than run a timer under the wrong conditions.
  function isPersonFilterAll(container, groups) {
    if (groups.length >= 2) return true;
    debugLog('person filter state ambiguous, groups found:', groups.length);
    return false;
  }

  function trimHtml(el, max) {
    var html = el.outerHTML || '';
    return html.length > max ? html.slice(0, max) + '…' : html;
  }

  // Compact one-line description of an element: tag, id, classes and the
  // aria attributes we care about. Keeps diagnostics readable.
  function describeEl(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.');
    }
    var expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) s += ' [aria-expanded=' + expanded + ']';
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) s += ' [aria-label=' + ariaLabel.slice(0, 40) + ']';
    var role = el.getAttribute('role');
    if (role) s += ' [role=' + role + ']';
    return s.slice(0, 200);
  }

  // Dumps what each candidate list matches on the current page. Runs
  // automatically on activation when debug is on. The output is what we
  // need to correct the candidate lists after an Azure DevOps UI change.
  function diagnose() {
    var report = { pathname: location.pathname, containerCandidates: {} };
    for (var i = 0; i < BOARD_CONTAINER_CANDIDATES.length; i++) {
      report.containerCandidates[BOARD_CONTAINER_CANDIDATES[i]] =
        document.querySelectorAll(BOARD_CONTAINER_CANDIDATES[i]).length;
    }
    var container = findBoardContainer();
    report.containerFound = !!container;
    if (container) {
      report.container = describeEl(container);

      var grid = findGrid(container);
      report.grid = describeEl(grid);
      var rows = grid.querySelectorAll('tr');
      report.totalRows = rows.length;

      // Sample the rows that carry a persona or a taskboard class. Shows
      // what collapsed AND expanded group rows look like, plus the chevron
      // button labels for future use.
      report.rowSample = [];
      for (var r = 0; r < rows.length && report.rowSample.length < 12; r++) {
        var row = rows[r];
        var persona = row.querySelector(PERSONA_IN_ROW);
        var taskboardTd = row.querySelector('td[class*="taskboard" i]');
        if (!persona && !taskboardTd) continue;
        var firstTd = row.querySelector('td');
        var buttons = firstTd
          ? Array.prototype.slice.call(firstTd.querySelectorAll('button')).slice(0, 3)
              .map(function (b) { return describeEl(b); })
          : [];
        report.rowSample.push({
          row: describeEl(row),
          firstTd: firstTd ? describeEl(firstTd) : null,
          personaLabel: persona ? persona.getAttribute('aria-label') : null,
          personaInCard: persona ? !!persona.closest('[class*="card" i]') : null,
          collapsed: isCollapsedRow(row),
          firstTdButtons: buttons
        });
      }

      // How many elements each identity candidate matches on the board.
      report.identityCandidates = {};
      for (var j = 0; j < IDENTITY_CANDIDATES.length; j++) {
        report.identityCandidates[IDENTITY_CANDIDATES[j]] =
          container.querySelectorAll(IDENTITY_CANDIDATES[j]).length;
      }

      // Ancestor chain of the first avatar-like element. This reveals the
      // real group header structure without needing a manual DOM copy.
      var firstIdentity = firstMatch(container, 'first identity element', IDENTITY_CANDIDATES);
      if (firstIdentity) {
        var chain = [];
        var node = firstIdentity;
        for (var depth = 0; node && node !== container && depth < 12; depth++) {
          chain.push(describeEl(node));
          node = node.parentElement;
        }
        report.firstIdentityAncestors = chain;
      }

      report.personGroups = getPersonGroups(container).map(function (g) {
        return { name: g.name, expanded: g.expanded };
      });
    }
    console.info('[standup-timer] diagnostics', JSON.stringify(report, null, 2));
    return report;
  }

  ns.selectors = {
    setDebug: setDebug,
    debugLog: debugLog,
    findBoardContainer: findBoardContainer,
    getPersonGroups: getPersonGroups,
    isPersonFilterAll: isPersonFilterAll,
    diagnose: diagnose
  };
})();
