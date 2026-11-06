/* Service worker mínimo: existe só para o navegador permitir instalar o app na tela inicial.
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
