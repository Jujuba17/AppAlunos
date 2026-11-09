// API única do app: login, dados dos alunos e painel da professora.
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const PROVAS = require('./_provas');
const PUSH = require('./_push');
// Provas prontas: existem sempre (não precisam ser "adicionadas"); o id é a chave do arquivo _provas.js.
const PRONTAS = Object.fromEntries(Object.entries(PROVAS).map(([id, p]) => [id, { title: p.title, qs: p.qs, n: p.qs.filter((q) => !q.off).length, pronta: true }]));

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
const MOD_T = { notas: 'Notas musicais', figuras: 'Figuras musicais', compasso: 'Compasso', simbolos: 'Símbolos musicais' };

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
    const saved = await getObj('exams'); // provas criadas pela professora
    // Provas fixas adicionadas pela versão anterior do app vinham como {text, opts, ans}: passam para {t, o, a}.
    for (const e of Object.values(saved)) {
      if (e.qs && e.qs.length && e.qs[0].text !== undefined) e.qs = e.qs.map((q) => ({ t: q.text, o: q.opts, a: q.ans, tag: q.tag }));
    }
    const exams = { ...PRONTAS, ...saved };

    /* ---------- aluna ---------- */
    if (auth.role === 'aluna') {
      const id = auth.id;
      const roster = await getObj('roster');
      if (!roster[id]) return res.status(401).json({ error: 'Cadastro removido.' });
      const prog = (await redis.get('prog:' + id)) || emptyProg();
      // A lista "unl" da aluna guarda os módulos e também as provas que a professora liberou para ela.
      const unl = (await redis.get('unl:' + id)) || ['notas'];
      if (action === 'me') {
        const open = Object.entries(exams).filter(([eid]) => unl.includes(eid)).map(([eid, e]) => ({ id: eid, title: e.title, n: e.n }));
        // "seen:" = o que o aluno já viu do que foi liberado; o resto aparece como novidade.
        // Na primeira vez, tudo o que já estava liberado conta como visto (para não avisar de coisas antigas).
        let seen = await redis.get('seen:' + id);
        if (!Array.isArray(seen)) { seen = [...unl]; await redis.set('seen:' + id, seen); }
        await redis.set('vis:' + id, Date.now()); // última vez que abriu o app (usado pelo lembrete diário)
        const news = unl.filter((x) => !seen.includes(x));
        return res.json({ role: 'aluna', name: roster[id].name, unl, prog, exams: open, news, pushKey: PUSH.ativo ? PUSH.PUB : null });
      }
      if (action === 'seen') {
        await redis.set('seen:' + id, [...unl]);
        return res.json({ ok: true });
      }
      if (action === 'avatar') {
        const av = b.av || {};
        prog.av = { c: String(av.c || 'roxo').slice(0, 20), on: (Array.isArray(av.on) ? av.on : []).map(String).slice(0, 10) };
        await redis.set('prog:' + id, prog);
        return res.json({ ok: true });
      }
      if (action === 'pushSub') {
        if (!(await PUSH.inscrever(redis, id, b.sub))) return res.json({ error: 'Inscrição inválida.' });
        return res.json({ ok: true });
      }
      if (action === 'save') {
        prog.stats = b.stats || prog.stats; prog.err = b.err || prog.err; prog.cur = b.cur || null; prog.last = Date.now();
        await redis.set('prog:' + id, prog);
        return res.json({ ok: true });
      }
      if (action === 'startExam') {
        const e = exams[b.eid];
        if (!e || !unl.includes(b.eid)) return res.json({ error: 'Prova indisponível.' });
        if (prog.exams && prog.exams[b.eid]) return res.json({ error: 'ja_feita' });
        prog.exams = prog.exams || {}; prog.exams[b.eid] = { start: Date.now() };
        await redis.set('prog:' + id, prog);
        // Prova de questões fixas: a aluna recebe só enunciado e alternativas, sem o gabarito.
        if (e.qs) { const ativas = e.qs.filter((q) => !q.off); return res.json({ exam: { title: e.title, n: ativas.length, qs: ativas.map((q) => ({ t: q.t, o: q.o })) } }); }
        return res.json({ exam: { title: e.title, mods: e.mods, n: e.n } });
      }
      if (action === 'finishExam') {
        const cur = prog.exams && prog.exams[b.eid];
        if (!cur || cur.ok != null) return res.json({ error: 'Prova não iniciada.' });
        const e = exams[b.eid];
        if (e && e.qs) {
          // Correção feita aqui no servidor, a partir das respostas marcadas.
          // O aluno respondeu só as questões ativas; as respostas são guardadas na posição de cada questão no arquivo
          // (questão retirada fica com null), para o gabarito da professora continuar batendo.
          let k = 0;
          const ans = e.qs.map((q) => { if (q.off) return null; const v = Array.isArray(b.ans) ? b.ans[k++] : undefined; return Number.isInteger(v) ? v : -1; });
          const ativas = e.qs.filter((q) => !q.off);
          const ok = e.qs.filter((q, i) => !q.off && ans[i] === q.a).length;
          prog.exams[b.eid] = { ok, tot: ativas.length, ts: Date.now(), ans };
          prog.cur = null; prog.last = Date.now();
          await redis.set('prog:' + id, prog);
          return res.json({ ok, tot: ativas.length });
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
      const pushes = ids.length ? await redis.mget(...ids.map((i) => 'push:' + i)) : [];
      const allUnl = {}; const allProg = [];
      ids.forEach((i, k) => { allUnl[i] = unls[k] || ['notas']; if (progs[k]) allProg.push({ id: i, ...progs[k] }); });
      return res.json({
        role: 'prof', name: 'Professora', allUnl, allProg,
        roster: ids.map((i) => ({ id: i, name: roster[i].name, login: roster[i].login, start: roster[i].start || '' })),
        exams: Object.entries(exams).map(([id, e]) => ({ id, ...e })),
        pushOn: ids.filter((i, k) => pushes[k] && pushes[k].length),
        pushErro: PUSH.erro, // chaves das notificações preenchidas com erro na Vercel
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
      const r = roster[b.id]; if (!r) return res.json({ error: 'Aluno não encontrado.' });
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
      await redis.del('prog:' + b.id, 'unl:' + b.id, 'seen:' + b.id, 'vis:' + b.id, 'push:' + b.id);
      return res.json({ ok: true });
    }
    if (action === 'setUnl') {
      if (!roster[b.id] || !Array.isArray(b.mods)) return res.json({ error: 'Dados inválidos.' });
      const antes = (await redis.get('unl:' + b.id)) || ['notas'];
      const mods = b.mods.map(String);
      await redis.set('unl:' + b.id, mods);
      // O que acabou de ser liberado vira novidade para o aluno (sai do "visto") e gera notificação no celular.
      const novos = mods.filter((m) => !antes.includes(m));
      if (novos.length) {
        const seen = await redis.get('seen:' + b.id);
        if (Array.isArray(seen)) await redis.set('seen:' + b.id, seen.filter((x) => !novos.includes(x)));
        const nome = (m) => (exams[m] ? 'Nova prova: ' + exams[m].title : MOD_T[m] ? 'Nova trilha: ' + MOD_T[m] : null);
        const txt = novos.map(nome).filter(Boolean);
        if (txt.length) {
          try { await PUSH.notificar(redis, b.id, { title: 'A professora liberou algo novo 🔔', body: txt.join(' · '), url: './', tag: 'novidade' }); }
          catch (e) { console.error(e); }
        }
      }
      return res.json({ ok: true });
    }
    if (action === 'createExam') {
      const title = String(b.title || '').trim();
      if (!title || !Array.isArray(b.mods) || !b.mods.length) return res.json({ error: 'Dê um título e escolha ao menos um módulo.' });
      saved['e' + Date.now()] = { title, mods: b.mods.map(String), n: Math.min(30, Math.max(3, +b.n || 10)) };
      await redis.set('exams', saved);
      return res.json({ ok: true });
    }
    if (action === 'deleteExam') {
      if (!saved[b.eid]) return res.json({ error: 'Provas prontas não podem ser excluídas.' });
      delete saved[b.eid]; await redis.set('exams', saved); return res.json({ ok: true });
    }
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
