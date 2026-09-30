// Offline shell. The page is fetched from the network first so a new version
// shows up on the next visit; hashed assets never change, so they come from the
// cache. The AI endpoints and other origins are never touched.
const CACHE = 'daily-tracking-tool-v1'
const SHELL = ['./', './manifest.webmanifest', './favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const put = (request, response) => {
  if (response.ok) {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => put(new URL('./', self.registration.scope).href, response))
        .catch(() => caches.match(new URL('./', self.registration.scope).href)),
    )
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((response) => put(request, response))))
    return
  }

  // Everything else (icons, manifest): cached copy right away, refreshed in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request).then((response) => put(request, response))
      return hit ?? fresh
    }),
  )
})
