# Acompanhamento de Alunos

App para acompanhar aulas semanais: quem tem aula em que dia, quais licoes
foram passadas para a proxima aula, o que foi aprovado ou reprovado, e o
registro de faltas e aulas que nao houveram.

Arquivo unico (`index.html`), sem build e sem dependencias. Instalavel no
celular como PWA. Dados no Supabase, acessiveis de qualquer aparelho.

## O ciclo de uso

1. Na aula de hoje, voce abre o app e ve as licoes que o aluno deveria trazer.
2. Marca cada uma: **aprovado**, **reprovado**, **revisar** ou **nao trouxe**.
   Ao marcar reprovado, a mesma licao ja e reagendada automaticamente para a
   proxima aula, com o contador de tentativas somando.
3. Adiciona as licoes da proxima aula (o numero vem pre-sugerido: a primeira
   licao do livro que ainda nao foi aprovada nem esta pendente).
4. Se o aluno faltou ou nao teve aula, registra com a data e o motivo. As
   licoes pendentes simplesmente rolam para a proxima aula.

## Estrutura

| Arquivo | O que e |
| --- | --- |
| `index.html` | O app inteiro: telas, logica e camada Supabase |
| `demo.html` | Mesmo app com dados ficticios, sem Supabase (ver Modo demonstracao) |
| `schema.sql` | Tabelas, indices e politicas RLS do Supabase |
| `manifest.webmanifest` | Manifest PWA (instalar no celular) |
| `sw.js` | Service worker: abre offline com os dados salvos no aparelho |
| `make-icons.js` | Gera os icones PNG (`node make-icons.js`) |
| `icons/` | Icones gerados |

## Modelo de dados

- **students** - aluno: nome, data de inicio, **dia da semana + horario fixo**,
  situacao (`ativo` / `pausado` / `parou`, com data e motivo da saida).
- **books** - catalogo de livros, cada um com seu numero de licoes.
- **enrollments** - vinculo aluno <-> livro. E N-para-N: **cada aluno pode usar
  varios livros ao mesmo tempo**, e cada um tem progresso proprio.
- **sessions** - uma linha por aula, inclusive `falta_aluno`, `cancelada` e
  `sem_aula`. E o que da o historico de frequencia.
- **assignments** - a licao atribuida. Guarda em qual aula foi passada
  (`assigned_session_id`), em qual foi conferida (`review_session_id`), o
  resultado e o numero da tentativa. Cada reprovacao gera uma nova tentativa,
  e e disso que sai o mapa de licoes que mais reprovam.

## Configuracao (uma vez)

### 1. Criar o projeto no Supabase

1. Crie sua conta e um projeto novo em https://supabase.com.
2. Abra **SQL Editor > New query**, cole todo o conteudo de `schema.sql` e
   clique em **Run**.

### 2. Criar seu usuario

Em **Authentication > Users > Add user**, crie um usuario com e-mail e senha
e marque *Auto Confirm User*. E com esse e-mail e senha que voce entra no app.

O RLS do `schema.sql` amarra cada registro ao usuario que o criou: ninguem ve
os dados de outro usuario, mesmo tendo a chave publica do projeto.

### 3. Pegar a conexao

Em **Project Settings > API**, copie:

- **Project URL** (ex: `https://abcdefgh.supabase.co`)
- **anon public** key

Na primeira abertura o app pede esses dois valores. Eles ficam salvos apenas
naquele aparelho. **Nunca use a chave `service_role`** - ela ignora o RLS.

## Rodar local

Precisa ser por HTTP (nao por `file://`), senao o service worker nao registra:

```bash
npx serve C:/Users/170947/Documents/acompanhamento-alunos
```

## Modo demonstracao

`demo.html` e o mesmo app com um backend ficticio embutido: cinco alunos, tres
livros, aulas realizadas, uma falta e uma aula cancelada. Nao conversa com o
Supabase, nao grava nada e nao precisa de login - recarregar a pagina devolve
tudo ao estado inicial. Serve para conhecer as telas antes de configurar o
banco, ou para mostrar o app para outra pessoa.

Abra pelo mesmo servidor local (`http://localhost:8123/demo.html`) ou publique
junto na Vercel. Se nao quiser a demo no ar, apague o arquivo antes do deploy.

Ele e gerado a partir do `index.html`, entao nao edite `demo.html` a mao: as
mudancas reais vao no `index.html`.

## Publicar na Vercel

```bash
npm i -g vercel
cd C:/Users/170947/Documents/acompanhamento-alunos
vercel
```

E um site estatico puro - a Vercel serve sem nenhuma configuracao. Depois basta
abrir a URL no celular e usar "Adicionar a tela de inicio" / "Instalar app".

Se preferir nao digitar a conexao em cada aparelho, preencha a constante
`BUILTIN` no topo do `<script>` em `index.html` antes de publicar. Lembre que
isso deixa a URL e a chave publica visiveis no codigo-fonte da pagina - o que
protege os dados continua sendo o login e o RLS.

## Backup

**Configuracoes > Backup** baixa um JSON com tudo (alunos, livros, aulas,
licoes). A restauracao insere os registros como novos, remapeando os ids - ela
nao apaga nada, entao restaurar sobre uma base que ja tem dados gera duplicatas.

## Limites conhecidos

- O app carrega todos os registros de uma vez ao abrir. E rapido e simples para
  a escala de um professor particular; com dezenas de milhares de licoes
  registradas valeria paginar.
- Sem conexao, o app abre e mostra os ultimos dados carregados (somente
  leitura). Gravacoes precisam de internet.
