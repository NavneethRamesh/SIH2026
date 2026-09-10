const CACHE = 'trace-v8-worker-delete';
const ASSETS = ['./', './index.html', './styles.css', './fixes.css', './app.js', './motion.js', './workspace-journey.jpeg', './manifest.webmanifest', './icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request))));
