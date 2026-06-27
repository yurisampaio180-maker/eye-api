# EYE Agência — Backend (eye-api)

API do sistema da EYE Agência: solicitações das secretarias, **fila de aprovação
do CEO**, gate de **confirmação antes de postar**, produção (kanban), agenda,
notificações e RBAC.

## Stack

- **Node 22+ (TypeScript via type-stripping nativo — `--experimental-strip-types`)**
- **Fastify** (HTTP) · **Zod** (validação) · **JWT** (access + refresh) · **bcryptjs**
- **Banco: `node:sqlite`** (SQLite **embutido no Node**, arquivo persistente — zero
  dependência nativa, escolhido por rodar de forma confiável no ambiente Windows
  com AppControl, que bloqueia binários nativos como o engine do Prisma/esbuild)
- Upload local isolado em `services/storage.ts` (pronto para S3/Supabase)
- Notificações em `services/notificacoes.ts` (interno; pronto para WhatsApp/e-mail)

> **Por que não Prisma + Postgres direto?** O engine nativo do Prisma e o esbuild
> são bloqueados pelo AppControl nesta máquina (erro `UNKNOWN -4094`). Para manter
> **backend real com dados persistidos** sem fricção, usei o SQLite embutido do
> Node. O caminho de migração para Postgres (driver `pg`, também JS puro) está
> documentado em `docker-compose.yml`; o schema espelho está em
> `prisma/schema.prisma` e `src/db/schema.sql`.

## Setup local

```bash
cd eye-api
npm install

# crie o .env (NÃO versione). Gere segredos aleatórios:
cp .env.example .env
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# preencha JWT_ACCESS_SECRET e JWT_REFRESH_SECRET com a saída acima.

npm run db:seed     # popula clientes, secretarias, equipe e usuários de teste
npm run dev         # API em http://127.0.0.1:3333  (health: /health)
```

Para começar **com solicitações de exemplo**: `npm run db:seed -- --exemplos`.

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | servidor com watch |
| `npm run db:seed` | recria o banco limpo (estrutural) |
| `npm run db:seed -- --exemplos` | seed + 2 solicitações de demonstração |
| `npm run typecheck` | checagem de tipos |

## Usuários de teste (senha inicial `eye123`)

| Papel | E-mail |
| --- | --- |
| CEO | `yuri@eye.com` |
| Social Media (Eduarda) | `eduarda@eye.com` |
| Designer do Governo (Henrique/Lourenço) | `henrique@eye.com` · `lourenco@eye.com` |
| Videomaker (Alysson/Pedro) | `alysson@eye.com` · `pedro@eye.com` |
| Secretaria (teste) | `saude@moraujo.gov.br` · `comunicacao@moraujo.gov.br` |

> Os usuários **reais das secretarias são criados pelo CEO** na tela `/usuarios`.
> Eles nascem com senha provisória e **trocam no 1º acesso**.

## Fluxo (regra inquebrável)

```
Secretaria abre solicitação (arte ou cobertura de evento)
  → em_aprovacao  → [CEO] aprova e destina (designer governo / videomaker)
  → aprovada → em_producao → em_revisao → aguardando_confirmacao
  → [CEO] CONFIRMA  → confirmada → [CEO/social] posta → postada
```

Nada vira tarefa/agenda sem aprovação do CEO, e **nada é postado sem a confirmação
do CEO**. Tudo validado por uma máquina de estados no backend
(`src/lib/stateMachine.ts`), com auditoria (`HistoricoEvento`) e notificações.

## Teste automatizado do fluxo

```bash
node --experimental-strip-types --experimental-sqlite scripts/smoke.ts
```

Exercita auth, RBAC/isolamento, criação de usuário (só CEO), cobertura de evento,
máquina de estados e o gate de confirmação — 18 asserções.

## Deploy

### Docker (recomendado — VPS / Render / Railway / Fly)

```bash
# 1. defina segredos em eye-api/.env (JWT_*, CORS_ORIGIN do front em produção)
# 2. suba:
docker compose up -d --build
# 3. popule na primeira vez (dentro do container):
docker compose exec api node --experimental-strip-types --experimental-sqlite src/db/seed.ts
```

O volume `eye-data` persiste banco + uploads. Configure HTTPS/domínio no provedor
(ou um proxy reverso, ex. Caddy/Nginx) e ajuste `CORS_ORIGIN` para o domínio do front.

### Primeiro CEO com segurança

O seed cria `yuri@eye.com` com a senha de `SEED_DEFAULT_PASSWORD`. Em produção:
1. Defina `SEED_DEFAULT_PASSWORD` com um valor forte **antes** de rodar o seed.
2. Troque a senha no 1º acesso.
3. **Nunca** comite o `.env`.

## Variáveis de ambiente

Veja `.env.example`. Resumo: `DATABASE_URL`, `PORT`, `CORS_ORIGIN`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `UPLOAD_DIR`, `OPENAI_API_KEY`,
`SEED_DEFAULT_PASSWORD`. **Segredos só no ambiente, nunca no código.**
