/* Bush Ways checks — service worker.
   Root D-023: this is what makes the pages open with no signal at all.
   It caches the pages themselves. It deliberately does NOT touch the API
   (a different origin) — the local copy of checklist content and the
   upload queue are separate pieces, not built yet.
   Bump VERSION on every change, or phones keep the old worker. */
var VERSION = "2026-09-21d";
var CACHE = "bw-shell-" + VERSION;

var SHELL = [
  "./",
  "./index.html",
  "./schedule.html",
  "./inspection.html",
  "./report.html",
  "./dashboard.html",
  "./completed.html",
  "./fix.html",
  "./assets.html",
  "./staff.html",
  "./base-dashboard.html",
  "./base-rollup.html",
  "./admin-checklists.html",
  "./consolidated.html",
  "./day-sheet.html",
  "./reports.html",
  "./nav.js",
  "./manifest.webmanifest",
  "./images/hero.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

// One missing file must not fail the whole install, or a renamed page
// silently leaves every phone with no offline copy of anything.
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function offlinePage() {
  return new Response(
    "<!doctype html><meta charset=utf-8>" +
    "<meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<body style=\"font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:40px 24px;background:#F7F5F0;color:#232019\">" +
    "<h1 style=\"font-size:19px\">Not saved on this phone yet</h1>" +
    "<p>This page has not been opened here before, so there is no copy to fall back on.</p>" +
    "<p>Open it once somewhere with WiFi and it will work without a signal after that.</p>",
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  // The API lives on supabase.co. Leave it strictly alone — caching a
  // checklist submission or a stale room list would be worse than failing.
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate: answer from the phone immediately, refresh behind.
  // Chosen over network-first deliberately — in a room with weak WiFi,
  // waiting on a request that may never answer is the thing to avoid.
  // The cost is that a change lands on the second load, not the first.
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200 && res.type === "basic") c.put(req, res.clone());
          return res;
        }).catch(function () {
          return hit || (req.mode === "navigate" ? offlinePage() : Response.error());
        });
        return hit || net;
      });
    })
  );
});
