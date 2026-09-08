/**
 * API de dados - Vercel Function (Node.js)
 *
 * Guarda TODOS os dados do app num unico JSON privado no Vercel Blob.
 * Nao existe banco de dados: o documento inteiro e lido e regravado.
 *
 *   GET  /api/data                 ->  { etag, marca, data }
 *   GET  /api/data?so=marca        ->  { marca }
 *   GET  /api/data?so=diagnostico  ->  relatorio de conferencia (nao grava)
 *   PUT  /api/data                 <-  { etag, data }  ->  { etag, marca }
 *
 * Duas perguntas diferentes, dois valores diferentes:
 *
 * `etag` e a VERSAO do documento - um inteiro guardado dentro do proprio JSON,
 * que sobe de um em cada gravacao. E ele que detecta conflito: o app manda de
 * volta a versao em que baseou a edicao, e a gravacao so e aceita se essa
 * versao ainda for a atual.
 *
 * Esse papel era do ETag do blob, via `ifMatch`, e nao funcionava: o ETag
 * devolvido pela leitura do conteudo nao era aceito pelo `ifMatch` da
 * gravacao, entao toda gravacao depois da primeira voltava 409 e o app nao
 * conseguia salvar nada - em nenhum aparelho. Uma versao dentro do documento
 * nao depende de detalhe nenhum do armazenamento. O `ifMatch` continua sendo
 * usado, mas so como reforco: se ele recusar uma gravacao cuja versao ja
 * conferiu, a gravacao segue sem ele (ver gravar()).
 *
 * `marca` responde a outra pergunta, muito mais frequente: "mudou algo?". O
 * app pergunta de dez em dez segundos, e a resposta sai do metadado do blob,
 * sem baixar nem interpretar o documento.
 *
 * Duas protecoes que continuam valendo:
 *
 * 1. O blob e criado com access:'private'. A URL dele nao serve para nada sem
 *    o token do Vercel, que vive apenas aqui no servidor como variavel de
 *    ambiente. Ninguem le os dados pela internet.
 *
 * 2. Ninguem sobrescreve o trabalho do outro em silencio: uma gravacao feita
 *    sobre uma versao velha volta 409, e o app mescla as duas versoes antes de
 *    tentar de novo.
 *
 * Variaveis de ambiente necessarias no projeto Vercel:
 *   BLOB_READ_WRITE_TOKEN  - criada automaticamente ao conectar um Blob store
 *   APP_SENHA              - a senha de acesso ao app, definida por voce
 */

import { get, head, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
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

/** O ETag do blob, so pelo metadado. Devolve null quando nao da para saber: e
    um reforco, nao a trava, entao nao vale derrubar a requisicao por isso. */
async function lerEtagBlob() {
  try {
    const meta = await head(CAMINHO);
    return (meta && meta.etag) || null;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    console.warn('[api/data] head() falhou:', (e && e.message) || e);
    return null;
  }
}

/**
 * Le o documento atual.
 *
 * `existe`    - se ja ha algum documento gravado
 * `versao`    - o inteiro guardado dentro do JSON (0 quando ainda nao tem)
 * `temVersao` - se o JSON realmente trazia uma versao. Um documento gravado
 *               pela versao antiga desta API nao tem nenhuma, e nesse caso o
 *               app nao teria como mandar a versao certa - ver o handler.
 */
async function lerDocumento() {
  const achado = await get(CAMINHO, { access: 'private', useCache: false });
  if (!achado || !achado.stream) {
    return { existe: false, versao: 0, temVersao: false, data: documentoVazio() };
  }
  const texto = await new Response(achado.stream).text();
  let doc;
  try {
    doc = JSON.parse(texto);
  } catch {
    throw new Error('O arquivo de dados esta corrompido e nao pode ser lido.');
  }
  const data = documentoVazio();
  const bruto = doc && doc.data ? doc.data : doc;
  for (const t of TABELAS) if (bruto && Array.isArray(bruto[t])) data[t] = bruto[t];

  const temVersao = !!doc && Number.isInteger(doc.versao) && doc.versao >= 0;
  return {
    existe: true,
    versao: temVersao ? doc.versao : 0,
    temVersao,
    data,
    gravado_em: (doc && doc.gravado_em) || null,
  };
}

const ehPrecondicao = (e) =>
  e instanceof BlobPreconditionFailedError ||
  /already exists|precondition|if-match|ifmatch/i.test(String((e && e.message) || ''));

/**
 * Grava o documento. Usa `ifMatch` quando da, para barrar duas gravacoes
 * simultaneas de verdade, mas nunca deixa o `ifMatch` ser o motivo de nada
 * salvar: quem chama esta funcao ja conferiu a versao dentro do documento, e
 * essa e a trava que vale.
 */
async function gravar(conteudo, etagBlob) {
  const opcoes = {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
    allowOverwrite: true,
  };
  if (!etagBlob) return put(CAMINHO, conteudo, opcoes);
  try {
    return await put(CAMINHO, conteudo, { ...opcoes, ifMatch: etagBlob });
  } catch (e) {
    if (!ehPrecondicao(e)) throw e;
    /* A versao dentro do documento acabou de ser conferida e estava certa,
       entao isso nao e conflito: e o ETag do blob que nao serve para comparar
       aqui. Grava sem ele. */
    console.warn('[api/data] ifMatch recusou um ETag recem-lido; gravando sem ifMatch');
    return put(CAMINHO, conteudo, opcoes);
  }
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

/**
 * Conferencia, sem gravar nada. Responde por que uma gravacao falhou sem
 * depender de adivinhacao: diz se o ETag que a leitura do conteudo devolve e
 * o mesmo que o metadado do blob informa. Quando esses dois discordam, o
 * `ifMatch` recusa gravacoes que nao tem conflito nenhum - foi exatamente o
 * que travou este app.
 */
async function diagnosticar() {
  const relato = { quando: new Date().toISOString() };

  try {
    const doc = await lerDocumento();
    relato.documento = {
      existe: doc.existe,
      versao: doc.versao,
      temVersao: doc.temVersao,
      gravado_em: doc.gravado_em || null,
      registros: TABELAS.reduce((a, t) => { a[t] = doc.data[t].length; return a; }, {}),
    };
  } catch (e) {
    relato.documento = { erro: (e && e.message) || String(e) };
  }

  let pelaLeitura = null;
  try {
    const achado = await get(CAMINHO, { access: 'private', useCache: false });
    pelaLeitura = achado && achado.blob ? achado.blob.etag || null : null;
  } catch (e) {
    pelaLeitura = 'erro: ' + ((e && e.message) || e);
  }
  const peloMetadado = await lerEtagBlob();

  relato.etagDoBlob = {
    pelaLeituraDoConteudo: pelaLeitura,
    peloMetadado,
    iguais: typeof pelaLeitura === 'string' && typeof peloMetadado === 'string'
      ? pelaLeitura === peloMetadado
      : null,
  };
  relato.comoLer = 'A trava de gravacao usa a versao dentro do documento, e nao ' +
    'estes ETags. Se "iguais" for false, era isso que impedia de salvar.';
  return relato;
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
      const so = new URL(req.url, 'http://interno').searchParams.get('so');

      /* Pergunta curta, feita de dez em dez segundos por cada aparelho
         aberto: "mudou algo?". Sai do metadado, sem baixar o documento.
         Quando o metadado nao responde, cai para a versao do documento: mais
         lento, mas estavel, para o app nao ficar relendo tudo sem motivo. */
      if (so === 'marca') {
        const etagBlob = await lerEtagBlob();
        if (etagBlob) return responder(res, 200, { marca: etagBlob });
        const doc = await lerDocumento();
        return responder(res, 200, { marca: 'v' + doc.versao });
      }

      if (so === 'diagnostico') {
        return responder(res, 200, await diagnosticar());
      }

      const doc = await lerDocumento();
      const etagBlob = await lerEtagBlob();
      return responder(res, 200, {
        etag: String(doc.versao),
        marca: etagBlob || 'v' + doc.versao,
        data: doc.data,
      });
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

      const atual = await lerDocumento();
      const enviada = corpo.etag == null ? null : String(corpo.etag);

      /* Conflito de verdade: o documento no servidor esta numa versao
         diferente daquela em que este aparelho baseou a edicao.

         A excecao e um documento gravado pela versao antiga desta API, que nao
         tem versao nenhuma dentro. O app nao teria como mandar a versao certa,
         entao a primeira gravacao passa e o documento ja fica com versao 1.
         Dessa em diante a conferencia vale normalmente. */
      if (atual.existe && atual.temVersao && enviada !== String(atual.versao)) {
        return responder(res, 409, {
          erro: 'Os dados foram alterados em outro aparelho. Recarregue antes de salvar.',
          versaoNoServidor: atual.versao,
          versaoEnviada: enviada,
        });
      }

      const proxima = atual.versao + 1;
      const conteudo = JSON.stringify({
        versao: proxima,
        gravado_em: new Date().toISOString(),
        data: corpo.data,
      });

      await gravar(conteudo, await lerEtagBlob());

      /* Le de volta antes de confirmar: se a gravacao nao pode ser lida, o app
         precisa receber erro em vez de um "ok" falso e achar que salvou. */
      const conferido = await lerDocumento();
      if (!conferido.existe) {
        return responder(res, 500, {
          erro: 'A gravacao nao pode ser confirmada: o arquivo nao foi encontrado depois de salvo.',
        });
      }
      const gravou = conferido.versao === proxima &&
        TABELAS.every((t) => conferido.data[t].length === corpo.data[t].length);
      if (!gravou) {
        return responder(res, 500, {
          erro: 'A gravacao nao pode ser confirmada: o arquivo lido nao corresponde ao enviado.',
        });
      }

      const etagBlob = await lerEtagBlob();
      return responder(res, 200, {
        etag: String(conferido.versao),
        marca: etagBlob || 'v' + conferido.versao,
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return responder(res, 405, { erro: 'Metodo nao suportado.' });
  } catch (e) {
    console.error('[api/data]', e);
    return responder(res, 500, { erro: (e && e.message) || 'Erro inesperado no servidor.' });
  }
}
