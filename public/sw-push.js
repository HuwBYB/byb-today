/* This is imported into the generated Workbox SW */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Reminder';
  const body  = data.body  || '';
  const tag   = data.tag   || 'byb';
  const url   = data.url   || '/';

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    badge: '/icons/app-icon-192.png',
    icon: '/icons/app-icon-192.png',
    data: { url }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ('focus' in w) { w.navigate(target); return w.focus(); }
    }
    return clients.openWindow(target);
  }));
});
