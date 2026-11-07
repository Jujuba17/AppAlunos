/* Service worker: permite instalar o app na tela inicial e mostra as notificações (provas novas e lembretes).
   Não guarda nada em cache e não tem modo offline: tudo vem sempre do servidor.
   Ao ativar, apaga os caches deixados pelo app antigo (alunos-shell-*). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Notificação enviada pelo servidor (api/_push.js): { title, body, url, tag }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Teoria Musical', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'teoria',
    data: { url: d.url || './' },
  }));
});

// Tocar na notificação abre o app (ou traz para a frente, se já estiver aberto).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const w = list.find((c) => c.url.startsWith(self.registration.scope));
      return w ? w.focus() : self.clients.openWindow(url);
    })
  );
});
