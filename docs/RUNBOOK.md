# Robobounce v2 - Runbook operativo

Guia para operar y diagnosticar el sistema en produccion.

## Indice

1. Setup inicial
2. Operaciones cotidianas
3. Procedimientos de emergencia
4. Errores comunes de MEX y resolucion
5. Backups y restore

## 1. Setup inicial

### Cuenta MEX por usuario

Cada usuario tiene UNA cuenta MEX dedicada. Vos sos el unico admin de esa cuenta:

1. Crear cuenta MEX con un email tuyo (ej. `clientNN+robobounce@tudominio.com`).
2. Habilitar 2FA con TOTP, guardar secret en 1Password.
3. Generar API key con permisos: SPOT trading + WITHDRAW + READ. Whitelist la IP fija de Railway.
4. En el panel admin: aprobar usuario y pegar API key + secret.

### Variables de entorno criticas

- `MASTER_ENCRYPTION_KEY` (worker): unica por entorno. Sin esta clave, las API keys cifradas son irrecuperables.
- `ADMIN_IP_ALLOWLIST` (web): coma-separado. Si vacio, no se filtra.
- `DRY_RUN` (worker): `true` en staging para evitar writes a MEX reales.

## 2. Operaciones cotidianas

### Aprobar un usuario

1. Notificacion llega a tu chat de Telegram.
2. Ir a `/admin/users/pending`.
3. Click "Revisar" -> cargar API key + secret + email MEX.
4. Marcar checkbox "IP whitelisted" (despues de hacerlo en MEX).
5. Click "Aprobar y enviar invitacion". El bot le manda link al usuario.

### Activar mantenimiento global

1. Ir a `/admin/system`.
2. Escribir motivo, opcionalmente programar fin.
3. Doble-click en "Activar mantenimiento".
4. Banner rojo aparece en admin, banner amarillo en usuario.
5. Worker no toma jobs nuevos. Jobs en vuelo terminan paso actual.

### Ejecutar sweep manual de un usuario suspendido

1. Suspender el usuario desde `/admin/users/<id>`.
2. Click "Barrer fondos a wallet externa".
3. Cargar asset, red, address, monto.
4. Confirmar. El worker (`manual-sweep` dispatcher) lo ejecuta en el siguiente loop.

### Rotar API keys de un usuario

1. Generar nuevas keys en MEX (whitelist misma IP).
2. Panel admin -> usuario -> "Rotar API keys MEX" -> pegar nuevas.

## 3. Procedimientos de emergencia

### Worker stuck / no procesa jobs

1. Verificar `/api/health` del web.
2. Conectar a la DB:
   ```sql
   SELECT id, state, locked_by, locked_at FROM bounce_jobs WHERE state IN ('withdrawing','awaiting_withdrawal') ORDER BY created_at;
   ```
3. Si hay leases viejos (>5min), el worker proximo los retoma automaticamente.
4. Si persiste: redeploy worker. SIGTERM espera leases en vuelo.

### Detectaste un retiro duplicado

NO deberia pasar (3 capas de idempotencia). Si pasa:

1. Buscar en `/admin/operations` por `withdraw_order_id`.
2. Verificar que `withdrawals.withdraw_order_id` sea UNICA (constraint a nivel DB).
3. Reportar bug y reconstruir contabilidad manualmente.

### Telegram bot caido

El bot en polling se recupera solo. Si no, redeploy. Las notificaciones se acumulan en `telegram_messages` con `sentOk IS NULL` y se envian cuando vuelve.

### MASTER_ENCRYPTION_KEY perdida

Las API keys cifradas no se pueden recuperar. Plan:

1. Restaurar la key desde 1Password (esto tiene que estar respaldado).
2. Si no hay backup: rotar TODAS las API keys de MEX manualmente y re-cargarlas en el panel.

## 4. Errores comunes de MEX

| Sintoma | Causa probable | Resolucion |
|---|---|---|
| `Signature for this request is not valid` | API secret incorrecto o reloj desincronizado | Verificar secret. Sincronizar reloj del servidor. |
| `Withdrawal amount must be greater than xx` | Por debajo del min de MEX | Subir el `network_fees` config o esperar mas saldo. |
| `Withdrawal address invalid` | Direccion mal formateada o red incorrecta | Validar address en `/wallets`. |
| `IP not whitelisted` | IP del worker cambio | Cargar nueva IP en MEX para esa API key. |
| `Asset withdrawal disabled` | MEX deshabilito temporalmente | Job queda `on_hold`. Reconciliation reintenta cuando rehabilita. |
| `User canceled withdrawal` | Algo activo el cancel desde MEX UI | Marcar job `failed` y revisar manualmente. |

## 5. Backups y restore

### Backups automaticos

Railway Postgres incluye backups diarios. Configurar segun plan.

### Restore completo

1. Crear nueva DB en Railway.
2. Restaurar dump del dia anterior.
3. Apuntar `DATABASE_URL` del worker/web/bot a la nueva.
4. Verificar `/api/health`.
5. Re-cargar `MASTER_ENCRYPTION_KEY` (sin esta no podras descifrar API keys).

### Test de restore (mensual)

1. Crear DB efimera con dump de prod.
2. Levantar worker con `DRY_RUN=true` apuntando a esa DB.
3. Verificar que carga, lee balances y muestra logs sin errores.
4. Destruir DB efimera.

## 6. Migracion de bot a webhook (opcional, post-MVP)

Hoy el bot corre en long polling. Para migrar:

1. Habilitar `TELEGRAM_WEBHOOK_SECRET` en web.
2. `curl -F "url=https://app/api/telegram/webhook" -F "secret_token=<token>" https://api.telegram.org/bot<TOKEN>/setWebhook`
3. Plugar `webhookCallback(bot)` de grammY en `apps/web/app/api/telegram/webhook/route.ts`.
4. Bajar el servicio `bot` de Railway.
5. La cola de outbound `telegram_messages` debe procesarse desde el worker (mover el outbound loop alli).
