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
   carries this row already gates on being signed in first. */
function navHtml(me, active) {
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
    links.push({ href: "./base-dashboard.html", label: "Base Dashboard" });
  }
  if (me && me.is_administrator) {
    links.push({ href: "./admin-checklists.html", label: "Edit Checklists" });
  }
  return '<p class="nav">' + links.map(function (l) {
    return active === l.label ? "<b>" + l.label + "</b>" : '<a href="' + l.href + '">' + l.label + "</a>";
  }).join("") + "</p>";
}
