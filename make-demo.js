/* Gera o demo.html a partir do index.html: o mesmo app, com um servidor
   ficticio em memoria no lugar de /api/data, sem senha e sem service worker.
   O README diz para nao editar o demo.html a mao - este script e o porque.
   Rode:  node make-demo.js   */
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
let s = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/* Cada troca precisa acertar exatamente um lugar. Se o index.html mudar de um
   jeito que desencaixe uma delas, o script para em vez de gerar um demo
   silenciosamente errado. */
function trocar(oque, por) {
  const n = s.split(oque).length - 1;
  if (n !== 1) {
    console.error('make-demo: esperava 1 ocorrencia, achei ' + n + ':\n  ' + oque.split('\n')[0]);
    process.exit(1);
  }
  s = s.replace(oque, por);
}

function trocarRegex(re, por) {
  const achados = s.match(new RegExp(re.source, re.flags + 'g'));
  if (!achados || achados.length !== 1) {
    console.error('make-demo: esperava 1 ocorrencia, achei ' +
                  (achados ? achados.length : 0) + ' para ' + re);
    process.exit(1);
  }
  s = s.replace(re, por);
}

/* --- 1. o servidor ficticio, instalado antes de o app iniciar --- */
const SERVIDOR_FALSO = `<script>
/* ==========================================================================
   MODO DEMONSTRACAO
   Substitui /api/data por um armazenamento em memoria. Instalado antes do
   app iniciar, entao nenhuma requisicao sai desta pagina e nada e gravado
   em lugar nenhum. Recarregar devolve tudo ao estado inicial.
   ========================================================================== */
(function () {
  'use strict';
  var TABELAS = ['students', 'books', 'enrollments', 'sessions', 'assignments'];
  var guardado = null;   // { etag, data }
  var contador = 0;

  function resposta(corpo, status) {
    return new Response(JSON.stringify(corpo), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  function vazio() {
    var d = {};
    for (var i = 0; i < TABELAS.length; i++) d[TABELAS[i]] = [];
    return d;
  }

  var fetchOriginal = window.fetch.bind(window);
  window.fetch = function (url, init) {
    init = init || {};
    var alvo = String(url && url.url ? url.url : url);
    if (alvo.indexOf('/api/data') === -1) return fetchOriginal(url, init);

    var metodo = (init.method || 'GET').toUpperCase();
    if (metodo === 'GET') {
      return Promise.resolve(resposta(
        guardado ? { etag: guardado.etag, data: guardado.data } : { etag: null, data: vazio() }
      ));
    }
    if (metodo === 'PUT') {
      var corpo;
      try { corpo = JSON.parse(init.body); } catch (e) {
        return Promise.resolve(resposta({ erro: 'Corpo invalido.' }, 400));
      }
      var atual = guardado ? guardado.etag : null;
      if ((corpo.etag || null) !== atual) {
        return Promise.resolve(resposta({
          erro: 'Os dados foram alterados em outro aparelho. Recarregue antes de salvar.',
        }, 409));
      }
      contador += 1;
      guardado = { etag: 'demo-' + contador, data: corpo.data };
      return Promise.resolve(resposta({ etag: guardado.etag }));
    }
    return Promise.resolve(resposta({ erro: 'Metodo nao suportado.' }, 405));
  };
})();
</script>
<script>`;

trocar('<div id="toast-root"></div>\n\n<script>',
       '<div id="toast-root"></div>\n\n' + SERVIDOR_FALSO);

/* --- 2. entra direto, sem senha e sem o cache deste aparelho --- */
trocar('let SENHA = store.get(K_SENHA, null);',
       "let SENHA = 'demonstracao';   /* modo demonstracao: entra direto */");

trocar('\nlerCache();\n',
       '\n/* modo demonstracao: ignora o cache do aparelho */\n');

/* --- 3. sem sincronizacao automatica: nao ha nuvem nenhuma para conferir ---
   Pega o bloco inteiro de listeners, do primeiro ao setInterval, sem depender
   dos comentarios que estao no meio dele. */
trocarRegex(
  /document\.addEventListener\('visibilitychange'[\s\S]*?setInterval\([\s\S]*?sincronizar\(\);[^\n]*\n/,
  '/* modo demonstracao: sem sincronizacao automatica, o servidor e ficticio */\n');

/* --- 4. aviso no topo, no lugar do banner de pendencia --- */
trocar("        : '');",
       "        : 'Demonstracao com dados ficticios. Nada e salvo - recarregue para recomecar.');");

/* --- 5. sem service worker, e com os alunos ficticios ja carregados --- */
trocar('  registerSW();',
       '  /* service worker desativado no modo demonstracao */');

trocar(`  render();
})();
</script>`,
       `  render();
  if (!DB.students.length) await carregarExemplo();
})();
</script>`);

fs.writeFileSync(path.join(RAIZ, 'demo.html'), s);
console.log('demo.html gerado (' + s.length + ' bytes)');
