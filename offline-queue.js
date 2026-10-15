/* Checks with no signal, sent only on WiFi — maintenance D-150, root D-019,
   root D-023.

   Two jobs, one file, shared by every page that records work:

   1. bwApi.get(url): every read from the server goes through here. With a
      connection, the answer is used and a copy kept on the phone; with none,
      the kept copy is used instead, so a check opens with no signal.

   2. bwQueue: every completed check or fault report goes into a queue on the
      phone (IndexedDB), photos and voice notes with it, and is sent from
      there ONLY on WiFi. Mark: "completed checks must wait in a que and only
      upload when in wifi signal."
        - Android (Chrome) reports its connection type: the queue sends by
          itself on WiFi and never on mobile data.
        - iPhone, and anything else that will not say: the queue waits for
          the person to tap "Send now — I'm on WiFi" (Mark: "build option A
          for the iphones").
        - A computer (no "Mobile" in its browser name) is treated as WiFi or
          a cable: office machines are never on a phone's data.
      Each item keeps who did it, when (done_at) and its own reference
      (client_ref), so the server records the real time and never records
      the same item twice if a send is repeated.

   The queue shows itself in a bar at the foot of the page — "3 checks
   waiting to send" — because nobody else can see it (root D-023).
   Plain JavaScript, no build step; loaded with <script src="./offline-queue.js">. */
(function () {
  var DB = "bw-offline", VER = 2, db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains("copies")) d.createObjectStore("copies");
        if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "ref" });
        // What the server turned down when it finally arrived, kept to be
        // shown (with its reason) until the person dismisses it.
        if (!d.objectStoreNames.contains("refused")) d.createObjectStore("refused", { keyPath: "ref" });
      };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  // ── Reads: network first, the phone's copy when there is no network ──
  // A copy is kept per address, so a checklist opened once with signal
  // opens again without. The server's answer always wins when it comes.
  function get(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.error) tx("copies", "readwrite", function (s) { s.put({ at: Date.now(), data: data }, url); }).catch(function () {});
      return data;
    }).catch(function (err) {
      return tx("copies", "readonly", function (s) { return s.get(url); }).then(function (kept) {
        if (!kept) throw new Error("No signal, and this hasn't been opened on this phone before. Open it once with signal first.");
        var d = kept.data;
        try { d = JSON.parse(JSON.stringify(d)); d._offline_copy_at = kept.at; } catch (e) {}
        return d;
      }, function () { throw err; });
    });
  }

  // ── When the queue may send ──
  function connectionKind() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var t = c && c.type;
    if (t === "wifi" || t === "ethernet") return "wifi";
    if (t === "cellular" || t === "wimax" || t === "bluetooth") return "data";
    if (!/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent || "")) return "wifi"; // a computer
    return "unknown"; // iPhone, or a phone that will not say
  }
  function mayAutoSend() { return navigator.onLine !== false && connectionKind() === "wifi"; }

  // ── The queue ──
  function newRef() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "q-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }
  function add(item) {
    item.ref = item.ref || newRef();
    item.done_at = item.done_at || new Date().toISOString();
    item.tries = 0;
    return tx("queue", "readwrite", function (s) { s.put(item); }).then(function () { refreshBar(); return item; });
  }
  function all() {
    return tx("queue", "readonly", function (s) { return s.getAll(); }).then(function (x) {
      return (x || []).sort(function (a, b) { return a.done_at < b.done_at ? -1 : 1; });
    });
  }
  function put(item) { return tx("queue", "readwrite", function (s) { s.put(item); }); }
  function remove(ref) { return tx("queue", "readwrite", function (s) { s.delete(ref); }); }

  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  // One item: a check (then its photos, against the issues it raised) or a
  // fault report. Each step that succeeds is saved back to the queue first,
  // so a dropped connection part-way never sends a step twice.
  function sendOne(item) {
    if (item.kind === "post") {
      var pb = Object.assign({}, item.body, { client_ref: item.ref, done_at: item.done_at });
      return post(item.url, pb).then(function (res) {
        if (res.status >= 500) throw new Error((res.body && res.body.error) || "The server had a problem; it will be tried again.");
        if (res.body && res.body.error) {
          // Turned down (not allowed, already done, no longer there): kept
          // aside with the reason, not retried for ever.
          return tx("refused", "readwrite", function (s) { s.put({ ref: item.ref, label: item.label, reason: res.body.error, at: Date.now() }); })
            .then(function () { return remove(item.ref); }).then(function () { return res.body; });
        }
        return remove(item.ref).then(function () { return res.body; });
      });
    }
    if (item.kind === "report") {
      var rb = Object.assign({}, item.body, { client_ref: item.ref, done_at: item.done_at });
      return post(item.url, rb).then(function (res) {
        if (res.body && res.body.error) throw Object.assign(new Error(res.body.error), { refused: res.status < 500 });
        return remove(item.ref).then(function () { return res.body; });
      });
    }
    var step = item.sent ? Promise.resolve(item.sent)
      : post(item.url, Object.assign({}, item.body, { client_ref: item.ref, done_at: item.done_at })).then(function (res) {
          if (res.body && res.body.error) throw Object.assign(new Error(res.body.error), { refused: res.status < 500 });
          item.sent = res.body;
          return put(item).then(function () { return res.body; });
        });
    return step.then(function (out) {
      var photos = item.photos || [];
      var chain = Promise.resolve();
      photos.forEach(function (p, i) {
        chain = chain.then(function () {
          if (p.done) return;
          var issueId = out.issue_ids ? out.issue_ids[p.item_id] : null;
          if (!issueId) { p.done = true; return; } // nowhere to attach it (already recorded before)
          return post(item.url.split("?")[0] + "?action=attach", { issue_id: issueId, added_by: item.body.person_id, image_data_url: p.data_url })
            .then(function (res) { if (res.body && !res.body.error) { p.done = true; return put(item); } });
        });
      });
      return chain.then(function () {
        if (photos.every(function (p) { return p.done; })) return remove(item.ref).then(function () { return out; });
        throw new Error("Some photos did not send; they will be tried again.");
      });
    });
  }

  // Any staff action (D-150, Stage 1): sent straight away on WiFi, otherwise
  // queued. Resolves with the server's answer, or { queued: true }.
  function send(url, body, label) {
    var item = { kind: "post", url: url, body: body, label: label || "A change" };
    if (!mayAutoSend()) return add(item).then(function () { return { queued: true }; });
    item.ref = newRef(); item.done_at = new Date().toISOString();
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({}, body, { client_ref: item.ref, done_at: item.done_at })) })
      .then(function (r) { return r.json(); }, function () {
        // No answer at all: no signal after all. Queued with the same
        // reference, so if it did arrive it is not done twice.
        return add(item).then(function () { return { queued: true }; });
      });
  }
  function refused() { return tx("refused", "readonly", function (s) { return s.getAll(); }).then(function (x) { return x || []; }); }
  function dismissRefused() { return tx("refused", "readwrite", function (s) { s.clear(); }).then(refreshBar); }

  var sending = false;
  // manual: the person tapped "Send now". Never sends on known mobile data.
  function flush(manual) {
    if (sending) return Promise.resolve({ sent: 0, busy: true });
    var kind = connectionKind();
    if (navigator.onLine === false) return Promise.resolve({ sent: 0, reason: "No signal." });
    if (kind === "data") return Promise.resolve({ sent: 0, reason: "This phone is on mobile data. The checks wait for WiFi." });
    if (kind === "unknown" && !manual) return Promise.resolve({ sent: 0, reason: "waiting for Send now" });
    sending = true; refreshBar();
    var sent = 0, failed = 0, lastError = null;
    return all().then(function (items) {
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () {
          return sendOne(it).then(function () { sent++; }, function (e) {
            failed++; lastError = e.message;
            if (e.refused) {
              // The server turned it down: shown with its reason, not retried.
              return tx("refused", "readwrite", function (s) { s.put({ ref: it.ref, label: it.label, reason: e.message, at: Date.now() }); })
                .then(function () { return remove(it.ref); }).catch(function () {});
            }
            it.tries = (it.tries || 0) + 1; it.last_error = e.message;
            return put(it).catch(function () {});
          });
        });
      });
      return chain;
    }).then(function () {
      sending = false; refreshBar();
      document.dispatchEvent(new CustomEvent("bwqueue:sent", { detail: { sent: sent, failed: failed } }));
      return { sent: sent, failed: failed, error: lastError };
    }, function (e) { sending = false; refreshBar(); return { sent: sent, failed: failed, error: e.message }; });
  }

  // ── The bar: always there while anything is waiting ──
  var bar = null;
  function refreshBar() {
    return Promise.all([all(), refused().catch(function () { return []; })]).then(function (both) {
      var items = both[0], turned = both[1];
      if (!document.body) return;
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "bwQueueBar";
        bar.setAttribute("role", "status");
        bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:300;background:#122d31;color:#fff;"
          + "font:600 14px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 14px calc(10px + env(safe-area-inset-bottom));"
          + "display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;box-shadow:0 -2px 10px rgba(0,0,0,.2)";
        document.body.appendChild(bar);
        document.body.style.paddingBottom = "64px";
      }
      if (!items.length && !turned.length) { bar.hidden = true; bar.style.display = "none"; return; }
      bar.hidden = false; bar.style.display = "flex";
      var n = items.length, kind = connectionKind();
      var what = !n ? "" : n + " " + (items.every(function (i) { return i.kind === "report"; }) ? (n === 1 ? "fault report" : "fault reports")
        : items.every(function (i) { return i.kind === "check"; }) ? (n === 1 ? "check" : "checks")
        : (n === 1 ? "item" : "items")) + " waiting to send";
      var why = sending ? "Sending…"
        : navigator.onLine === false ? "No signal. They send on WiFi."
        : kind === "data" ? "On mobile data. They send on WiFi."
        : kind === "wifi" ? "On WiFi, sending shortly."
        : "Send them when you are on WiFi.";
      var err = items.filter(function (i) { return i.last_error; }).map(function (i) { return i.last_error; })[0];
      var turnedHtml = turned.length
        ? '<span style="display:block;margin-top:4px;color:#F4C9A8">⚠ ' + turned.length + (turned.length === 1 ? " item was" : " items were")
          + ' not accepted when sent. <button type="button" id="bwRefusedShow" style="font:inherit;font-size:12.5px;padding:3px 9px;'
          + 'border-radius:6px;border:1px solid #F4C9A8;background:transparent;color:#F4C9A8;cursor:pointer">Show why</button></span>' : "";
      bar.innerHTML = '<span>' + (n ? '📤 ' + what + '<br><span style="font-weight:400;font-size:12.5px;opacity:.85">' + why
        + (err && !sending ? " Last try: " + esc(err) : "") + '</span>' : "") + turnedHtml + '</span>'
        + (n && kind === "unknown" && !sending && navigator.onLine !== false
          ? '<button type="button" id="bwSendNow" style="font:inherit;font-size:13.5px;padding:9px 14px;border-radius:8px;border:0;'
            + 'background:#F4E3D3;color:#4A3620;cursor:pointer">Send now — I\'m on WiFi</button>' : "");
      var rs = document.getElementById("bwRefusedShow");
      if (rs) rs.onclick = function () {
        alert(turned.map(function (t) { return "• " + (t.label || "An item") + ": " + t.reason; }).join("\n")
          + "\n\nThese were not recorded. Do them again if they are still needed.");
        dismissRefused();
      };
      var b = document.getElementById("bwSendNow");
      if (b) b.onclick = function () {
        if (!confirm("Only send on WiFi, never on mobile data. Are you on WiFi now?")) return;
        // Pages that keep copies refresh them too, now WiFi is confirmed.
        document.dispatchEvent(new CustomEvent("bwqueue:wifi-confirmed"));
        flush(true).then(function (r) { if (r.error) alert("Not everything sent: " + r.error + " It stays saved and will be tried again."); });
      };
    }).catch(function () {});
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // Try whenever things change, and every minute on WiFi.
  function tick() { refreshBar(); if (mayAutoSend()) flush(false); }
  window.addEventListener("online", tick);
  window.addEventListener("offline", refreshBar);
  var conn = navigator.connection; if (conn && conn.addEventListener) conn.addEventListener("change", tick);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  setInterval(tick, 60000);

  window.bwApi = { get: get };
  window.bwQueue = { add: add, all: all, send: send, flush: flush, mayAutoSend: mayAutoSend, connectionKind: connectionKind, refresh: refreshBar };
})();
