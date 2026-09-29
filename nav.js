/* The row of links at the top of every page — one shared place to
   build it now, not nine copies that can drift. Tool-local D-075,
   2026-09-18. Mark: "as the login ID defines your access to certain
   tasks - I would prefer that the Menu Buttons available are only
   relevant to the 'status' of the person signed in... Everyone only
   gets to see Schedule - To-Do-List - Fix a Fault - Completed.
   Managers - have those plus Asset - Staff - Base Dash (where
   relevant). Admin - all of the above plus Edit Checklists."

   Inspection stays in the everyone tier alongside those four — it's
   the same everyday, no-special-permission action as the rest of
   them, just not named in Mark's own shorthand list. "Where relevant"
   for Base Dashboard is the same signal base-dashboard.html's own
   routing already uses (D-053/D-054/D-055): real access to more than
   one lodge, `me.locations.length > 1` — not a separate flag to keep
   in sync with that one.

   Every page that shows this row loads this file first
   (`<script src="./nav.js">`), then calls `navHtml(me, "Active Page")`
   — `me` is whatever that page already read from `sessionStorage`
   itself; a null/missing `me` renders just the everyone-tier links,
   which never actually shows in practice since every page that
   carries this row already gates on being signed in first.

   A third, optional `hide` array drops specific labels for one page
   only — added 2026-09-23 for base-rollup.html, Mark: "on the Roll-up
   page the following are not required: Inspection, Fix a Fault." Both
   are single-item, single-camp workflows that don't fit a cross-camp
   read-only roll-up; every other page still shows them, since this
   only ever filters what one specific caller asked to drop. The
   roll-up also drops the five its own tabs replace (D-092). */
function navHtml(me, active, hide) {
  var links = [
    { href: "./schedule.html", label: "Schedule" },
    { href: "./inspection.html", label: "Inspection" },
    { href: "./dashboard.html", label: "To-do list" },
    { href: "./fix.html", label: "Fix a fault" },
    { href: "./completed.html", label: "Completed" },
  ];
  if (me && me.is_manager) {
    links.push({ href: "./assets.html", label: "Assets" });
    links.push({ href: "./staff.html", label: "Staff" });
  }
  if (me && (me.is_manager || me.is_administrator)) {
    // Reports (tool-local D-080) — Mark: "only visible to camp
    // managers, base managers and admin - as we have done with other
    // buttons." Every real base manager also carries is_manager true
    // (checked directly), so this is the same single check Assets and
    // Staff already use, not a new flag to keep in step with those.
    links.push({ href: "./reports.html", label: "Reports" });
  }
  if (me && me.locations && me.locations.length > 1) {
    // The page this reaches calls itself the Maintenance Dashboard, so the
    // button that reaches it says the same — Mark, 2026-09-29: "if that padded
    // button takes us to the Maintenance Dashboard - then it must say
    // Maintenance Dashboard." A control named differently from the place it
    // goes is a control people hesitate over.
    //
    // The file is still base-dashboard.html. Renaming that would break every
    // bookmark and every link in the tool for no gain the user can see.
    links.push({ href: "./base-dashboard.html", label: "Maintenance Dashboard" });
  }
  if (me && me.is_administrator) {
    links.push({ href: "./admin-checklists.html", label: "Edit Checklists" });
  }
  // Last, so it can drop any tier's links, not only the everyone tier.
  if (hide && hide.length) {
    links = links.filter(function (l) { return hide.indexOf(l.label) === -1; });
  }
  var row = '<p class="nav">' + links.map(function (l) {
    return active === l.label ? "<b>" + l.label + "</b>" : '<a href="' + l.href + '">' + l.label + "</a>";
  }).join("") + "</p>";

  return row + navMenuHtml(links, active, me);
}

/* The menu that stays put.

   Mark, 2026-09-29: "I am finding it frustrating that the options to switch
   from schedule to the to-do list etc dissappear as you scroll down. The same
   for changing camp and signing out. Is it not possible to have a drop down
   icon on the top right that stays there as you scroll down that you can then
   open and you can then access then other pages - or sign out or change camp?"

   Yes. A fixed button in the top right, on every page that carries the nav row,
   opening the same links plus Change camp and Sign out.

   The row at the top of the page stays as it is. It is the faster thing to use
   while you are up there, and removing it would cost a click for the common
   case to save one for the scrolled case. This is the answer to being scrolled,
   not a replacement for being at the top.

   Change camp and Sign out are driven through what the page already has —
   `window.signOut()` and the same base-dashboard link `#changeCampBtn` uses —
   rather than reimplemented here, so there is still one definition of each per
   page and this cannot drift from it. Change camp shows on the same signal the
   Maintenance Dashboard link does: real access to more than one lodge. */
function navMenuHtml(links, active, me) {
  var multiCamp = !!(me && me.locations && me.locations.length > 1);
  var items = links.map(function (l) {
    return active === l.label
      ? '<button class="navm-item navm-here" disabled>' + l.label + "</button>"
      : '<button class="navm-item" onclick="location.href=\'' + l.href + '\'">' + l.label + "</button>";
  }).join("");

  var tail = "";
  if (multiCamp) {
    tail += '<button class="navm-item navm-sep" onclick="location.href=\'./base-dashboard.html\'">Change camp</button>';
  }
  tail += '<button class="navm-item navm-out' + (multiCamp ? "" : " navm-sep") +
          '" onclick="navMenuClose(); if (window.signOut) window.signOut();">Sign out</button>';

  return '<div class="navm" id="navm">' +
    '<button class="navm-btn" id="navmBtn" aria-expanded="false" aria-label="Menu" ' +
      'onclick="navMenuToggle()">☰</button>' +
    '<div class="navm-panel" id="navmPanel" hidden>' + items + tail + "</div>" +
  "</div>";
}

function navMenuToggle() {
  var panel = document.getElementById("navmPanel"), btn = document.getElementById("navmBtn");
  if (!panel) return;
  var open = panel.hidden;
  panel.hidden = !open;
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function navMenuClose() {
  var panel = document.getElementById("navmPanel"), btn = document.getElementById("navmBtn");
  if (panel) panel.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* Close on Escape, and on a click anywhere outside it — a menu that can only
   be closed by the button that opened it is a menu people leave open. */
document.addEventListener("keydown", function (e) { if (e.key === "Escape") navMenuClose(); });
document.addEventListener("click", function (e) {
  var wrap = document.getElementById("navm");
  if (wrap && !wrap.contains(e.target)) navMenuClose();
});

/* The styles live here rather than in each page's own <style>, so there is one
   copy rather than ten that drift. Every button is a real padded button, per
   the root CLAUDE.md rule about navigation. */
(function () {
  var css = document.createElement("style");
  css.textContent =
    ".navm{position:fixed;top:10px;right:10px;z-index:200}" +
    ".navm-btn{width:42px;height:42px;padding:0;font-size:19px;line-height:1;border-radius:9px;" +
      "border:1px solid #43594A;background:#43594A;color:#fff;cursor:pointer;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.22)}" +
    ".navm-btn:hover{background:#35473B}" +
    ".navm-panel{position:absolute;top:48px;right:0;min-width:208px;background:#fff;" +
      "border:1px solid #C9C2AC;border-radius:9px;padding:6px;display:flex;flex-direction:column;gap:4px;" +
      "box-shadow:0 8px 28px rgba(0,0,0,.22)}" +
    ".navm-item{display:block;width:100%;text-align:left;padding:9px 12px;font-size:14px;" +
      "font-family:inherit;border:1px solid #C9C2AC;border-radius:7px;background:#fff;color:#232019;cursor:pointer}" +
    ".navm-item:hover{background:#F2EFE6}" +
    /* Where you already are: shown, so the menu says where you stand, but not
       offered as somewhere to go. */
    ".navm-here{color:#43594A;border-color:#43594A;background:#EAF1EC;opacity:1;cursor:default;font-weight:600}" +
    ".navm-sep{margin-top:6px;border-top-width:1px}" +
    ".navm-out{color:#8A3F27;border-color:#D8B8AC}" +
    ".navm-panel:before{content:'Go to';display:block;font-size:11px;color:#8C8571;" +
      "text-transform:uppercase;letter-spacing:.04em;padding:2px 12px 4px}" +
    /* Keep the page's own title clear of the button. Every page that carries
       this menu puts an h1 top-left, and on a narrow screen a long camp name
       would otherwise run underneath it. */
    "h1{padding-right:52px}" +
    "@media print{.navm{display:none!important}h1{padding-right:0}}";
  document.head.appendChild(css);
})();
