/* JEXI OS — service worker (B84: web push when the app is closed). */
self.addEventListener('push', (event) => {
  let title = 'JEXI';
  let body = '';
  let link = '';
  try {
    const data = event.data ? event.data.json() : {};
    title = data.title || 'JEXI';
    body = data.body || '';
    link = data.link || '';
  } catch (e) { /* non-JSON payload — show generic */ }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || 'JEXI has something for you.',
      icon: 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%230a0a0f%27/%3E%3Ctext x=%2716%27 y=%2722%27 font-family=%27Arial%27 font-size=%2717%27 font-weight=%27900%27 fill=%27%2300ff9d%27 text-anchor=%27middle%27%3EJ%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%230a0a0f%27/%3E%3Ctext x=%2716%27 y=%2722%27 font-family=%27Arial%27 font-size=%2717%27 font-weight=%27900%27 fill=%27%2300ff9d%27 text-anchor=%27middle%27%3EJ%3C/text%3E%3C/svg%3E',
      data: { link },
      tag: link || title,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data && event.notification.data.link;
  event.waitUntil(
    (async () => {
      const url = link && /^https?:/.test(link) ? link : self.location.origin + '/';
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) { await client.focus(); client.navigate(url); return; }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
