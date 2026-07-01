# Servifibras — Deployment de cero en un servidor nuevo

Guía para levantar el stack completo (backend NestJS + frontend Next.js + Postgres + Caddy + cron de backup) desde un servidor Ubuntu 24 LTS vacío. Todo lo específico del cliente (credenciales, dominios, tokens externos) queda por fuera del repo — se pasa por canal separado.

---

## 1. Prerequisitos del servidor

Máquina Ubuntu 24 LTS (o similar), acceso root vía SSH. Recomendado 4 vCPU / 8 GB RAM / 160 GB SSD como mínimo para carga real (backend NestJS + Postgres + agente Claude + varios crons).

Instalar dependencias base:

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential postgresql-16 caddy s3cmd
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
```

Verificar: `node -v` ≥ 24, `psql --version` ≥ 16.

Crear el usuario de sistema que va a correr los servicios:

```bash
useradd -m -s /bin/bash servifibras
```

---

## 2. Postgres

Crear base de datos + usuario dedicado:

```bash
sudo -u postgres psql <<EOF
CREATE USER servifibras_user WITH PASSWORD '<GENERAR-PASSWORD-32-CHARS-AQUI>';
CREATE DATABASE servifibras_db OWNER servifibras_user;
GRANT ALL PRIVILEGES ON DATABASE servifibras_db TO servifibras_user;
EOF
```

El `DATABASE_URL` va a la `.env` del backend (paso 4). Formato:
`postgresql://servifibras_user:<PASSWORD>@127.0.0.1:5432/servifibras_db?schema=public&connection_limit=3&pool_timeout=20`

El `connection_limit=3` es intencional: sin él, los ~9 servicios que instancian PrismaClient consumen el pool de 100 conexiones de Postgres y crashea con "remaining connection slots are reserved".

---

## 3. Clonar el repo

```bash
cd /home/servifibras
git clone https://github.com/<ORG>/<REPO>.git .
chown -R servifibras:servifibras .
```

Estructura del repo:
- `backend/` — NestJS + Prisma
- `frontend/` — Next.js
- `ops/` — scripts de operación (deploy, backup, restore, systemd units)
- `overview/` — SSOT del proyecto (conversation, requirement, business)

---

## 4. Variables de entorno

Las credenciales NO van al repo. Se pasan por canal seguro (WhatsApp directo con el cliente) y se pegan a mano en:

- `/home/servifibras/backend/.env`
- `/home/servifibras/frontend/.env.local` (solo `NEXT_PUBLIC_API_URL` u otras públicas)

Categorías de vars que hay que setear:

- `DATABASE_URL` (paso 2)
- `JWT_SECRET` (generar 64 hex chars: `openssl rand -hex 32`)
- `CLAUDE_API_KEY` — cliente lo provee
- `MERCADOLIBRE_*` (5 vars — APP_ID, CLIENT_SECRET, REDIRECT_URI + ACCESS/REFRESH populados por OAuth callback)
- `TIENDANUBE_*` (APP_ID, CLIENT_SECRET, REDIRECT_URI + STORE_ID/ACCESS_TOKEN por OAuth)
- `WHATSAPP_*` (Meta Cloud) o `WHATSAPP_QR_ENABLED=true` (Baileys alternative)
- `BACKUP_S3_*` (5 vars — endpoint, region, bucket, access key, secret key). Sin esto los backups son solo locales, con esto suben a DigitalOcean Spaces / S3.
- `CADDY_*` — dominios frontend/api (usados por el Caddyfile)
- Env de tuning: `THROTTLE_*`, `LOGISTICA_*`, `ML_CLAIMS_REFRESH_*`, `TIENDANUBE_ORDERS_LOOKBACK_DAYS`, etc.

Referencia completa: `backend/.env.example` (copia comentada del `.env` de prod con placeholders).

Permisos correctos (críticos — root-owned `.env` rompe el backup y colapsa `/health` en 48h):

```bash
chown servifibras:servifibras /home/servifibras/backend/.env
chmod 640 /home/servifibras/backend/.env
```

---

## 5. Backend

```bash
cd /home/servifibras/backend
sudo -u servifibras npm install
sudo -u servifibras npx prisma generate
sudo -u servifibras npx prisma migrate deploy
sudo -u servifibras npm run build
```

Systemd unit — copiar desde el repo:

```bash
cp /home/servifibras/ops/systemd/servifibras-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable servifibras-backend
systemctl start servifibras-backend
```

Verify: `journalctl -u servifibras-backend --since "1 min ago"` debe mostrar `Nest application successfully started`.

`curl http://127.0.0.1:3001/health` debe devolver `{ status: 'ok' | 'degraded' }` con components todos ok. "degraded" tolerable si es solo `dolarBlue` recién levantado sin cache.

---

## 6. Frontend

```bash
cd /home/servifibras/frontend
sudo -u servifibras npm install
sudo -u servifibras npm run build
```

Systemd unit:

```bash
cp /home/servifibras/ops/systemd/servifibras-frontend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable servifibras-frontend
systemctl start servifibras-frontend
```

Ownership crítico del cache directory:

```bash
chown -R servifibras:servifibras /home/servifibras/frontend/.next/cache
```

(Root-owned .next/cache genera EACCES en SSR de imágenes → 500 en cold compile. `deploy.sh` heala esto en cada corrida.)

---

## 7. Caddy (reverse proxy + TLS auto)

Copiar el Caddyfile del cliente actual (referencia — DNS specific):

```
dev.servifibras.com {
    reverse_proxy 127.0.0.1:3000
}

api-dev.servifibras.com {
    reverse_proxy 127.0.0.1:3001
}
```

Log rotation preventivo (Caddy no rota por default):

```bash
cp /home/servifibras/ops/logrotate/caddy-servifibras /etc/logrotate.d/
```

Restart: `systemctl restart caddy`.

TLS: Caddy usa Let's Encrypt automático. Solo requiere que los A/AAAA records apunten al servidor antes del primer boot.

---

## 8. DNS

Records A/AAAA de los subdominios apuntando a la IP del servidor. Sin esto Caddy no puede sacar los certs.

- `dev.servifibras.com` → IP del server
- `api-dev.servifibras.com` → IP del server

---

## 9. Backups

Directorio local:

```bash
mkdir -p /srv/servifibras-backups
chown servifibras:servifibras /srv/servifibras-backups
chmod 750 /srv/servifibras-backups
```

Systemd unit + timer del backup:

```bash
cp /home/servifibras/ops/systemd/servifibras-backup.service /etc/systemd/system/
cp /home/servifibras/ops/systemd/servifibras-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now servifibras-backup.timer
```

Corre 03:15 UTC cada día. Rotación: 15 dailies + 4 weeklies + 3 monthlies. Con `BACKUP_S3_*` seteados en `.env`, sube también a Spaces/S3.

Manual test: `systemctl start servifibras-backup.service`. Verificar en `/srv/servifibras-backups/daily/` y en el bucket S3.

---

## 10. First-run verification checklist

- [ ] `curl https://api-dev.servifibras.com/health` → HTTP 200 con `status: ok`
- [ ] `curl https://dev.servifibras.com/login` → HTML de login
- [ ] Login desde browser con la cuenta admin (Yanina / Marcos / etc — las setea `prisma migrate deploy` desde el seed)
- [ ] `journalctl -u servifibras-backend --since "5 min ago"` sin ERROR
- [ ] `systemctl list-timers servifibras-backup.timer` muestra el próximo fire
- [ ] Manual backup run + check en el bucket S3
- [ ] MercadoLibre OAuth callback funciona (login desde /configuracion → Integraciones → conectar)
- [ ] TiendaNube OAuth callback funciona (mismo path)
- [ ] Crons registrados en el startup log del backend: `TiendaNubeOrdersSyncCron`, `MlClaimsSyncCron`, `MlClaimsRefreshCron`, `LeadFollowupCron`, `LowStockAlertCron`, `DailyDigestCron`, `WeeklyLeadsReportCron`, `TiendaNubeSyncCron`, `MlBatchQueueCron`

---

## 11. Ongoing deploys

Producción se despliega via:

```bash
cd /home/servifibras && bash ops/deploy.sh
```

Flags relevantes:
- `--allow-schema-change` — cuando cambiaste `schema.prisma` y ya aplicaste el `ALTER TABLE` manualmente (nunca `prisma db push --accept-data-loss` — wipe silente).
- `--backend-only`, `--frontend-only` — para deploys parciales.

El script:
1. Compara sha256 de `schema.prisma` con el último aplicado (drift guard).
2. Chown `.env` + `.next/cache` a `servifibras:servifibras`.
3. Verifica Postgres alcanzable (`pg_isready`).
4. `npm install` + `prisma generate` + `npm run build` de ambos.
5. Restart de servicios systemd en orden.
6. Poll `/health` hasta ver `status: ok` antes de marcar OK.

---

## 12. Trap conocido y solución

- **`.env` root-owned** → backup falla como user `servifibras` → `/health` reporta backup down 48h → Caddy 503s. `deploy.sh` heala en cada corrida.
- **Deploy churn** — ≥3 deploys en <30 min → ventanas de cold-compile de Next.js visibles como "Internal Server Error" a los usuarios. Batchear.
- **Prisma camelCase** — columnas de `ALTER TABLE` deben ir en camelCase double-quoted (`"dispatchMode"`, no `dispatch_mode`) para matchear los nombres de campo Prisma sin `@map`.
