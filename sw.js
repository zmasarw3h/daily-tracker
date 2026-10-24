/* Offline worker for Qada Tracker.
   Keeps the app shell and the page fonts in a cache so the app opens with no connection.
   It never touches your prayer counts: those live in the page's local storage. */
var VERSION = 'qada-shell-v1';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
var FONT_CSS = 'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=DM+Sans:opsz,wght@9..40,400..700&display=swap';
var FONT_SUBSETS = { latin: 1, arabic: 1 };

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

// The page asks for the fonts once the worker is running, so a slow font download never delays install.
self.addEventListener('message', function (event) {
  if (event.data === 'precache-fonts') {
    event.waitUntil(caches.open(VERSION).then(precacheFonts).catch(function () { /* retried on the next visit */ }));
  }
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

async function precacheFonts(cache) {
  if (await cache.match(FONT_CSS)) return;
  var res = await fetch(FONT_CSS);
  if (!res.ok) return;
  var css = await res.clone().text();
  var re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{[^}]*?url\((https:[^)]+)\)/g;
  var m, urls = [];
  while ((m = re.exec(css))) { if (FONT_SUBSETS[m[1]]) urls.push(m[2]); }
  var stored = await Promise.all(urls.map(async function (u) {
    try { var r = await fetch(u); if (!r.ok) return false; await cache.put(u, r); return true; } catch (e) { return false; }
  }));
  // Store the stylesheet last, so a partial download is retried on the next visit.
  if (stored.every(Boolean)) await cache.put(FONT_CSS, res);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  event.respondWith((async function () {
    var cache = await caches.open(VERSION);
    var hit = await cache.match(req, { ignoreSearch: sameOrigin });
    var network = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(function () { return null; });
    if (hit) { event.waitUntil(network); return hit; }
    var res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      var shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return Response.error();
  })());
});
