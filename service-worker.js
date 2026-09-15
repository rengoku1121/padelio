// Cleanup service worker: pass-through network and unregister itself.
// Keep this file reachable so older registrations can update safely.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((k) => (/^padel-cache-/i.test(k) ? caches.delete(k) : Promise.resolve()))
        );
      } catch {}

      try {
        await self.registration.unregister();
      } catch {}

      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach((c) => c.navigate(c.url));
      } catch {}
    })()
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
