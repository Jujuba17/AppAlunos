# App de Teoria Musical – AppAlunos

Exercícios de teoria musical para as alunas, com login, painel da professora, provas de uma tentativa e acompanhamento de desempenho.

Estrutura: `index.html` (o app) · `api/rpc.js` (login e dados) · `package.json`.
Os dados ficam no **Upstash Redis** (ativado pelo próprio Vercel).

## 1. Trocar o app antigo pelo novo no GitHub

No terminal, dentro de uma pasta qualquer:

```bash
git clone https://github.com/Jujuba17/AppAlunos.git
cd AppAlunos

# backup do app antigo (opcional, mas recomendado)
git checkout -b backup-antigo
git push origin backup-antigo

# volta para a branch principal (main ou master) e apaga o conteúdo antigo
git checkout main        # se der erro, use: git checkout master
git rm -r -q .
```

Copie para dentro da pasta `AppAlunos` os arquivos deste projeto
(`index.html`, `package.json`, `.gitignore`, `README.md` e a pasta `api`) e depois:

```bash
git add .
git commit -m "Nova versão do app de teoria musical"
git push
```

(Sem terminal: no GitHub, apague os arquivos antigos pelo site e use
**Add file → Upload files** para enviar os novos.)

## 2. Configurar no Vercel

1. No projeto do Vercel, vá em **Settings → General → Framework Preset** e escolha **Other** (sem build command).
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

## 3. Usar

- Abra o endereço do Vercel e entre com `PROF_LOGIN` e `PROF_PASSWORD`: você vê tudo.
- Na aba **Alunas**, cadastre nome, login, senha e data de início.
- Libere os módulos e provas por aluna. A aluna entra pelo mesmo endereço, com o login e a senha dela, e só vê o que foi liberado.

## Observações

- As senhas das alunas são guardadas criptografadas; você pode redefini-las, mas não vê-las.
- A prova de uma tentativa é controlada pelo servidor. A correção das respostas é feita no aparelho da aluna.
- Para voltar ao app antigo, use a branch `backup-antigo`.
