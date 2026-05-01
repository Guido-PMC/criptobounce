# Robobounce v2

Plataforma de bouncing automatico de criptomonedas via MEXC. Recibe depositos en cualquier asset/red soportado, opcionalmente convierte y reenvia a la wallet destino del usuario.

## Arquitectura

Monorepo pnpm con tres servicios y packages compartidos:

```
apps/
  web/          Next.js 15 - panel usuario y admin + API routes
  worker/       Node/TS headless - deposit watcher, bounce engine, sweep, reconciliation
  bot/          Bot Telegram (grammY)
packages/
  db/           Drizzle schema + migraciones
  mex-client/   Cliente MEX tipado con tracing
  crypto/       AES-GCM helpers para cifrado de API keys
  domain/       Tipos compartidos de negocio
  config/       Validacion env con zod
base/           Codigo legacy de v1 (referencia, no se modifica)
```

## Setup local

```bash
# 1. Copiar env
cp .env.example .env

# 2. Generar secrets
echo "MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "WEB_INTERNAL_TOKEN=$(openssl rand -base64 32)" >> .env

# 3. Instalar deps
pnpm install

# 4. Postgres local (Docker)
docker run -d --name rb-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# 5. Migraciones + seed
pnpm db:push
pnpm db:seed

# 6. Dev (3 terminales o pnpm dev)
pnpm web:dev
pnpm worker:dev
pnpm bot:dev
```

## Documentacion

- Plan completo: ver chat history o `.cursor/plans/`
- Runbook operativo: [docs/RUNBOOK.md](docs/RUNBOOK.md) (creado en Fase 9)
# criptobounce
