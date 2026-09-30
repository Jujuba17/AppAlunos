# Acompanhamento de Alunos

App para acompanhar aulas semanais particulares: quem tem aula em que dia,
quais licoes foram passadas para a proxima aula, o que foi aprovado ou
reprovado, e o registro de faltas e aulas que nao houveram.

Roda na Vercel e abre no celular e no computador com os mesmos dados.
**Nao usa banco de dados**: tudo vive num unico arquivo JSON privado no
armazenamento da propria Vercel.

## O ciclo de uso

1. Na aula de hoje, voce abre o app e ve as licoes que o aluno deveria trazer.
2. **Ate onde o aluno chegou**: sobe o contador ate a ultima licao que ele
   estudou - inclusive alem do que voce passou. Tudo dali para tras entra como
   aprovado de uma vez, e as licoes que voce nem tinha passado sao criadas na
   hora, marcadas como *adiantou*.
3. **Confere**, mudando so o que nao foi bem: **aprovado**, **reprovado**,
   **revisar** ou **nao trouxe**. Ao marcar reprovado, a mesma licao ja e
   reagendada para a proxima aula, com o contador de tentativas somando.
4. **Passa as licoes da proxima aula.** O campo aceita uma ("11"), uma faixa
   ("11-13") ou varias ("11,12,15"), entao dez licoes sao um lancamento so. O
   numero ja vem pre-sugerido na primeira licao ainda nao aprovada nem pendente.
5. Se o aluno faltou ou nao teve aula, registra com a data e o motivo. As
   licoes pendentes rolam para a proxima aula.

Depois que a aula esta fechada, **nao e preciso reabri-la** para mexer nas
licoes: a secao *Licoes para a proxima aula*, na ficha do aluno, passa,
edita e remove licao ali mesmo.

## Estrutura

| Arquivo | O que e |
| --- | --- |
| `index.html` | O app inteiro: telas, regras e a conversa com a API |
| `api/data.js` | A unica funcao de servidor: le e grava o JSON no Vercel Blob |
| `package.json` | So uma dependencia, `@vercel/blob` |
| `demo.html` | Mesmo app com dados ficticios, sem servidor e sem senha |
| `manifest.webmanifest` | Manifest PWA (instalar no celular) |
| `sw.js` | Service worker: abre offline com a ultima versao carregada |
| `make-demo.js` | Gera o `demo.html` a partir do `index.html` (`node make-demo.js`) |
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
documento inteiro quando voce salva algo. Quatro coisas que valem saber:

**O arquivo e privado.** Ele e criado com `access: 'private'`, e a URL dele nao
serve para nada sem o token da Vercel, que existe apenas no servidor. Ninguem
le seus dados pela internet.

**Nada fica esperando neste aparelho.** Tudo o que voce salva vai para o
servidor na hora, e o app so diz que salvou depois que o servidor confirmou. Se
a gravacao falhar - sem internet, servidor fora - a alteracao e desfeita na
tela e o erro aparece. Nao existe fila local: o que esta na tela e o que esta
gravado.

**A sincronizacao e automatica.** O app confere a nuvem ao ganhar foco, ao
voltar do segundo plano, quando a conexao volta, e de dez em dez segundos
enquanto a tela esta visivel. O que voce faz no celular aparece no computador
em segundos, sem ninguem pedir.

Conferir tao seguido e barato porque a pergunta e curta: `GET /api/data?so=marca`
devolve so uma marca que muda a cada gravacao - sai do metadado do blob, sem
baixar nem interpretar o documento. O documento inteiro so desce quando essa
marca muda. Em repouso, cada aparelho aberto gasta uma consulta de metadado a
cada dez segundos e nada mais. (Navegador em aba de fundo estrangula o timer por
conta propria, o que reduz isso ainda mais.)

**Duas gravacoes nao se atropelam, e nenhuma e jogada fora.** O documento
carrega uma **versao** dentro dele - um inteiro que sobe de um em cada
gravacao. O app manda de volta a versao em que baseou a edicao, e a gravacao so
e aceita se essa versao ainda for a atual; senao o servidor devolve 409. Ai o
app le a versao da nuvem e **mescla as duas**, em vez de pedir para voce
escolher qual aparelho perde o trabalho.

Esse papel era do ETag do blob, via `ifMatch`, e nao funcionava: o ETag que a
leitura do conteudo devolve nao era aceito pelo `ifMatch` da gravacao, entao
**toda** gravacao depois da primeira voltava 409 - em qualquer aparelho, sem
conflito nenhum. Era o que fazia o app parar de salvar. Uma versao dentro do
documento nao depende de detalhe nenhum do armazenamento. O `ifMatch` continua
sendo usado como reforco contra duas gravacoes simultaneas de verdade, mas se
ele recusar uma gravacao cuja versao ja foi conferida, a gravacao segue sem ele
- `ifMatch` nunca volta a ser motivo de nada salvar.

A mesclagem e de tres vias e por registro, nao pelo documento inteiro:

| | o que acontece |
| --- | --- |
| So voce mexeu no registro | a sua versao entra |
| So o outro aparelho mexeu | a versao dele entra |
| Cada um criou um registro novo | os dois entram |
| Um dos dois apagou o registro | fica apagado |
| Os dois mexeram no **mesmo** registro | vence o `updated_at` mais recente |

Cadastrar um aluno no computador enquanto o celular registra uma aula deixou de
ser conflito: as duas coisas simplesmente cabem juntas. Depois de mesclar, o
app reaplica as regras que ele ja garantia na gravacao - uma aula por aluno por
dia, e nada de licao orfa de aluno ou livro apagado.

**O que fica guardado no aparelho e so um retrato.** O `localStorage` guarda a
ultima leitura para a tela abrir preenchida em vez de piscar vazia esperando a
rede - e isso e tudo. Nao ha alteracao sua morando ali.

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

Ele e gerado a partir do `index.html` por `node make-demo.js`, entao nao edite
`demo.html` a mao - as mudancas reais vao no `index.html`, e depois roda-se o
gerador.

O proprio app tambem tem **Configuracoes > Dados de exemplo**, que preenche a
base de verdade com os mesmos alunos ficticios, e um botao para apagar tudo.

## Quando parar de salvar

**Configuracoes > Diagnostico > Conferir servidor** pergunta ao servidor como
ele esta vendo o arquivo de dados e mostra a resposta crua. Nao altera nada.

O campo que importa e `etagDoBlob.iguais`: se vier `false`, o ETag da leitura e
o do metadado divergem nesse ambiente - foi o que travava as gravacoes antes da
versao no documento existir. `documento.versao` diz em que versao o servidor
esta, e a folha mostra em que versao este aparelho esta; os dois numeros
diferentes com o app parado significam que falta sincronizar.

## Backup

**Configuracoes > Backup** baixa um JSON com tudo. A restauracao insere os
registros como novos, remapeando os ids - ela nao apaga nada, entao restaurar
sobre uma base que ja tem dados gera duplicatas.

Vale baixar um backup de vez em quando: o historico dos seus alunos mora num
arquivo so.

## Limites conhecidos

- **Tamanho**: o documento inteiro trafega em cada leitura e gravacao, com
  limite de 4 MB. Isso da folga para muitos anos de aulas, mas nao e um banco.
- **Conflito**: a mesclagem e por registro, nao por campo. Se os dois aparelhos
  editarem o **mesmo** aluno (ou a mesma aula) antes de sincronizar, entra a
  versao inteira mais recente - nao da para ficar com o telefone digitado num
  aparelho e o horario digitado no outro. Registros diferentes nunca competem.
- **Cache sem base de comparacao**: se o cache do aparelho vier de uma versao
  antiga do app, a mesclagem nao sabe quem apagou o que e junta os dois lados.
  O efeito e algo apagado voltar - de proposito, para nao perder nada.
- **Sem internet nao da para usar**: por escolha. Salvar exige o servidor no
  ar; se ele nao responder, a alteracao e desfeita e voce tenta de novo. E o
  preco de a tela nunca mentir sobre o que esta gravado.
- **Conferencia olha a data**: uma aula so pode conferir licao que ja tinha
  sido passada quando ela aconteceu. Se voce passar uma licao hoje e depois
  registrar a aula de hoje, essa licao fica para a proxima - que e o que voce
  quis dizer ao passa-la.
- **Uma senha para tudo**: nao ha usuarios separados. E o app de uma pessoa.
- **Service worker**: o registro nao foi verificado num navegador real ainda.
  Se a instalacao como app nao aparecer no celular, e ai que devo olhar.
