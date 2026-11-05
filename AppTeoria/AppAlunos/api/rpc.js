// API única do app: login, dados das alunas e painel da professora.
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const SECRET = process.env.SESSION_SECRET || '';
const DAYS = 30 * 864e5;

const hmac = (b) => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + hmac(b); };
function verify(t) {
  if (!t || !SECRET || typeof t !== 'string') return null;
  const [b, s] = t.split('.');
  if (!b || !s) return null;
  const ok = hmac(b);
  if (s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getObj = async (k) => (await redis.get(k)) || {};
const emptyProg = () => ({ stats: {}, err: {}, exams: {} });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!SECRET || !process.env.PROF_LOGIN || !process.env.PROF_PASSWORD)
    return res.status(500).json({ error: 'Servidor sem configuração (veja o README).' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { action } = b;
  try {
    /* ---------- login ---------- */
    if (action === 'login') {
      const l = String(b.login || '').trim().toLowerCase();
      const pw = String(b.password || '');
      if (l === String(process.env.PROF_LOGIN).trim().toLowerCase() && same(pw, process.env.PROF_PASSWORD))
        return res.json({ token: sign({ role: 'prof', exp: Date.now() + DAYS }) });
      const roster = await getObj('roster');
      const id = Object.keys(roster).find((i) => roster[i].login === l);
      if (id && same(hashPw(pw, roster[id].salt), roster[id].hash)) {
        const prog = (await redis.get('prog:' + id)) || emptyProg();
        prog.name = roster[id].name;
        prog.acc = Date.now(); prog.accN = (prog.accN || 0) + 1; prog.first = prog.first || prog.acc;
        await redis.set('prog:' + id, prog);
        return res.json({ token: sign({ role: 'aluna', id, exp: Date.now() + DAYS }) });
      }
      await sleep(600);
      return res.json({ error: 'Login ou senha incorretos.' });
    }

    const auth = verify(b.token);
    if (!auth) return res.status(401).json({ error: 'Sessão expirada.' });
    const exams = await getObj('exams');

    /* ---------- aluna ---------- */
    if (auth.role === 'aluna') {
      const id = auth.id;
      const roster = await getObj('roster');
      if (!roster[id]) return res.status(401).json({ error: 'Cadastro removido.' });
      const prog = (await redis.get('prog:' + id)) || emptyProg();
      if (action === 'me') {
        const open = Object.entries(exams).filter(([, e]) => e.open).map(([eid, e]) => ({ id: eid, title: e.title, n: e.n, open: true }));
        return res.json({ role: 'aluna', name: roster[id].name, unl: (await redis.get('unl:' + id)) || ['notas_sol'], prog, exams: open });
      }
      if (action === 'save') {
        prog.stats = b.stats || prog.stats; prog.err = b.err || prog.err; prog.cur = b.cur || null; prog.last = Date.now();
        await redis.set('prog:' + id, prog);
        return res.json({ ok: true });
      }
      if (action === 'startExam') {
        const e = exams[b.eid];
        if (!e || !e.open) return res.json({ error: 'Prova indisponível.' });
        if (prog.exams && prog.exams[b.eid]) return res.json({ error: 'ja_feita' });
        prog.exams = prog.exams || {}; prog.exams[b.eid] = { start: Date.now() };
        await redis.set('prog:' + id, prog);
        return res.json({ exam: { title: e.title, mods: e.mods, n: e.n, qs: e.qs ? e.qs.map((q) => ({ text: q.text, opts: q.opts, tag: q.tag })) : undefined } });
      }
      if (action === 'finishExam') {
        const cur = prog.exams && prog.exams[b.eid];
        if (!cur || cur.ok != null) return res.json({ error: 'Prova não iniciada.' });
        const ex = exams[b.eid];
        if (ex && ex.qs) {
          const ans = Array.isArray(b.answers) ? b.answers : [];
          let ok = 0; prog.err = prog.err || {};
          ex.qs.forEach((q, i) => {
            if (ans[i] === q.ans) ok++;
            else { const t = q.tag || 'Prova'; prog.err.prova = prog.err.prova || {}; prog.err.prova[t] = (prog.err.prova[t] || 0) + 1; }
          });
          prog.exams[b.eid] = { ok, tot: ex.qs.length, ts: Date.now() };
          prog.cur = null; prog.last = Date.now();
          await redis.set('prog:' + id, prog);
          return res.json({ ok, tot: ex.qs.length, err: prog.err });
        }
        prog.exams[b.eid] = { ok: +b.ok || 0, tot: +b.tot || 0, ts: Date.now() };
        prog.err = b.err || prog.err; prog.cur = null; prog.last = Date.now();
        await redis.set('prog:' + id, prog);
        return res.json({ ok: true });
      }
      return res.status(403).json({ error: 'Ação não permitida.' });
    }

    /* ---------- professora ---------- */
    if (auth.role !== 'prof') return res.status(403).json({ error: 'Sem permissão.' });
    const roster = await getObj('roster');
    const ids = Object.keys(roster);
    const loginTaken = (l, except) => ids.some((i) => i !== except && roster[i].login === l);

    if (action === 'me') {
      const progs = ids.length ? await redis.mget(...ids.map((i) => 'prog:' + i)) : [];
      const unls = ids.length ? await redis.mget(...ids.map((i) => 'unl:' + i)) : [];
      const allUnl = {}; const allProg = [];
      ids.forEach((i, k) => { allUnl[i] = unls[k] || ['notas_sol']; if (progs[k]) allProg.push({ id: i, ...progs[k] }); });
      return res.json({
        role: 'prof', name: 'Professora', allUnl, allProg,
        roster: ids.map((i) => ({ id: i, name: roster[i].name, login: roster[i].login, start: roster[i].start || '' })),
        exams: Object.entries(exams).map(([id, e]) => ({ id, ...e })),
      });
    }
    if (action === 'addStudent') {
      const name = String(b.name || '').trim(), login = String(b.login || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!name || !login || !pw) return res.json({ error: 'Preencha nome, login e senha.' });
      if (loginTaken(login)) return res.json({ error: 'Esse login já existe.' });
      const salt = crypto.randomBytes(16).toString('hex');
      roster['r' + Date.now()] = { name, login, salt, hash: hashPw(pw, salt), start: b.start || '' };
      await redis.set('roster', roster);
      return res.json({ ok: true });
    }
    if (action === 'editStudent') {
      const r = roster[b.id]; if (!r) return res.json({ error: 'Aluna não encontrada.' });
      const login = String(b.login || '').trim().toLowerCase(), name = String(b.name || '').trim();
      if (!name || !login) return res.json({ error: 'Nome e login são obrigatórios.' });
      if (loginTaken(login, b.id)) return res.json({ error: 'Esse login já existe.' });
      r.name = name; r.login = login; r.start = b.start || '';
      if (b.password) { r.salt = crypto.randomBytes(16).toString('hex'); r.hash = hashPw(b.password, r.salt); }
      await redis.set('roster', roster);
      return res.json({ ok: true });
    }
    if (action === 'removeStudent') {
      delete roster[b.id];
      await redis.set('roster', roster);
      await redis.del('prog:' + b.id, 'unl:' + b.id);
      return res.json({ ok: true });
    }
    if (action === 'setUnl') {
      if (!roster[b.id] || !Array.isArray(b.mods)) return res.json({ error: 'Dados inválidos.' });
      await redis.set('unl:' + b.id, b.mods.map(String));
      return res.json({ ok: true });
    }
    if (action === 'createExam') {
      const title = String(b.title || '').trim();
      if (title && Array.isArray(b.qs) && b.qs.length && b.qs.length <= 60) {
        const qs = b.qs.map((q) => ({ text: String(q.text), opts: (q.opts || []).map(String), ans: +q.ans, tag: String(q.tag || '') }));
        exams['e' + Date.now()] = { title, mods: [], n: qs.length, open: false, qs };
        await redis.set('exams', exams);
        return res.json({ ok: true });
      }
      if (!title || !Array.isArray(b.mods) || !b.mods.length) return res.json({ error: 'Dê um título e escolha ao menos um módulo.' });
      exams['e' + Date.now()] = { title, mods: b.mods.map(String), n: Math.min(30, Math.max(3, +b.n || 10)), open: false };
      await redis.set('exams', exams);
      return res.json({ ok: true });
    }
    if (action === 'setExamOpen') {
      if (!exams[b.eid]) return res.json({ error: 'Prova não encontrada.' });
      exams[b.eid].open = !!b.open; await redis.set('exams', exams);
      return res.json({ ok: true });
    }
    if (action === 'deleteExam') { delete exams[b.eid]; await redis.set('exams', exams); return res.json({ ok: true }); }
    if (action === 'resetExam') {
      const prog = await redis.get('prog:' + b.id);
      if (prog && prog.exams) { delete prog.exams[b.eid]; await redis.set('prog:' + b.id, prog); }
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
};
