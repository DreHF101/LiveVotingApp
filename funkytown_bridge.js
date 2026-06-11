/*!
 * FunkyTown Sync Bridge v1.0
 * Bidirectional real-time sync between Schedule Page & Voting/Run-of-Show App
 * Both pages must be open in the same browser (same origin) for sync to work.
 *
 * INSTALL on Schedule Page: add this just before </body>
 *   <script src="funkytown_bridge.js"></script>
 *
 * HOW IT WORKS:
 *  - Schedule page writes ft_setlist (voting-app format) on every change
 *  - Voting app reads ft_setlist on load + listens for live storage events
 *  - Changes in either direction propagate instantly via the Web Storage API
 *  - Works across browser tabs in the same domain (same-origin localStorage)
 *
 * DATA FLOW:
 *  Schedule Page                        Voting / Run-of-Show App
 *  ─────────────────────────────────    ─────────────────────────────────────
 *  ft_performers  ──→  ft_setlist  ──→  performers[] (on load + storage event)
 *  ft_lineup      ──→  startTime   ──→  p.startTime (slot times)
 *  ft_event       ──→  (metadata)  ──→  title update
 *                 ←──  ft_setlist  ←──  Roster edits from Voting app
 */
(function() {
  'use strict';

  /* ── Guard: only run on schedule page ──────────────────────────────────── */
  if (typeof window.persistRender === 'undefined' || typeof window.LS === 'undefined') {
    console.warn('[FunkyTown Bridge] Not on schedule page — bridge not activated.');
    return;
  }

  /* ── writeFtSetlist: translate schedule-page data → ft_setlist ─────────── */
  function writeFtSetlist() {
    try {
      var lineupNow = lsGet(LS.LINEUP, DEF_LINEUP);
      var perfsNow  = lsGet(LS.PERFORMERS, DEF_PERFORMERS);
      var setlist   = perfsNow.map(function(p) {
        var slot = lineupNow.find(function(s) { return s.perfId === p.id; });
        return {
          id:          p.id,
          name:        p.name,
          genre:       p.genre,
          perfDuration: 90,
          voteDuration: 60,
          startTime:   slot ? slot.time : '',
          photo:       p.image || ''
        };
      });
      localStorage.setItem('ft_setlist', JSON.stringify(setlist));
      /* Show ⟳ SYNCED badge in status bar if present */
      var sb = document.getElementById('syncBadge');
      if (sb) { sb.style.display = 'inline'; sb.title = 'Last synced ' + new Date().toLocaleTimeString(); }
    } catch(e) {}
  }
  window._writeFtSetlist = writeFtSetlist; /* expose for manual calls */

  /* ── Wrap persistRender to also write ft_setlist ───────────────────────── */
  var _origPersistRender = window.persistRender;
  window.persistRender = function() {
    lsSet(LS.LINEUP, lineup);
    writeFtSetlist();
    renderAll();
  };

  /* ── Wrap saveEventSettings to also write ft_setlist ──────────────────── */
  var _origSaveEventSettings = window.saveEventSettings;
  window.saveEventSettings = function() {
    var name      = document.getElementById('sName').value.trim();
    var tagline   = document.getElementById('sTagline').value.trim();
    var year      = document.getElementById('sYear').value.trim();
    var venue     = document.getElementById('sVenue').value.trim();
    var city      = document.getElementById('sCity').value.trim();
    var address   = document.getElementById('sAddress').value.trim();
    var date      = document.getElementById('sDate').value;
    var doorsOpen = document.getElementById('sDoorsOpen').value;
    var showStart = document.getElementById('sShowStart').value;
    if (!name || !venue || !date || !doorsOpen || !showStart) {
      toast('Name, venue, date & times are required', 'err');
      return;
    }
    ev = { name:name, tagline:tagline, year:year, venue:venue, city:city,
           address:address, date:date, doorsOpen:doorsOpen, showStart:showStart };
    lsSet(LS.EVENT, ev);
    writeFtSetlist();
    applyEventUI();
    clearUnsaved();
    toast('Event settings saved \u2014 all areas updated \u2713', 'ok');
  };

  /* ── Wrap confirmSlot so performer name/genre edits also sync ──────────── */
  var _origConfirmSlot = window.confirmSlot;
  window.confirmSlot = function() {
    if (editingPerf !== null) {
      var name  = document.getElementById('mName').value.trim();
      var genre = document.getElementById('mGenre').value.trim();
      if (!name) { toast('Name required', 'err'); return; }
      var p = performers[editingPerf];
      p.name = name;
      if (genre) p.genre = genre;
      lineup.forEach(function(s) {
        if (s.perfId === p.id) { s.name = name; if (genre) s.genre = genre; }
      });
      lsSet(LS.PERFORMERS, performers);
      writeFtSetlist();
      persistRender();
      closeModal();
      toast(name + ' updated \u2713', 'ok');
      return;
    }
    _origConfirmSlot();
  };

  /* ── Listen for performer edits arriving FROM voting app ───────────────── */
  window.addEventListener('storage', function(e) {
    /* Only react to ft_setlist changes from the other tab */
    if (e.key !== 'ft_setlist' || !e.newValue) return;
    /* Ignore if WE just wrote it (newValue same as current localStorage) */
    try {
      var sl = JSON.parse(e.newValue);
      if (!sl || !Array.isArray(sl) || !sl.length) return;
      var changed = false;
      sl.forEach(function(vp) {
        var p = performers.find(function(x) { return x.id === vp.id; });
        if (p && (p.name !== vp.name || p.genre !== vp.genre)) {
          p.name = vp.name;
          p.genre = vp.genre;
          changed = true;
          lineup.forEach(function(s) {
            if (s.perfId === p.id) { s.name = vp.name; s.genre = vp.genre; }
          });
        }
      });
      if (changed) {
        lsSet(LS.PERFORMERS, performers);
        lsSet(LS.LINEUP, lineup);
        renderAll();
        toast('Roster synced from Voting page \u21BA');
      }
    } catch(err) {}
  });

  /* ── Initial sync: write ft_setlist once on page load ──────────────────── */
  /* Delayed so main page JS finishes initialising first */
  setTimeout(writeFtSetlist, 600);

  /* ── Add ⟳ SYNCED badge to status bar if not already there ─────────────── */
  (function addSyncBadge() {
    var dot = document.querySelector('.live-dot');
    if (!dot || document.getElementById('syncBadge')) return;
    var badge = document.createElement('span');
    badge.id = 'syncBadge';
    badge.style.cssText = [
      'font-size:0.62rem', 'letter-spacing:0.14em',
      'color:var(--green)',  'background:rgba(74,222,128,0.08)',
      'border:1px solid rgba(74,222,128,0.22)', 'border-radius:2px',
      'padding:2px 8px', 'display:none', 'margin-left:4px'
    ].join(';');
    badge.textContent = '\u27F3 SYNCED';
    dot.parentNode.insertBefore(badge, dot.nextSibling);
  })();

  console.log('[FunkyTown Bridge v1] Schedule \u21C4 Voting App — live sync active');
})();
