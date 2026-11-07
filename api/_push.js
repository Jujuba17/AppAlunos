// Envio de notificações (Web Push) para os aparelhos de um aluno.
// O "_" no nome impede que a Vercel crie um endereço para este arquivo.
// Precisa das variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (veja o README); sem elas, nada é enviado.
const webpush = require('web-push');

const PUB = process.env.VAPID_PUBLIC_KEY || '';
const PRIV = process.env.VAPID_PRIVATE_KEY || '';
const ativo = !!(PUB && PRIV);
if (ativo) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:professora@example.com', PUB, PRIV);

// Guarda a inscrição de um aparelho (no máximo 5 por aluno; o mais antigo sai).
async function inscrever(redis, id, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys
    || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  const limpa = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  const subs = ((await redis.get('push:' + id)) || []).filter((s) => s.endpoint !== limpa.endpoint);
  subs.push(limpa);
  await redis.set('push:' + id, subs.slice(-5));
  return true;
}

// Envia { title, body, url, tag } para todos os aparelhos do aluno. Aparelhos que saíram (404/410) são apagados.
async function notificar(redis, id, payload) {
  if (!ativo) return 0;
  const subs = (await redis.get('push:' + id)) || [];
  if (!subs.length) return 0;
  const ficam = []; let enviados = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 12 * 3600 }); ficam.push(s); enviados++; }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) { ficam.push(s); console.error('push', e.statusCode, e.body); } }
  }));
  if (ficam.length !== subs.length) await redis.set('push:' + id, ficam);
  return enviados;
}

module.exports = { ativo, PUB, inscrever, notificar };
