(function () {
  'use strict';
  var ns = window.__standupTimer;
  if (!ns || !ns.selectors || !ns.storage) return;

  var sel = ns.selectors;
  var storage = ns.storage;
  var names = ns.names;
  var api = globalThis.chrome || globalThis.browser;

  // Match the whole sprints hub rather than only /taskboard/, in case the
  // New Boards Hub uses a different tab segment. Activation on the wrong
  // tab is harmless because person group detection gates the timer.
  var ROUTE_RE = /\/_sprints\//i;
  var lastLoggedPathname = null;
  var TICK_MS = 250;
  var ROUTE_DEBOUNCE_MS = 300;
  var RESCAN_DEBOUNCE_MS = 150;
  // Three or more groups flipping in one pass means Expand all or
  // Collapse all, not a person taking their turn.
  var BULK_THRESHOLD = 3;

  // States: INACTIVE (wrong route or conditions unmet), IDLE (conditions
  // met, nobody tracked), RUNNING, EXPIRED.
  var state = 'INACTIVE';
  var settings = Object.assign({}, ns.DEFAULT_SETTINGS);

  var boardContainer = null;
  var boardObserver = null;
  var label = null;
  var tickHandle = null;
  var routeTimer = null;
  var rescanTimer = null;

  var trackedKey = null;
  var trackedName = null;
  var deadline = 0;
  // key -> true (expanded) / false (collapsed) from the previous scan.
  var prevGroupStates = {};
  var lastScanSignature = null;

  // Always-on load marker. If this line is missing from the console the
  // content script never injected: reload the extension, refresh the tab,
  // and confirm the URL is under https://dev.azure.com/.
  console.info('[standup-timer] content script loaded on', location.pathname);

  init();

  function init() {
    // The background page relays the reset-timer keyboard command here.
    api.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'standup-timer:reset') return;
      if (state === 'RUNNING' || state === 'EXPIRED') {
        sel.debugLog('reset requested via keyboard command');
        resetTracking('IDLE');
      }
    });

    storage.getSettings().then(function (loaded) {
      settings = loaded;
      sel.setDebug(settings.debug);

      storage.onSettingsChanged(function (changes) {
        if (changes.durationSeconds) {
          // Applies to the next countdown, a running one keeps its deadline.
          settings.durationSeconds = changes.durationSeconds.newValue;
        }
        if (changes.extraTimeNames) {
          settings.extraTimeNames = changes.extraTimeNames.newValue;
        }
        if (changes.extraTimeSeconds) {
          settings.extraTimeSeconds = changes.extraTimeSeconds.newValue;
        }
        if (changes.countOvertime) {
          settings.countOvertime = changes.countOvertime.newValue;
        }
        if (changes.debug) {
          settings.debug = changes.debug.newValue;
          sel.setDebug(settings.debug);
        }
      });

      // dev.azure.com navigates via pushState without page loads, so watch
      // the document for the taskboard appearing or disappearing. The
      // handler only compares strings and checks node presence, so the
      // body wide observer stays cheap.
      var routeObserver = new MutationObserver(scheduleRouteCheck);
      routeObserver.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('popstate', scheduleRouteCheck);
      scheduleRouteCheck();
    }).catch(function (err) {
      // Surface startup failures with our prefix so they are visible even
      // when the console is filtered on standup-timer.
      console.error('[standup-timer] init failed:', err);
    });
  }

  function scheduleRouteCheck() {
    if (routeTimer) return;
    routeTimer = setTimeout(function () {
      routeTimer = null;
      checkRoute();
    }, ROUTE_DEBOUNCE_MS);
  }

  function checkRoute() {
    var onTaskboard = ROUTE_RE.test(location.pathname);
    // Always-on breadcrumb, once per pathname, so a route mismatch is
    // visible without debug mode and without log spam.
    if (location.pathname !== lastLoggedPathname) {
      lastLoggedPathname = location.pathname;
      console.info(
        '[standup-timer] route check:', location.pathname,
        'sprintsHub=' + onTaskboard, 'debug=' + settings.debug
      );
    }
    if (!onTaskboard) {
      if (boardContainer) deactivate();
      return;
    }
    var container = sel.findBoardContainer();
    if (!container) {
      console.warn('[standup-timer] sprints route matched but no board container found');
      if (boardContainer) deactivate();
      return;
    }
    // React can replace the container node while the route is unchanged.
    if (container !== boardContainer || !boardContainer.isConnected) {
      if (boardContainer) deactivate();
      activate(container);
    }
  }

  function activate(container) {
    boardContainer = container;
    console.info('[standup-timer] activated, observing board for expand and collapse');

    // Expanding a group replaces row markup and toggles the collapsed-row
    // class rather than flipping aria-expanded, so watch class changes and
    // node replacements. The rescan behind this is debounced.
    boardObserver = new MutationObserver(scheduleRescan);
    boardObserver.observe(container, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    // Belt and braces for virtualised lists that replace nodes without
    // observable attribute flips.
    container.addEventListener('click', scheduleRescan, true);

    ensureLabel();
    // Groups already expanded on arrival are baseline, they do not start a
    // countdown. The timer reacts to expansions the team performs live.
    var groups = sel.getPersonGroups(container);
    prevGroupStates = statesOf(groups);
    state =
      groups.length > 0 && sel.isPersonFilterAll(container, groups)
        ? 'IDLE'
        : 'INACTIVE';
    lastScanSignature = null;
    if (settings.debug) sel.diagnose();
    render();
  }

  function deactivate() {
    sel.debugLog('leaving taskboard, deactivating');
    if (boardObserver) {
      boardObserver.disconnect();
      boardObserver = null;
    }
    if (boardContainer) {
      boardContainer.removeEventListener('click', scheduleRescan, true);
      boardContainer = null;
    }
    stopTicking();
    trackedKey = null;
    trackedName = null;
    prevGroupStates = {};
    lastScanSignature = null;
    state = 'INACTIVE';
    render();
  }

  function scheduleRescan() {
    if (rescanTimer) return;
    rescanTimer = setTimeout(function () {
      rescanTimer = null;
      rescan();
    }, RESCAN_DEBOUNCE_MS);
  }

  function statesOf(groups) {
    var map = {};
    for (var i = 0; i < groups.length; i++) {
      map[groups[i].key] = groups[i].expanded;
    }
    return map;
  }

  function rescan() {
    if (!boardContainer || !boardContainer.isConnected) {
      scheduleRouteCheck();
      return;
    }

    var groups = sel.getPersonGroups(boardContainer);
    var met = groups.length > 0 && sel.isPersonFilterAll(boardContainer, groups);

    // One line whenever the recognised picture changes. Proves that expand
    // and collapse mutations reach us even when zero groups are detected.
    var signature = met + '|' + groups.map(function (g) {
      return g.key + ':' + g.expanded;
    }).join(',');
    if (signature !== lastScanSignature) {
      lastScanSignature = signature;
      sel.debugLog(
        'scan:', groups.length, 'person groups,',
        'conditions met:', met + ',',
        'expanded:', collectExpanded(groups).join(', ') || '(none)'
      );
    }

    if (!met) {
      prevGroupStates = statesOf(groups);
      resetTracking('INACTIVE');
      return;
    }

    var current = statesOf(groups);
    var newlyExpanded = [];
    var k;
    for (k in current) {
      if (current[k] === true && prevGroupStates[k] !== true) {
        newlyExpanded.push(k);
      }
    }
    // A group that was collapsed and has now vanished from detection was
    // most likely expanded into markup we do not recognise yet. Treat that
    // as an expansion so the timer still starts.
    for (k in prevGroupStates) {
      if (prevGroupStates[k] === false && !(k in current)) {
        newlyExpanded.push(k);
      }
    }

    if (state === 'INACTIVE') state = 'IDLE';

    if (newlyExpanded.length >= BULK_THRESHOLD) {
      sel.debugLog('bulk expand detected, staying idle');
      resetTracking('IDLE');
    } else if (newlyExpanded.length >= 1) {
      // Most recently expanded person wins.
      var key = newlyExpanded[newlyExpanded.length - 1];
      startCountdown(key, nameForKey(groups, key));
    }

    // The tracked person reappearing as collapsed resets the timer. Other
    // groups collapsing or staying open changes nothing. A tracked person
    // who is simply undetected while expanded keeps their countdown.
    if (trackedKey && current[trackedKey] === false) {
      sel.debugLog('tracked group collapsed, resetting');
      resetTracking('IDLE');
    }

    prevGroupStates = current;
    render();
  }

  function collectExpanded(groups) {
    var keys = [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].expanded) keys.push(groups[i].key);
    }
    return keys;
  }

  function nameForKey(groups, key) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].key === key) return groups[i].name;
    }
    return key;
  }

  // Base duration, plus the extra allowance when this person is on the
  // extra time list. Guards against a bad stored value so a broken setting
  // cannot produce a NaN deadline.
  function durationForPerson(name) {
    var base = Number(settings.durationSeconds);
    if (!isFinite(base) || base <= 0) base = ns.DEFAULT_SETTINGS.durationSeconds;
    if (!names || !names.matchesAnyEntry(name, settings.extraTimeNames)) return base;
    var extra = Number(settings.extraTimeSeconds);
    if (!isFinite(extra) || extra <= 0) return base;
    return base + extra;
  }

  function startCountdown(key, name) {
    trackedKey = key;
    trackedName = name;
    var seconds = durationForPerson(name);
    deadline = Date.now() + seconds * 1000;
    state = 'RUNNING';
    sel.debugLog(
      'countdown started for', name, seconds + 's',
      seconds > settings.durationSeconds ? '(includes extra time)' : ''
    );
    startTicking();
    render();
  }

  function resetTracking(nextState) {
    trackedKey = null;
    trackedName = null;
    stopTicking();
    state = nextState;
    render();
  }

  function startTicking() {
    if (tickHandle) return;
    tickHandle = setInterval(tick, TICK_MS);
  }

  function stopTicking() {
    if (!tickHandle) return;
    clearInterval(tickHandle);
    tickHandle = null;
  }

  function tick() {
    if (state !== 'RUNNING' && state !== 'EXPIRED') {
      stopTicking();
      return;
    }
    if (state === 'RUNNING' && Date.now() >= deadline) {
      state = 'EXPIRED';
    }
    render();
  }

  function ensureLabel() {
    if (label && document.body.contains(label)) return;
    label = document.createElement('div');
    label.className = 'standup-timer-label';
    label.setAttribute('role', 'timer');
    label.setAttribute('aria-live', 'off');

    var nameEl = document.createElement('span');
    nameEl.className = 'standup-timer-name';
    var timeEl = document.createElement('span');
    timeEl.className = 'standup-timer-time';

    // The label itself stays pointer-events: none so it never swallows board
    // clicks. Only this button opts back in.
    var closeEl = document.createElement('button');
    closeEl.className = 'standup-timer-close';
    closeEl.type = 'button';
    closeEl.title = 'Dismiss timer';
    closeEl.setAttribute('aria-label', 'Dismiss stand-up timer');
    closeEl.textContent = '×';
    closeEl.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      sel.debugLog('dismissed via close button');
      // Same reset as the keyboard command. The tracked person stays in
      // prevGroupStates as expanded, so the timer only returns when someone
      // is collapsed and expanded again.
      resetTracking('IDLE');
    });

    label.appendChild(nameEl);
    label.appendChild(timeEl);
    label.appendChild(closeEl);
    document.body.appendChild(label);
  }

  function formatRemaining(ms) {
    var totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function formatOvertime(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    var text = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    return totalSeconds === 0 ? text : '-' + text;
  }

  function render() {
    if (!label) return;
    var visible = state === 'RUNNING' || state === 'EXPIRED';
    label.classList.toggle('standup-timer-visible', visible);
    label.classList.toggle('standup-timer-expired', state === 'EXPIRED');
    if (!visible) return;
    label.querySelector('.standup-timer-name').textContent = trackedName || '';
    label.querySelector('.standup-timer-time').textContent =
      state === 'EXPIRED'
        ? settings.countOvertime
          ? formatOvertime(Date.now() - deadline)
          : '0:00'
        : formatRemaining(deadline - Date.now());
  }
})();
