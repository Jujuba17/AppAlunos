# Acompanhamento de Alunos

App para acompanhar aulas semanais particulares: quem tem aula em que dia,
quais licoes foram passadas para a proxima aula, o que foi aprovado ou
reprovado, e o registro de faltas e aulas que nao houveram.

Roda na Vercel e abre no celular e no computador com os mesmos dados.
**Nao usa banco de dados**: tudo vive num unico arquivo JSON privado no
armazenamento da propria Vercel.

## O ciclo de uso

1. Na aula de hoje, voce abre o app e ve as licoes que o aluno deveria trazer.
2. Marca cada uma: **aprovado**, **reprovado**, **revisar** ou **nao trouxe**.
   Ao marcar reprovado, a mesma licao ja e reagendada automaticamente para a
   proxima aula, com o contador de tentativas somando.
3. Adiciona as licoes da proxima aula (o numero vem pre-sugerido: a primeira
   licao do livro que ainda nao foi aprovada nem esta pendente).
4. Se o aluno faltou ou nao teve aula, registra com a data e o motivo. As
   licoes pendentes rolam para a proxima aula.

## Estrutura

| Arquivo | O que e |
| --- | --- |
| `index.html` | O app inteiro: telas, regras e a conversa com a API |
| `api/data.js` | A unica funcao de servidor: le e grava o JSON no Vercel Blob |
| `package.json` | So uma dependencia, `@vercel/blob` |
| `demo.html` | Mesmo app com dados ficticios, sem servidor e sem senha |
| `manifest.webmanifest` | Manifest PWA (instalar no celular) |
| `sw.js` | Service worker: abre offline com a ultima versao carregada |
| `make-icons.js` | Gera os icones PNG (`node make-icons.js`) |
| `icons/` | Icones gerados |

## Como os dados sao guardados

Existe **um** documento JSON com cinco listas dentro:

- **students** - aluno: nome, data de inicio, **dia da semana + horario fixo**,
  situacao (`ativo` / `pausado` / `parou`, com data e motivo da saida).
- **books** - livros, cada um com seu numero de licoes.
- **enrollments** - vinculo aluno <-> livro. **Cada aluno pode usar varios
  livros ao mesmo tempo**, e cada um tem progresso proprio.
- **sessions** - uma linha por aula, inclusive `falta_aluno`, `cancelada` e
  `sem_aula`. E o que da o historico de frequencia.
- **assignments** - a licao atribuida. Guarda em qual aula foi passada, em qual
  foi conferida, o resultado e o numero da tentativa. Cada reprovacao gera uma
  nova tentativa, e e disso que sai o mapa de licoes que mais reprovam.

O app carrega o documento inteiro ao abrir, trabalha em memoria, e regrava o
documento inteiro quando voce salva algo. Tres coisas que valem saber:

**O arquivo e privado.** Ele e criado com `access: 'private'`, e a URL dele nao
serve para nada sem o token da Vercel, que existe apenas no servidor. Ninguem
le seus dados pela internet.

**Duas gravacoes nao se atropelam.** Cada leitura traz um ETag, e a gravacao so
e aceita se o ETag ainda for o mesmo. Se voce editou no celular e no PC, o
segundo envio e recusado e o app pergunta: *manter as minhas* ou *descartar as
minhas*. Nada e sobrescrito em silencio.

**Funciona sem internet.** Se o envio falhar, a alteracao fica guardada no
aparelho com um aviso na tela, e sobe sozinha na proxima vez que o app abrir
ou quando voce tocar em *Enviar e atualizar*.

## Publicar na Vercel

### 1. Importar o projeto

Em [vercel.com](https://vercel.com), **Add New > Project**, importe o
repositorio. Nao precisa configurar build: e um site estatico com uma funcao.

### 2. Criar o armazenamento

No projeto, aba **Storage** > **Create Database** > **Blob**. Depois clique em
**Connect** para ligar esse Blob store ao projeto. Isso cria sozinha a variavel
de ambiente `BLOB_READ_WRITE_TOKEN` - voce nao precisa copiar nada.

### 3. Definir a senha

Em **Settings** > **Environment Variables**, crie:

| Nome | Valor |
| --- | --- |
| `APP_SENHA` | a senha que voce vai digitar no app |

Escolha uma senha longa (uma frase, por exemplo). Ela e a unica coisa que
protege os dados, e a Vercel nao limita tentativas no plano gratuito - a API
espera 400 ms a cada erro, o que atrasa quem tentar adivinhar, mas senha curta
continua sendo senha fraca.

### 4. Publicar de novo

As variaveis so entram em vigor num novo deploy: **Deployments** > o mais
recente > **Redeploy**. Ou simplesmente faca um `git push`.

### 5. Usar

Abra a URL do projeto, digite a senha, e pronto. No celular, use "Adicionar a
tela de inicio" / "Instalar app" para abrir sem a barra do navegador. A mesma
senha vale em todos os aparelhos, e todos veem os mesmos dados.

## Rodar na sua maquina

O app tem uma funcao de servidor, entao um servidor de arquivos comum nao
basta - `/api/data` responderia 404. Use a CLI da Vercel:

```bash
npm i -g vercel
```

Ligue a pasta ao projeto e traga as variaveis de ambiente:

```bash
vercel link
```

```bash
vercel env pull .env.development.local
```

E rode:

```bash
vercel dev
```

Atencao: isso usa o **mesmo** Blob store da producao. Se quiser mexer sem risco,
use o `demo.html` ou crie um segundo projeto na Vercel para testes.

## Modo demonstracao

`demo.html` e o mesmo app com um servidor ficticio embutido: cinco alunos, tres
livros, aulas realizadas, uma falta e uma aula cancelada. Nao pede senha, nao
grava nada, e recarregar a pagina devolve tudo ao estado inicial. Serve para
conhecer as telas ou mostrar o app para outra pessoa.

Ele e gerado a partir do `index.html`, entao nao edite `demo.html` a mao - as
mudancas reais vao no `index.html`.

O proprio app tambem tem **Configuracoes > Dados de exemplo**, que preenche a
base de verdade com os mesmos alunos ficticios, e um botao para apagar tudo.

## Backup

**Configuracoes > Backup** baixa um JSON com tudo. A restauracao insere os
registros como novos, remapeando os ids - ela nao apaga nada, entao restaurar
sobre uma base que ja tem dados gera duplicatas.

Vale baixar um backup de vez em quando: o historico dos seus alunos mora num
arquivo so.

## Limites conhecidos

- **Tamanho**: o documento inteiro trafega em cada leitura e gravacao, com
  limite de 4 MB. Isso da folga para muitos anos de aulas, mas nao e um banco.
- **Conflito**: o app detecta e pergunta, mas quem escolhe *manter as minhas*
  substitui o que o outro aparelho fez. Nao existe mesclagem automatica.
- **Uma senha para tudo**: nao ha usuarios separados. E o app de uma pessoa.
- **Service worker**: o registro nao foi verificado num navegador real ainda.
  Se a instalacao como app nao aparecer no celular, e ai que devo olhar.
