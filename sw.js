const CACHE_NAME = 'empire-elite-rides-v1'
const APP_SHELL = [
  '/',
  '/booking.html',
  '/styles.css',
  '/script.js',
  '/booking.js',
  '/pricing-client.js',
  '/config.js',
  '/site.webmanifest',
  '/assets/images/branding/empire-elite-icon-192.png',
  '/assets/images/branding/empire-elite-icon.png'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return
  event.respondWith(fetch(event.request)
    .then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
      return response
    })
    .catch(() => caches.match(event.request).then(response => response || caches.match('/booking.html'))))
})
