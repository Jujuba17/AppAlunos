# App de Teoria Musical – AppAlunos

Exercícios de teoria musical para os alunos, organizados em trilhas por níveis, com login, painel da professora, provas de uma tentativa, estrelas e personagem, notificações no celular e acompanhamento de desempenho. Pode ser instalado no celular.

Estrutura:

- `index.html`: o app inteiro (telas, trilhas e geração das questões)
- `api/rpc.js`: login e dados
- `api/_provas.js`: provas prontas, com o gabarito (fica só no servidor; o `_` no nome impede que a Vercel crie um endereço para ele)
- `api/_push.js`: envio das notificações para o celular
- `api/cron.js` e `vercel.json`: lembrete diário (a Vercel chama `/api/cron` todo dia, por volta das 19h de Brasília)
- `manifest.webmanifest`, `sw.js` e `icons/`: permitem instalar o app na tela inicial
- `package.json`

Os dados ficam no **Upstash Redis** (ativado pela própria Vercel).

O site principal (Production) da Vercel é publicado a partir da branch **`main`**. Um push em outras branches gera só uma pré-visualização (Preview).

## 1. Configurar na Vercel

1. Em **Settings → General → Framework Preset**, escolha **Other** (sem build command).
2. Vá em **Storage → Create Database → Upstash (Redis)**, crie (plano gratuito) e **conecte ao projeto**.
   As chaves de acesso entram sozinhas.
3. Vá em **Settings → Environment Variables** e crie:

| Nome | Valor |
|---|---|
| `PROF_LOGIN` | seu login de professora (ex.: `professora`) |
| `PROF_PASSWORD` | sua senha de professora |
| `SESSION_SECRET` | um texto longo e aleatório (veja abaixo) |
| `VAPID_PUBLIC_KEY` | chave pública das notificações (veja abaixo) |
| `VAPID_PRIVATE_KEY` | chave privada das notificações (veja abaixo) |
| `VAPID_SUBJECT` | `mailto:` + seu e-mail (ex.: `mailto:professora@gmail.com`) |
| `CRON_SECRET` | outro texto longo e aleatório (protege o lembrete diário) |

Para gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para gerar o `CRON_SECRET`, use o mesmo comando do `SESSION_SECRET` (gere um texto diferente).

Para gerar as chaves das notificações (`VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`):

```bash
npx web-push generate-vapid-keys
```

Sem essas chaves o app funciona normalmente, só não manda notificações.

4. Vá em **Deployments → … → Redeploy** para aplicar as variáveis.

## 2. Usar

- Abra o endereço da Vercel e entre com `PROF_LOGIN` e `PROF_PASSWORD`.
- Na aba **Alunos**, cadastre nome, login, senha e data de início. Clique no aluno para abrir os detalhes: lá você libera as trilhas e as provas dele e vê o que ele errou e acertou.
- O aluno entra pelo mesmo endereço, com o login e a senha dele, e só vê o que foi liberado.
- Depois do login aparece o aviso **"Baixe o app no seu celular"**. No Android, o botão instala direto; no iPhone, o aviso explica como usar **Compartilhar → Adicionar à Tela de Início**. "Agora não" esconde o aviso até o próximo login.

### Trilhas de exercícios

Cada card (Notas musicais, Figuras musicais, Compasso e Símbolos musicais) é uma trilha de níveis. O aluno precisa acertar pelo menos **70%** de um nível (7 de 10) para abrir o próximo (constante `META` no `index.html`).

A trilha **Notas musicais** termina com a unidade **Sustenido e bemol**: para que servem os acidentes e a leitura de notas como Si bemol e Fá sustenido, nas claves de Sol e de Fá. Nas alternativas nunca aparece uma nota que soa igual à resposta (ex.: Lá sustenido quando a resposta é Si bemol).

### Estrelas e personagem

- Cada nível vale estrelas pelo melhor resultado: **70% = 3**, **80% = 5**, **90% = 7** e **100% = 10** estrelas. As provas valem o mesmo.
- Repetir um nível só dá estrelas se o resultado melhorar (ex.: fez 70% e ganhou 3; depois fez 100% e ganhou mais 7).
- Com as estrelas, o aluno libera cores e acessórios para o personagem, na tela **Meu personagem**. Os acessórios são separados por tipo, cada um com várias opções: **Óculos** (redondos, quadrados, escuros, de coração, de estrela, monóculo), **Cabeça** (laço, boné, chapéu de festa, cartola, gorro, coroa), **Fones** (fone de ouvido, fone de gatinho), **Pescoço** (gravata borboleta, cachecol, colar de notas, medalha) e **Na mão** (batuta, maraca, microfone, varinha). Também tem a cor dourada.
- O aluno pode usar vários acessórios ao mesmo tempo, um de cada tipo (ex.: óculos escuros + cartola + gravata + microfone).
- Na aba **Alunos**, a professora vê o personagem e as estrelas de cada aluno.

### Novidades e notificações

- Quando a professora libera uma trilha ou prova, o aluno vê o aviso **Novidades da professora** ao abrir o app.
- Se o aluno ativar as notificações (botão **Ativar notificações**), ele recebe no celular um aviso na hora em que algo novo for liberado, e um lembrete por volta das 19h nos dias em que não abrir o app.
- No iPhone, as notificações só funcionam com o app instalado na tela inicial (iOS 16.4 ou mais novo).
- Na aba **Alunos**, o 🔔 ao lado do nome mostra quem ativou as notificações.

### Provas

- **Provas prontas** (em `api/_provas.js`): Prova de Teoria Musical – MSA (19 questões), Unidade de tempo (16) e Propriedades do som e elementos da música (16). Elas não precisam ser adicionadas: basta liberar para cada aluno na aba **Alunos**.
- **Provas sorteadas**: criadas na aba **Provas**, escolhendo os módulos e o número de questões.
- Nas provas de questões fixas, a correção é feita no servidor, e o aluno nunca recebe o gabarito.

## Observações

- As senhas dos alunos são guardadas criptografadas; você pode redefini-las, mas não vê-las.
- O app não tem modo offline: o `sw.js` permite a instalação e mostra as notificações, mas não guarda nada em cache.
- Versões anteriores: `backup-main-2026-11-04` (o main antes desta versão), `backup-master-2026-11-05` (o master antes desta versão) e `backup-antigo` (o app de acompanhamento de alunos).
