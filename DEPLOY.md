# Guia de Deploy em Produção

Este guia cobre o deploy completo da plataforma num servidor Linux usando Docker Compose.

---

## Visão Geral da Arquitetura

Topologia de dois subdomínios (SSO entre `web` e `auth` via cookie partilhado no domínio pai — ver `docs/deploy/nginx/frontend.conf` e `auth.conf`):

```
[Internet]
    │
    ├── <dominio-frontend> ─ Nginx (web, porta 8080 dentro do container)
    │       ├── /          → estáticos Angular (build da imagem web)
    │       └── /api/      → api (NestJS, porta 3100) — same-origin
    │
    └── <dominio-auth> ───── Nginx → auth (NestJS, porta 3000)
            └── /api/auth/ → auth

[Apps internas — não expostas pelo reverse proxy]
    ├── cron          (NestJS, porta 3200)
    ├── notifications (NestJS, porta 3300)
    └── worker        (NestJS, porta 3400)

[Infraestrutura interna]
    ├── PostgreSQL  (porta 5432)
    ├── Redis       (porta 6379)
    └── MongoDB     (porta 27017)
```

Todas as apps NestJS partilham o mesmo prefixo `/api` — a distinção entre serviços é
feita pela porta, não pelo path. Os serviços comunicam entre si via Redis transport
(microservices NestJS) e Bull queues.

---

## Pré-requisitos

- Docker Engine ≥ 24 + Docker Compose V2
- Node.js 22 (apenas para correr migrações localmente, se necessário)
- `pnpm` instalado globalmente (`npm install -g pnpm`)
- Domínio configurado com DNS apontado para o servidor
- Portas 80 e 443 abertas (se usar Traefik/Nginx com TLS)

---

## 1. Clonar o Repositório

```bash
git clone <repo-url> /opt/<app-name>
cd /opt/<app-name>
```

---

## 2. Configurar Variáveis de Ambiente de Infraestrutura

### `docker/postgres.env`

```bash
cp docker/postgres.env.example docker/postgres.env
```

Editar `docker/postgres.env`:

| Variável            | Valor de Produção      | Notas                           |
| ------------------- | ---------------------- | ------------------------------- |
| `POSTGRES_DB`       | `app_db`              | Nome da base de dados           |
| `POSTGRES_USER`     | `app_db`              | Utilizador do PostgreSQL        |
| `POSTGRES_PASSWORD` | **gerar — ver abaixo** | Mínimo 32 caracteres, aleatório |

### `docker/mongo.env`

```bash
cp docker/mongo.env.example docker/mongo.env
```

Editar `docker/mongo.env`:

| Variável                     | Valor de Produção      | Notas                           |
| ---------------------------- | ---------------------- | ------------------------------- |
| `MONGO_INITDB_ROOT_USERNAME` | `app_db`              | Utilizador root do MongoDB      |
| `MONGO_INITDB_ROOT_PASSWORD` | **gerar — ver abaixo** | Mínimo 32 caracteres, aleatório |
| `MONGO_INITDB_DATABASE`      | `app_db`              | Base de dados inicial           |

### Gerar passwords seguras

```bash
# Gerar uma password aleatória (32 chars)
openssl rand -base64 32

# Gerar a BETTER_AUTH_SECRET (base64, 32+ bytes)
openssl rand -base64 32

# Gerar a ENCRYPTION_KEY (base64, exatamente 32 bytes → 44 chars em base64)
openssl rand -base64 32
```

> **Atenção**: `BETTER_AUTH_SECRET` e `ENCRYPTION_KEY` têm de ser **iguais** em todos os serviços NestJS que os usam. Use o mesmo valor gerado em todos.

---

## 3. Configurar Variáveis de Ambiente dos Serviços

Criar um ficheiro `.env.production` para cada app. Em produção, o Docker deve injetar estas variáveis via `env_file` ou via secrets do orquestrador (Kubernetes, Swarm, etc.).

---

### `apps/auth/.env` (porta 3000)

| Variável               | Valor de Produção                                                     | Obrigatório | Notas                                                                |
| ---------------------- | --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                                                          | ✅          |                                                                      |
| `PORT`                 | `3000`                                                                | ✅          |                                                                      |
| `DATABASE_URL`         | `postgres://app_db:<PG_PASS>@postgres:5432/app_db?schema=public`    | ✅          | Host `postgres` = nome do serviço Docker                             |
| `REDIS_HOST`           | `redis`                                                               | ✅          | Nome do serviço Docker                                               |
| `REDIS_PORT`           | `6379`                                                                | ✅          |                                                                      |
| `REDIS_PASSWORD`       | `<REDIS_PASS>`                                                        | ⚠️ opcional | Definir se Redis tiver auth ativada                                  |
| `MONGO_URI`            | `mongodb://app_db:<MONGO_PASS>@mongo:27017/app_db?authSource=admin` | ✅          | Host `mongo` = nome do serviço Docker                                |
| `BETTER_AUTH_SECRET`   | `<gerar com openssl rand -base64 32>`                                 | ✅          | **Mínimo 32 caracteres. Igual em todos os serviços.**                |
| `BETTER_AUTH_URL`      | `https://<dominio-auth>/api/auth`                                     | ✅          | URL pública **https** do endpoint de auth — o prefixo `Secure` do cookie deriva disto, nunca dos headers do proxy |
| `UI_URL`               | `https://<dominio-frontend>`                                          | ✅          | URL do frontend — usado para links de email (reset password, verify) |
| `ADMIN_EMAIL`          | `admin@<empresa>.com`                                                 | ✅          | Email do utilizador administrador inicial (criado no seed)           |
| `ADMIN_PASSWORD`       | **password segura**                                                   | ✅          | Password do admin — mín. 12 chars, maiúsculas, números, símbolos     |
| `CORS_ORIGIN`          | `https://<dominio-frontend>`                                          | ✅          | Origem(ns) do browser — sem `*` em produção (entrada removida se presente). Separar múltiplos com vírgula. |
| `COOKIE_DOMAIN`        | `.<dominio-pai>`                                                      | ⚠️ opcional | Domínio pai partilhado por `<dominio-frontend>` e `<dominio-auth>` — ativa SSO entre os dois. Omitir para cookie host-only (sem SSO). |
| `ENCRYPTION_KEY`       | `<gerar com openssl rand -base64 32>`                                 | ✅          | **Igual em todos os serviços. Mínimo 32 caracteres.**                |
| `GOOGLE_CLIENT_ID`     | `<id do Google Cloud>`                                                | ⚠️ opcional | Apenas se usar login com Google                                      |
| `GOOGLE_CLIENT_SECRET` | `<secret do Google Cloud>`                                            | ⚠️ opcional | Apenas se usar login com Google                                      |

---

### `apps/api/.env` (porta 3100)

| Variável             | Valor de Produção                                                     | Obrigatório | Notas                                                                                                           |
| -------------------- | --------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                          | ✅          |                                                                                                                 |
| `PORT`               | `3100`                                                                | ✅          |                                                                                                                 |
| `DATABASE_URL`       | `postgres://app_db:<PG_PASS>@postgres:5432/app_db?schema=public`    | ✅          |                                                                                                                 |
| `REDIS_HOST`         | `redis`                                                               | ✅          |                                                                                                                 |
| `REDIS_PORT`         | `6379`                                                                | ✅          |                                                                                                                 |
| `REDIS_PASSWORD`     | `<REDIS_PASS>`                                                        | ⚠️ opcional |                                                                                                                 |
| `MONGO_URI`          | `mongodb://app_db:<MONGO_PASS>@mongo:27017/app_db?authSource=admin` | ✅          |                                                                                                                 |
| `BETTER_AUTH_SECRET` | `<mesmo valor que apps/auth>`                                         | ✅          | **Tem de ser igual ao da app auth**                                                                             |
| `BETTER_AUTH_URL`    | `https://<dominio-auth>/api/auth`                                     | ✅          |                                                                                                                 |
| `CORS_ORIGIN`        | `https://<dominio-frontend>`                                          | ✅          |                                                                                                                 |
| `ENCRYPTION_KEY`     | `<mesmo valor que apps/auth>`                                         | ✅          | **Tem de ser igual em todos os serviços**                                                                       |

---

### `apps/notifications/.env` (porta 3300)

| Variável         | Valor de Produção                                                     | Obrigatório | Notas |
| ---------------- | --------------------------------------------------------------------- | ----------- | ----- |
| `NODE_ENV`       | `production`                                                          | ✅          |       |
| `PORT`           | `3300`                                                                | ✅          |       |
| `DATABASE_URL`   | `postgres://app_db:<PG_PASS>@postgres:5432/app_db?schema=public`    | ✅          |       |
| `REDIS_HOST`     | `redis`                                                               | ✅          |       |
| `REDIS_PORT`     | `6379`                                                                | ✅          |       |
| `REDIS_PASSWORD` | `<REDIS_PASS>`                                                        | ⚠️ opcional |       |
| `MONGO_URI`      | `mongodb://app_db:<MONGO_PASS>@mongo:27017/app_db?authSource=admin` | ✅          |       |
| `CORS_ORIGIN`    | `https://<dominio-frontend>`                                          | ✅          |       |
| `ENCRYPTION_KEY` | `<mesmo valor que apps/auth>`                                         | ✅          |       |

---

### `apps/worker/.env` (porta 3400)

| Variável         | Valor de Produção                                                     | Obrigatório | Notas                                                     |
| ---------------- | --------------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `NODE_ENV`       | `production`                                                          | ✅          |                                                           |
| `PORT`           | `3400`                                                                | ✅          |                                                           |
| `DATABASE_URL`   | `postgres://app_db:<PG_PASS>@postgres:5432/app_db?schema=public`    | ✅          |                                                           |
| `REDIS_HOST`     | `redis`                                                               | ✅          |                                                           |
| `REDIS_PORT`     | `6379`                                                                | ✅          |                                                           |
| `REDIS_PASSWORD` | `<REDIS_PASS>`                                                        | ⚠️ opcional |                                                           |
| `MONGO_URI`      | `mongodb://app_db:<MONGO_PASS>@mongo:27017/app_db?authSource=admin` | ✅          |                                                           |
| `CORS_ORIGIN`    | `https://<dominio-frontend>`                                          | ✅          |                                                           |
| `ENCRYPTION_KEY` | `<mesmo valor que apps/auth>`                                         | ✅          |                                                           |
| `BREVO_API_KEY`  | `<API key do Brevo>`                                                  | ✅          | Obter em app.brevo.com → API Keys                         |
| `FROM_EMAIL`     | `noreply@<dominio-frontend>`                                                   | ✅          | Endereço de email remetente                               |
| `FROM_NAME`      | `<Nome da App>`                                                       | ✅          | Nome do remetente nos emails                              |
| `DEV_EMAIL`      | `<email da equipa>`                                                   | ⚠️ opcional | Em produção pode ficar em branco ou igual ao `FROM_EMAIL` |

---

### `apps/web` (porta 8080 dentro do container — sem `.env` em runtime)

O Angular não lê variáveis de ambiente em runtime — a configuração é compilada no **build**, via `apps/web/src/environments/environment.prod.ts` (trocado por `angular.json`'s `fileReplacements` na build `production`):

```typescript
export const environment = {
  authApiUrl: 'https://<dominio-auth>', // origem pública do auth — ver DEPLOY-PM2.md §9 / docs/deploy/nginx/
};
```

A API própria do frontend é sempre o prefixo relativo `/api` (proxied same-origin pelo nginx — ver `docs/deploy/nginx/frontend.conf`), nunca um host configurado. Editar `environment.prod.ts` com o domínio real de `auth` **antes** de `pnpm --filter web build` (ou de construir a imagem Docker, que corre o mesmo build).

---

## 4. Variáveis Partilhadas entre Serviços

As seguintes variáveis **têm de ter o mesmo valor** em todos os serviços NestJS que as usam:

| Variável             | Serviços                                 | Razão                                             |
| -------------------- | ---------------------------------------- | ------------------------------------------------- |
| `BETTER_AUTH_SECRET` | `auth`, `api`                            | Validação de sessões — secret partilhado          |
| `ENCRYPTION_KEY`     | `auth`, `api`, `notifications`, `worker` | Encriptação/desencriptação de credenciais AES-256 |
| `DATABASE_URL`       | `auth`, `api`, `notifications`, `worker` | Todos acedem à mesma BD PostgreSQL                |
| `REDIS_HOST/PORT`    | `auth`, `api`, `notifications`, `worker` | Mesmo broker Redis para microservices e filas     |
| `MONGO_URI`          | `auth`, `api`, `notifications`, `worker` | Mesmo MongoDB para logs/audit                     |

---

## 5. Configurar o `docker-compose.yaml` para Produção

O ficheiro `docker-compose.yaml` existente tem os serviços das apps comentados (usados apenas em dev). Para produção, descomentar e ajustar conforme necessário.

Exemplo mínimo de configuração de produção para o serviço `auth`:

```yaml
auth:
  image: <app-name>-auth:latest # ou build com target: production
  build:
    context: .
    dockerfile: ./apps/auth/Dockerfile
    target: production
  restart: unless-stopped
  ports:
    - '3000:3000'
  env_file:
    - ./apps/auth/.env
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    mongo:
      condition: service_healthy
  networks:
    - app
  healthcheck:
    test:
      [
        'CMD-SHELL',
        'wget -qO /dev/null http://localhost:3000/api/auth/ok || exit 1',
      ]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

Repetir o padrão para `api` (porta 3100), `cron` (porta 3200), `notifications` (porta 3300), `worker` (porta 3400) e `web` (porta 8080 → exposta conforme o reverse proxy).

> Para os volumes do PostgreSQL e MongoDB em produção, substituir os caminhos absolutos locais (`/Volumes/SSD-DEV/...`) por caminhos no servidor, por exemplo `/data/<app-name>/postgres` e `/data/<app-name>/mongo`.

---

## 6. Build e Deploy

### 6.1 Build das imagens

```bash
# Build de todas as apps em modo produção
docker compose build --no-cache
```

Ou por app individual:

```bash
docker compose build auth
docker compose build api
docker compose build notifications
docker compose build worker
docker compose build web
```

### 6.2 Iniciar infraestrutura

```bash
# Apenas PostgreSQL, Redis e MongoDB
docker compose up -d postgres redis mongo

# Aguardar healthchecks passarem
docker compose ps
```

### 6.3 Correr migrações da base de dados

As migrações têm de ser corridas **antes** de iniciar as apps, a partir da máquina com acesso à BD:

```bash
# Com DATABASE_URL apontado para a BD de produção
export DATABASE_URL="postgres://app_db:<PG_PASS>@<host>:5432/app_db?schema=public"

pnpm db:generate   # Gerar cliente Prisma
pnpm db:migrate    # Aplicar migrações
pnpm db:seed       # Criar utilizador admin (usa ADMIN_EMAIL e ADMIN_PASSWORD)
```

> **Atenção**: `pnpm db:seed` cria o utilizador administrador usando `ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente. Garantir que estas variáveis estão definidas antes de correr o seed.

### 6.4 Iniciar os serviços

```bash
docker compose up -d auth api notifications worker web
```

### 6.5 Verificar saúde dos serviços

```bash
# Health check público (via reverse proxy) — só a api viaja pelo domínio frontend
curl https://<dominio-frontend>/api/health/ready

# Health checks internos (não expostos publicamente, incluindo auth)
curl http://localhost:3000/api/health/ready   # auth
curl http://localhost:3200/api/health/ready   # cron
curl http://localhost:3300/api/health/ready   # notifications
curl http://localhost:3400/api/health/ready   # worker

# Logs
docker compose logs -f auth
docker compose logs -f api
```

---

## 7. Reverse Proxy (Nginx, dois subdomínios)

`web` e `auth` vivem em subdomínios irmãos que partilham o domínio pai, para que o cookie de sessão possa ser partilhado entre ambos (SSO). Usar os server blocks prontos em [docs/deploy/nginx/](docs/deploy/nginx/):

- [`frontend.conf`](docs/deploy/nginx/frontend.conf) — serve os estáticos do `web` (proxied até ao container na porta `8080`, ou diretamente do filesystem, conforme a instalação) e faz proxy same-origin de `/api/` para `api` (porta 3100)
- [`auth.conf`](docs/deploy/nginx/auth.conf) — faz proxy de `/api/auth/` para `auth` (porta 3000)

```bash
sudo cp docs/deploy/nginx/frontend.conf /etc/nginx/sites-available/frontend
sudo cp docs/deploy/nginx/auth.conf     /etc/nginx/sites-available/auth
# substituir <dominio-frontend> / <dominio-auth> / <root-path> em cada ficheiro
sudo ln -s /etc/nginx/sites-available/frontend /etc/nginx/sites-enabled/frontend
sudo ln -s /etc/nginx/sites-available/auth     /etc/nginx/sites-enabled/auth
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <dominio-frontend> -d <dominio-auth>
```

Configurar em `apps/auth`: `BETTER_AUTH_URL=https://<dominio-auth>/api/auth`, `CORS_ORIGIN=https://<dominio-frontend>`, `COOKIE_DOMAIN=.<dominio-pai>` (ver `apps/auth/.env.example`). O prefixo `Secure` do cookie deriva de `BETTER_AUTH_URL` começar por `https://` — nunca dos headers do proxy.

> Os serviços `cron` (porta 3200), `notifications` (porta 3300) e `worker` (porta 3400)
> **não devem ser expostos publicamente** — comunicam apenas via Redis/BullMQ internamente.

---

## 8. Segurança em Produção

- **Nunca expor** PostgreSQL (5432), Redis (6379) ou MongoDB (27017) à internet — ficam na rede interna Docker.
- **Redis com password**: Configurar `requirepass` no Redis e definir `REDIS_PASSWORD` em todos os serviços.
- **`CORS_ORIGIN`**: Nunca usar `*` em produção. Usar o domínio exato de cada origem: `https://<dominio-frontend>` / `https://<dominio-auth>`.
- **`BETTER_AUTH_SECRET`** e **`ENCRYPTION_KEY`**: Mínimo 32 caracteres, gerados com `openssl rand -base64 32`. Guardar num gestor de secrets (Vault, AWS Secrets Manager, etc.).
- **Swagger/OpenAPI**: Está desativado automaticamente quando `NODE_ENV=production`.
- **`ADMIN_PASSWORD`**: Usar uma password forte e alterar no primeiro login.
- **Google OAuth** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`): Configurar apenas se o login social estiver ativo. Obter em [Google Cloud Console](https://console.cloud.google.com/).

---

## 9. Checklist de Deploy

- [ ] `docker/postgres.env` criado com passwords seguras
- [ ] `docker/mongo.env` criado com passwords seguras
- [ ] `apps/auth/.env` criado e preenchido
- [ ] `apps/api/.env` criado e preenchido
- [ ] `apps/notifications/.env` criado e preenchido
- [ ] `apps/worker/.env` criado e preenchido
- [ ] `apps/web/src/environments/environment.prod.ts` com `authApiUrl` apontado para `<dominio-auth>`
- [ ] `BETTER_AUTH_SECRET` igual em `auth` e `api`
- [ ] `ENCRYPTION_KEY` igual em `auth`, `api`, `notifications` e `worker`
- [ ] `DATABASE_URL` aponta para host Docker interno (`postgres`) em todos os serviços
- [ ] `REDIS_HOST` é `redis` (nome do serviço Docker) em todos os serviços
- [ ] `CORS_ORIGIN` sem `*`, apenas o domínio do frontend
- [ ] `COOKIE_DOMAIN` definido em `apps/auth` se SSO entre `<dominio-frontend>` e `<dominio-auth>` for necessário
- [ ] `UI_URL` definida em `apps/auth` com URL pública HTTPS do frontend
- [ ] `BREVO_API_KEY` válida em `apps/worker`
- [ ] Infraestrutura iniciada e healthchecks a passar
- [ ] Migrações corridas (`pnpm db:migrate`)
- [ ] Seed executado (`pnpm db:seed`)
- [ ] Reverse proxy configurado com TLS
- [ ] Portas 5432, 6379, 27017 **não expostas** ao exterior
