// স্মার্ট স্কুল — শুধু হাজিরা অ্যাপের (আলাদা Vercel project) Service Worker
// অটো আপডেট: FILES-এর কোনো ফাইল (পেজ, notice.js, লোগো, আইকন…) বদলালে SW নিজেই ধরে ব্যানার দেখায়; VERSION হাতে বাড়াতে হয় না।
var VERSION = 'v16';
var BASE = new URL(self.registration.scope).pathname;   // যে ফোল্ডারে বসানো, সেটিই scope (মূল সাইটের সাথে মেলে না)
var META = 'att-meta';   // ফাইলের হ্যাশ জমা থাকে (VERSION বদলালেও মোছে না)
var SHELL = 'att-shell-' + VERSION;
var RUNTIME = 'att-runtime-' + VERSION;
var APP = BASE;   // এই project-এ অ্যাপ মূল পথেই থাকে
var MAX_RUNTIME = 200, MAX_PAGES = 80;
var FILES = [BASE, BASE + 'manifest.webmanifest', BASE + 'icon-192.png', BASE + 'icon-512.png', BASE + 'maskable-192.png', BASE + 'maskable-512.png'];
var CORE = {}; CORE[BASE] = 1; CORE[BASE + 'manifest.webmanifest'] = 1; CORE[BASE + 'icon-192.png'] = 1; CORE[BASE + 'icon-512.png'] = 1;

var OFFLINE_HTML = '<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>অফলাইন</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#4c6b1f;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px}' +
  'h1{font-size:22px;margin:8px 0}p{opacity:.92;line-height:1.7}a,button{display:inline-block;margin:6px;padding:12px 20px;border-radius:99px;border:0;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer}' +
  'a{background:#fff;color:#4c6b1f}button{background:#c8102e;color:#fff}</style></head><body><div style="max-width:360px"><div style="font-size:48px">📴</div><h1>আপনি এখন অফলাইনে আছেন</h1>' +
  '<p>এই পেজটি আগে খোলা হয়নি, তাই ফোনে জমা নেই। ইন্টারনেট চালু করে আবার চেষ্টা করুন।</p>' +
  '<button onclick="location.reload()">আবার চেষ্টা করুন</button><a href="' + BASE + '">হাজিরা অ্যাপ</a></div></body></html>';

// দুর্বল নেটে fetch যেন ঝুলে না থাকে
function fetchT(url, opt, ms) {
  opt = opt || {};
  if (typeof AbortController === 'undefined') return fetch(url, opt);
  var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms || 15000);
  opt.signal = c.signal;
  return fetch(url, opt).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
}
function offlinePage() {
  return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function clean(res) {
  if (res && res.redirected) return new Response(res.body, { status: 200, statusText: 'OK', headers: res.headers });
  return res;
}
function isApp(url) { return url.pathname === BASE || url.pathname === BASE + 'index.html'; }
function isHome(url) { return isApp(url); }
function watched(url) { return isApp(url) || isHome(url); }
function cacheKey(url) {
  var p = url.pathname;
  if (p === BASE + 'index.html') p = BASE;
  return new Request(url.origin + p);
}
function digest(res) {
  return res.clone().arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-1', b); }).then(function (h) {
    return Array.prototype.map.call(new Uint8Array(h), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  });
}
function notifyUpdated() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ type: 'CONTENT_UPDATED' }); });
  });
}
function changed(oldRes, newRes) {
  if (!oldRes || !newRes) return Promise.resolve();
  return Promise.all([digest(oldRes), digest(newRes)]).then(function (h) {
    if (h[0] !== h[1]) return notifyUpdated();
  }).catch(function () {});
}
function trim(cache, max, keepCore) {
  return cache.keys().then(function (keys) {
    var extra = keys.length - max;
    if (extra <= 0) return;
    var del = [];
    for (var i = 0; i < keys.length && del.length < extra; i++) {
      var p = new URL(keys[i].url).pathname;
      if (keepCore && CORE[p]) continue;
      del.push(keys[i]);
    }
    return Promise.all(del.map(function (k) { return cache.delete(k); }));
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return Promise.all(FILES.map(function (u) {
        return fetchT(u, { credentials: 'same-origin' }, 25000).then(function (r) { if (r && r.ok) return c.put(u, clean(r)); }).catch(function () {});
      }));
    }).then(function () {
      if (!self.registration.active) return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('att-') === 0 && k !== SHELL && k !== RUNTIME && k !== META; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d.type === 'CHECK_PAGE') { e.waitUntil(checkAll()); }
});

// সব মূল ফাইল নতুন করে এনে হ্যাশ মেলানো; কিছু বদলালে ক্যাশ হালনাগাদ + বার্তা
var checking = false, lastCheck = 0;
function checkAll() {
  if (checking || Date.now() - lastCheck < 180000) return Promise.resolve();   // ৩ মিনিটে একবারের বেশি নয় (নেট বাঁচাতে)
  lastCheck = Date.now();
  checking = true;
  return Promise.all([caches.open(SHELL), caches.open(META)]).then(function (cs) {
    var shell = cs[0], meta = cs[1], any = false, first = false;
    return Promise.all(FILES.map(function (u) {
      return fetchT(u, { cache: 'no-store', credentials: 'same-origin' }, 20000).then(function (r) {
        if (!r || !r.ok) return;
        var res = clean(r.clone());
        return digest(r).then(function (h) {
          return meta.match(u).then(function (old) {
            return (old ? old.text() : Promise.resolve(null)).then(function (oh) {
              if (oh === null) first = true;
              else if (oh !== h) any = true;
              if (oh !== h) return Promise.all([meta.put(u, new Response(h)), shell.put(u, res)]);
            });
          });
        });
      }).catch(function () {});
    })).then(function () { if (any) return notifyUpdated(); });
  }).catch(function () {}).then(function () { checking = false; });
}

var lastApp = 0;
function appPage(req) {
  return caches.open(SHELL).then(function (c) {
    return c.match(APP).then(function (hit) {
      // ক্যাশে থাকলে তাৎক্ষণিক খোলে; পেছনের হালনাগাদ ১০ মিনিটে একবার (ডেটার নেট দখল না করতে)
      if (hit && Date.now() - lastApp < 600000) return hit.clone();
      lastApp = Date.now();
      var net = fetchT(req.url, { credentials: 'same-origin' }, hit ? 20000 : 45000).then(function (r) {
        if (r && r.ok) {
          var store = r.clone(), cmp = r.clone();
          changed(hit, cmp).then(function () { return c.put(APP, clean(store)); });
        }
        return r;
      }).catch(function () { return null; });
      return hit ? hit.clone() : net.then(function (r) { return r || offlinePage(); });
    });
  });
}

function netFirst(req, key, cacheName, fallbackFn, watch) {
  return new Promise(function (resolve) {
    var done = false;
    function fallback() {
      caches.open(cacheName).then(function (c) { return c.match(key, { ignoreSearch: true }); })
        .then(function (hit) { resolve(hit || fallbackFn()); });
    }
    var timer = setTimeout(function () {
      if (done) return;
      caches.open(cacheName).then(function (c) { return c.match(key, { ignoreSearch: true }); }).then(function (hit) {
        if (hit && !done) { done = true; resolve(hit); }
      });
    }, 4000);
    fetch(req).then(function (res) {
      // পরিবর্তন: অন্য সাইটের (CDN) script/style-ও (opaque) ক্যাশ হবে, যাতে অফলাইনে চলে
      if (res && (res.ok || res.type === 'opaque')) {
        var store = res.clone(), cmp = res.clone();
        caches.open(cacheName).then(function (c) {
          return c.match(key).then(function (old) {
            return (watch ? changed(old, cmp) : Promise.resolve()).then(function () {
              return c.put(key, clean(store));
            }).then(function () { return cacheName === SHELL ? trim(c, MAX_PAGES, true) : trim(c, MAX_RUNTIME, false); });
          });
        }).catch(function () {});
      }
      if (done) return;
      done = true; clearTimeout(timer); resolve(res);
    }).catch(function () {
      if (done) return;
      done = true; clearTimeout(timer); fallback();
    });
  });
}

function swr(req) {
  return caches.open(RUNTIME).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).then(function () { trim(c, MAX_RUNTIME, false); });
        return res;
      }).catch(function () { return null; });
      return hit || net.then(function (r) { return r || Response.error(); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.hostname === 'script.google.com' || /googleusercontent\.com$/.test(url.hostname)) return;
  var same = url.origin === location.origin;
  if (same && url.pathname.indexOf(BASE) !== 0) return;
  if (same && url.pathname.indexOf('/api/') === 0) return;

  if (req.mode === 'navigate') {
    if (!same) return;
    if (isApp(url)) { e.respondWith(appPage(req)); return; }
    e.respondWith(netFirst(req, cacheKey(url), SHELL, offlinePage, isHome(url)));
    return;
  }
  var d = req.destination;
  if (d === 'image' || d === 'font') { e.respondWith(swr(req)); return; }
  if (d === 'style' && !same) { e.respondWith(swr(req)); return; }   // Google Fonts CSS: ক্যাশ থেকে তাৎক্ষণিক
  if (d === 'script' || d === 'style') { e.respondWith(netFirst(req, req, RUNTIME, function () { return Response.error(); }, false)); return; }
});
