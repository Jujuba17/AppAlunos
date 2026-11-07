// Lembrete diário: a Vercel chama este endereço uma vez por dia (veja vercel.json).
// Manda uma notificação para cada aluno com notificações ativas que ainda não entrou no app hoje.
const { Redis } = require('@upstash/redis');
const { ativo, notificar } = require('./_push');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const dia = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD no horário de Brasília
const FRASES = [
  (n) => `${n}, hora de praticar! 🎵 Que tal um nível hoje?`,
  (n) => `${n}, suas notas estão com saudade 🎶 Faça um exercício rapidinho.`,
  (n) => `${n}, que tal ganhar umas estrelas hoje? ⭐`,
  (n) => `${n}, 5 minutinhos de teoria musical hoje? 🎼`,
];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // A Vercel envia "Authorization: Bearer <CRON_SECRET>"; sem isso ninguém de fora consegue disparar os lembretes.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return res.status(401).json({ error: 'Sem permissão.' });
  if (!ativo) return res.json({ ok: true, enviados: 0, aviso: 'Notificações sem configuração (VAPID).' });
  try {
    const roster = (await redis.get('roster')) || {};
    const ids = Object.keys(roster);
    if (!ids.length) return res.json({ ok: true, enviados: 0 });
    const [progs, pushes, vis] = await Promise.all(['prog:', 'push:', 'vis:'].map((p) => redis.mget(...ids.map((i) => p + i))));
    const hoje = dia(Date.now());
    let enviados = 0;
    for (let k = 0; k < ids.length; k++) {
      const p = progs[k] || {};
      if (!pushes[k] || !pushes[k].length) continue;
      const visto = Math.max(p.acc || 0, p.last || 0, +vis[k] || 0); // login, último exercício ou última vez que abriu o app
      if (visto && dia(visto) === hoje) continue; // já entrou hoje
      const nome = String(roster[ids[k]].name || '').split(' ')[0] || 'Oi';
      const body = FRASES[Math.floor(Math.random() * FRASES.length)](nome);
      enviados += await notificar(redis, ids[k], { title: 'Teoria Musical', body, url: './', tag: 'lembrete' });
    }
    return res.json({ ok: true, enviados });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
};
