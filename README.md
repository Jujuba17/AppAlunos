# App de Teoria Musical – AppAlunos

Exercícios de teoria musical para os alunos, organizados em trilhas por níveis, com login, painel da professora, provas de uma tentativa e acompanhamento de desempenho. Pode ser instalado no celular.

Estrutura:

- `index.html`: o app inteiro (telas, trilhas e geração das questões)
- `api/rpc.js`: login e dados
- `api/_provas.js`: provas prontas, com o gabarito (fica só no servidor; o `_` no nome impede que a Vercel crie um endereço para ele)
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

Para gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Vá em **Deployments → … → Redeploy** para aplicar as variáveis.

## 2. Usar

- Abra o endereço da Vercel e entre com `PROF_LOGIN` e `PROF_PASSWORD`.
- Na aba **Alunos**, cadastre nome, login, senha e data de início. Clique no aluno para abrir os detalhes: lá você libera as trilhas e as provas dele e vê o que ele errou e acertou.
- O aluno entra pelo mesmo endereço, com o login e a senha dele, e só vê o que foi liberado.
- Depois do login aparece o aviso **"Baixe o app no seu celular"**. No Android, o botão instala direto; no iPhone, o aviso explica como usar **Compartilhar → Adicionar à Tela de Início**. "Agora não" esconde o aviso até o próximo login.

### Trilhas de exercícios

Cada card (Notas musicais, Figuras musicais, Compasso e Símbolos musicais) é uma trilha de níveis. O aluno precisa acertar pelo menos **90%** de um nível para abrir o próximo (constante `META` no `index.html`).

### Provas

- **Provas prontas** (em `api/_provas.js`): Prova de Teoria Musical – MSA (19 questões), Unidade de tempo (16) e Propriedades do som e elementos da música (16). Elas não precisam ser adicionadas: basta liberar para cada aluno na aba **Alunos**.
- **Provas sorteadas**: criadas na aba **Provas**, escolhendo os módulos e o número de questões.
- Nas provas de questões fixas, a correção é feita no servidor, e o aluno nunca recebe o gabarito.

## Observações

- As senhas dos alunos são guardadas criptografadas; você pode redefini-las, mas não vê-las.
- O app não tem modo offline: o `sw.js` existe só para permitir a instalação e não guarda nada em cache.
- Versões anteriores: `backup-main-2026-11-04` (o main antes desta versão), `backup-master-2026-11-05` (o master antes desta versão) e `backup-antigo` (o app de acompanhamento de alunos).
