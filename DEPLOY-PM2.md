# Guia de Deploy em Produção — PM2 (sem Docker)

Este guia cobre o deploy da plataforma diretamente no servidor usando **PM2** como process manager, sem Docker para as aplicações. A infraestrutura (PostgreSQL, Redis, MongoDB) pode ser instalada nativa ou gerida separadamente.

---

## Pré-requisitos no Servidor

```bash
# Node.js 22
node --version   # deve ser >= 22

# pnpm
npm install -g pnpm

# PM2
npm install -g pm2

# (opcional) turbo global — acelera builds repetidos
npm install -g turbo
```

---

## 1. Instalar e Configurar a Infraestrutura

Instalar PostgreSQL, Redis e MongoDB no servidor ou apontar para instâncias geridas (RDS, ElastiCache, Atlas, etc.).

### PostgreSQL

```bash
sudo apt install postgresql postgresql-contrib

sudo -u postgres psql -c "CREATE USER app_db WITH PASSWORD '<PG_PASS>';"
sudo -u postgres psql -c "CREATE DATABASE app_db OWNER app_db;"
```

### Redis

```bash
sudo apt install redis-server

# Ativar password (recomendado em produção)
# Editar /etc/redis/redis.conf:
#   requirepass <REDIS_PASS>

sudo systemctl enable --now redis-server
```

### MongoDB

```bash
# Seguir instalação oficial para Ubuntu/Debian:
# https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/

sudo systemctl enable --now mongod

# Criar utilizador
mongosh --eval "
  db = db.getSiblingDB('app_db');
  db.createUser({ user: 'app_db', pwd: '<MONGO_PASS>', roles: [{ role: 'readWrite', db: 'app_db' }] });
"
```

---

## 2. Clonar o Repositório

```bash
git clone <repo-url> /opt/<app-name>
cd /opt/<app-name>
```

---

## 3. Instalar Dependências e Fazer Build

```bash
cd /opt/<app-name>

pnpm install --frozen-lockfile

pnpm build
```

O build corre para todos os packages e apps via Turborepo. Os artefactos ficam em `apps/*/dist/`.

O Angular gera um bundle estático em `apps/web/dist/web/browser/`, servido diretamente pelo Nginx (secção 9) — não há processo Node para `web` no PM2, ao contrário das apps NestJS. Editar `apps/web/src/environments/environment.prod.ts` com o `authApiUrl` real **antes** deste `pnpm build`.

---

## 4. Configurar Variáveis de Ambiente

Criar um ficheiro `.env` em cada app. As variáveis são carregadas pelo PM2 via `env_production` no ecosystem file (secção 5).

### Gerar secrets

```bash
openssl rand -base64 32   # para BETTER_AUTH_SECRET
openssl rand -base64 32   # para ENCRYPTION_KEY  (usar o mesmo valor em todos os serviços)
```

> **Importante**: `BETTER_AUTH_SECRET` e `ENCRYPTION_KEY` têm de ser **iguais** em todos os serviços NestJS.

---

### `apps/auth/.env`

```dotenv
NODE_ENV=production
PORT=3000

DATABASE_URL=postgres://app_db:<PG_PASS>@localhost:5432/app_db?schema=public

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASS>

MONGO_URI=mongodb://app_db:<MONGO_PASS>@127.0.0.1:27017/app_db?authSource=app_db

BETTER_AUTH_SECRET=<gerar com openssl rand -base64 32>
BETTER_AUTH_URL=https://<dominio-auth>/api/auth

UI_URL=https://<dominio-frontend>

ADMIN_EMAIL=admin@<empresa>.com
ADMIN_PASSWORD=<password forte>

CORS_ORIGIN=https://<dominio-frontend>

ENCRYPTION_KEY=<gerar com openssl rand -base64 32>

# Opcional — Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

### `apps/api/.env`

```dotenv
NODE_ENV=production
PORT=3100

DATABASE_URL=postgres://app_db:<PG_PASS>@localhost:5432/app_db?schema=public

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASS>

MONGO_URI=mongodb://app_db:<MONGO_PASS>@127.0.0.1:27017/app_db?authSource=app_db

BETTER_AUTH_SECRET=<mesmo valor que apps/auth>
BETTER_AUTH_URL=https://<dominio-auth>/api/auth

CORS_ORIGIN=https://<dominio-frontend>

ENCRYPTION_KEY=<mesmo valor que apps/auth>
```

---

### `apps/notifications/.env`

```dotenv
NODE_ENV=production
PORT=3300

DATABASE_URL=postgres://app_db:<PG_PASS>@localhost:5432/app_db?schema=public

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASS>

MONGO_URI=mongodb://app_db:<MONGO_PASS>@127.0.0.1:27017/app_db?authSource=app_db

CORS_ORIGIN=https://<dominio-frontend>

ENCRYPTION_KEY=<mesmo valor que apps/auth>
```

---

### `apps/worker/.env`

```dotenv
NODE_ENV=production
PORT=3400

DATABASE_URL=postgres://app_db:<PG_PASS>@localhost:5432/app_db?schema=public

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASS>

MONGO_URI=mongodb://app_db:<MONGO_PASS>@127.0.0.1:27017/app_db?authSource=app_db

CORS_ORIGIN=https://<dominio-frontend>

ENCRYPTION_KEY=<mesmo valor que apps/auth>

BREVO_API_KEY=<API key do Brevo>
FROM_EMAIL=noreply@<dominio-frontend>
FROM_NAME=<Nome da App>
DEV_EMAIL=
```

---

### `apps/web` — sem `.env` (config compilado no build)

```typescript
// apps/web/src/environments/environment.prod.ts — editar antes de `pnpm build`
export const environment = {
  authApiUrl: 'https://<dominio-auth>',
};
```

A API própria do frontend é sempre o prefixo relativo `/api`, servido same-origin pelo nginx (§9) — nunca um host configurado aqui.

---

## 5. Ecosystem File do PM2

O ficheiro `ecosystem.config.js` já existe na raiz do projeto.

### Env files por app

Criar os seguintes ficheiros antes do deploy (copiar do `.env.example` e preencher):

```
apps/auth/.env.production          apps/auth/.env.qa
apps/api/.env.production           apps/api/.env.qa
apps/notifications/.env.production apps/notifications/.env.qa
apps/worker/.env.production        apps/worker/.env.qa
```

`web` não tem `.env` em runtime — a configuração é compilada no build (ver §3/§4 acima e `apps/web/src/environments/environment.prod.ts`).

### Criar pasta de logs

```bash
mkdir -p logs
```

### Instalar e configurar log rotation (uma vez por servidor)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:workerInterval 3600
```

---

## 6. Correr Migrações

```bash
cd /opt/<app-name>

# Gerar cliente Prisma
pnpm db:generate

# Aplicar migrações na BD de produção
# (usa DATABASE_URL do .env na raiz ou exportar diretamente)
export DATABASE_URL="postgres://app_db:<PG_PASS>@localhost:5432/app_db?schema=public"
pnpm db:migrate

# Criar utilizador admin (usa ADMIN_EMAIL e ADMIN_PASSWORD do .env do auth)
pnpm db:seed
```

---

## 7. Iniciar os Serviços com PM2

```bash
cd /opt/<app-name>

# Produção
pm2 start ecosystem.config.js --env production

# QA
# pm2 start ecosystem.config.js --env qa

# Ver estado de todos os processos
pm2 status

# Ver logs em tempo real
pm2 logs

# Logs de uma app específica
pm2 logs auth
pm2 logs api
```

### Ativar arranque automático no boot

```bash
pm2 startup        # gera e imprime o comando systemd — executar o comando impresso
pm2 save           # guarda a lista de processos actuais
```

---

## 8. Comandos PM2 Úteis

```bash
# Reiniciar um serviço
pm2 restart auth

# Reiniciar todos
pm2 restart all

# Recarregar sem downtime (graceful reload)
pm2 reload api

# Parar
pm2 stop worker

# Ver detalhes e métricas
pm2 show auth

# Monitorização em tempo real
pm2 monit

# Limpar logs
pm2 flush
```

---

## 9. Configurar Nginx (dois subdomínios)

```bash
sudo apt install nginx
```

`web` e `auth` vivem em subdomínios irmãos que partilham o domínio pai, para que o cookie de sessão possa ser partilhado entre ambos (SSO). Usar os server blocks prontos em [docs/deploy/nginx/](docs/deploy/nginx/) — `frontend.conf` serve o build estático de `apps/web/dist/web/browser/` diretamente do filesystem e faz proxy same-origin de `/api/` para `api`; `auth.conf` faz proxy de `/api/auth/` para `auth`:

```bash
sudo cp docs/deploy/nginx/frontend.conf /etc/nginx/sites-available/frontend
sudo cp docs/deploy/nginx/auth.conf     /etc/nginx/sites-available/auth
# substituir <dominio-frontend>, <dominio-auth> e <root-path> (ex: /opt/<app-name>/apps/web/dist/web/browser)
sudo ln -s /etc/nginx/sites-available/frontend /etc/nginx/sites-enabled/frontend
sudo ln -s /etc/nginx/sites-available/auth     /etc/nginx/sites-enabled/auth
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d <dominio-frontend> -d <dominio-auth>
```

> O `notifications` (3300) e o `worker` (3400) **não devem ser expostos** — comunicam apenas internamente via Redis. Todas as apps NestJS partilham o mesmo prefixo `/api`; a distinção entre elas é feita pela porta.

---

## 10. Workflow de Deploy de Atualizações

```bash
cd /opt/<app-name>

# 1. Buscar código novo
git pull origin main

# 2. Instalar novas dependências (se houver)
pnpm install --frozen-lockfile

# 3. Build
pnpm build

# 4. Migrações (se houver alterações ao schema)
pnpm db:migrate

# 5. Recarregar processos sem downtime
pm2 reload all
```

---

## 11. Checklist de Deploy

- [ ] Node.js 22, pnpm e PM2 instalados
- [ ] PostgreSQL, Redis e MongoDB a correr
- [ ] `apps/auth/.env` criado e preenchido
- [ ] `apps/api/.env` criado e preenchido
- [ ] `apps/notifications/.env` criado e preenchido
- [ ] `apps/worker/.env` criado e preenchido
- [ ] `apps/web/src/environments/environment.prod.ts` com `authApiUrl` apontado para `<dominio-auth>`
- [ ] `BETTER_AUTH_SECRET` igual em `auth` e `api`
- [ ] `ENCRYPTION_KEY` igual em `auth`, `api`, `notifications` e `worker`
- [ ] `CORS_ORIGIN` sem `*`, apenas o domínio do frontend
- [ ] `COOKIE_DOMAIN` definido em `apps/auth` se SSO entre `<dominio-frontend>` e `<dominio-auth>` for necessário
- [ ] `UI_URL` definida em `apps/auth`
- [ ] `BREVO_API_KEY` válida em `apps/worker`
- [ ] `pnpm build` executado com sucesso
- [ ] `pnpm db:migrate` executado
- [ ] `pnpm db:seed` executado
- [ ] Env files criados por app (`.env.production` / `.env.qa`)
- [ ] `pm2-logrotate` instalado e configurado
- [ ] `pm2 start ecosystem.config.js --env production` executado
- [ ] `pm2 startup` + `pm2 save` configurados
- [ ] Nginx configurado e a servir HTTPS em `<dominio-frontend>` e `<dominio-auth>`
- [ ] Portas 3000, 3100, 3200, 3300, 3400 **não expostas** diretamente ao exterior (apenas 80/443 via Nginx)
