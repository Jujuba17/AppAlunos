/**
 * API de dados - Vercel Function (Node.js)
 *
 * Guarda TODOS os dados do app num unico JSON privado no Vercel Blob.
 * Nao existe banco de dados: o documento inteiro e lido e regravado.
 *
 *   GET  /api/data  ->  { etag, data }
 *   PUT  /api/data  <-  { etag, data }   ->  { etag }
 *
 * Duas protecoes importantes:
 *
 * 1. O blob e criado com access:'private'. A URL dele nao serve para nada sem
 *    o token do Vercel, que vive apenas aqui no servidor como variavel de
 *    ambiente. Ninguem le os dados pela internet.
 *
 * 2. A gravacao usa ifMatch com o ETag lido. Se outro aparelho gravou nesse
 *    meio-tempo, o ETag mudou e a gravacao e recusada com 409 em vez de
 *    apagar o trabalho do outro aparelho. E o cliente avisa e recarrega.
 *
 * Variaveis de ambiente necessarias no projeto Vercel:
 *   BLOB_READ_WRITE_TOKEN  - criada automaticamente ao conectar um Blob store
 *   APP_SENHA              - a senha de acesso ao app, definida por voce
 */

import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const CAMINHO = 'dados/alunos.json';
const TABELAS = ['students', 'books', 'enrollments', 'sessions', 'assignments'];
const LIMITE_BYTES = 4 * 1024 * 1024;

const documentoVazio = () =>
  TABELAS.reduce((acc, t) => { acc[t] = []; return acc; }, {});

function responder(res, status, corpo) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

/** Comparacao de senha em tempo constante, sem vazar o tamanho pelo caminho. */
function senhaConfere(enviada) {
  const esperada = process.env.APP_SENHA;
  if (!esperada || !enviada) return false;
  const a = createHash('sha256').update(String(esperada)).digest();
  const b = createHash('sha256').update(String(enviada)).digest();
  return timingSafeEqual(a, b);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > LIMITE_BYTES) throw new Error('corpo grande demais');
    partes.push(parte);
  }
  if (!total) return null;
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

/** Le o documento atual. Devolve etag null quando ainda nao existe nenhum. */
async function lerDocumento() {
  const achado = await get(CAMINHO, { access: 'private', useCache: false });
  if (!achado) return { etag: null, data: documentoVazio() };
  const texto = await new Response(achado.stream).text();
  let doc;
  try {
    doc = JSON.parse(texto);
  } catch {
    throw new Error('O arquivo de dados esta corrompido e nao pode ser lido.');
  }
  const data = documentoVazio();
  for (const t of TABELAS) if (Array.isArray(doc[t])) data[t] = doc[t];
  return { etag: achado.blob.etag, data };
}

/** Aceita apenas o formato esperado - evita gravar lixo em cima dos dados. */
function validar(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'O corpo precisa conter um objeto "data".';
  }
  for (const t of TABELAS) {
    if (!(t in data)) return 'Falta a lista "' + t + '" nos dados.';
    if (!Array.isArray(data[t])) return 'A lista "' + t + '" precisa ser um array.';
    for (const linha of data[t]) {
      if (!linha || typeof linha !== 'object' || Array.isArray(linha)) {
        return 'A lista "' + t + '" tem um item que nao e um registro.';
      }
      if (typeof linha.id !== 'string' || !linha.id) {
        return 'Todo registro de "' + t + '" precisa de um id.';
      }
    }
  }
  const extras = Object.keys(data).filter((k) => !TABELAS.includes(k));
  if (extras.length) return 'Campos nao reconhecidos: ' + extras.join(', ') + '.';
  return null;
}

export default async function handler(req, res) {
  if (!process.env.APP_SENHA) {
    return responder(res, 500, {
      erro: 'A variavel de ambiente APP_SENHA nao esta definida no projeto Vercel.',
    });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return responder(res, 500, {
      erro: 'Nenhum Blob store conectado: falta BLOB_READ_WRITE_TOKEN no projeto Vercel.',
    });
  }
  if (!senhaConfere(req.headers['x-app-senha'])) {
    await esperar(400);   // desacelera tentativa de adivinhar a senha
    return responder(res, 401, { erro: 'Senha incorreta.' });
  }

  try {
    if (req.method === 'GET') {
      const doc = await lerDocumento();
      return responder(res, 200, doc);
    }

    if (req.method === 'PUT') {
      let corpo;
      try {
        corpo = await lerCorpo(req);
      } catch (e) {
        return responder(res, 400, {
          erro: e.message === 'corpo grande demais'
            ? 'Os dados passaram de 4 MB. Exporte um backup e apague aulas antigas.'
            : 'Nao consegui interpretar o corpo da requisicao.',
        });
      }
      if (!corpo) return responder(res, 400, { erro: 'Corpo vazio.' });

      const problema = validar(corpo.data);
      if (problema) return responder(res, 400, { erro: problema });

      const conteudo = JSON.stringify({
        gravado_em: new Date().toISOString(),
        data: corpo.data,
      });

      try {
        const salvo = await put(CAMINHO, conteudo, {
          access: 'private',
          contentType: 'application/json; charset=utf-8',
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          // Sem etag = primeira gravacao: recusa se alguem criou antes.
          ...(corpo.etag ? { ifMatch: corpo.etag } : { allowOverwrite: false }),
        });
        return responder(res, 200, { etag: salvo.etag });
      } catch (e) {
        const conflito = e instanceof BlobPreconditionFailedError ||
                         /already exists|precondition/i.test(String(e && e.message));
        if (conflito) {
          return responder(res, 409, {
            erro: 'Os dados foram alterados em outro aparelho. Recarregue antes de salvar.',
          });
        }
        throw e;
      }
    }

    res.setHeader('Allow', 'GET, PUT');
    return responder(res, 405, { erro: 'Metodo nao suportado.' });
  } catch (e) {
    console.error('[api/data]', e);
    return responder(res, 500, { erro: (e && e.message) || 'Erro inesperado no servidor.' });
  }
}
