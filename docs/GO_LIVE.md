# Go-live checklist - Robobounce v2

Pre-cierre antes de invitar al primer cliente real.

## 1. Infra y secrets

- [ ] Railway proyecto `robobounce2-prod` creado, separado del staging.
- [ ] Postgres con backup diario habilitado.
- [ ] Tres servicios deployados: `web`, `worker`, `bot`. IP estatica activada en `worker` y `bot`.
- [ ] Dominio configurado (ej. `app.robobounce.com`) con SSL automatico.
- [ ] `NEXTAUTH_URL` apunta al dominio HTTPS final.
- [ ] `MASTER_ENCRYPTION_KEY` generada con `openssl rand -base64 32`. **DISTINTA** de DEV/STAGING.
- [ ] Backup de `MASTER_ENCRYPTION_KEY` guardado en 1Password (sin esto, rotacion = inviable).
- [ ] `NEXTAUTH_SECRET`, `WEB_INTERNAL_TOKEN` rotados y unicos por entorno.
- [ ] Google OAuth Client tiene el dominio prod en `Authorized redirect URIs`.

## 2. Cuenta MEX productiva

- [ ] Cuenta MEX productiva (NO la de pruebas) creada por vos como master.
- [ ] 2FA TOTP en MEX, secret en 1Password.
- [ ] Whitelist de la IP estatica de Railway en MEX.
- [ ] Wallet master USDT-TRC20 creada y direccion cargada en `platform_sweep_wallet`.
- [ ] `system_settings.minimum_amounts` y `network_fees` revisados con valores reales del mercado.
- [ ] `platform_commissions` configuradas con tus margenes reales.

## 3. Admin y seguridad

- [ ] Tu user admin creado en PROD via `pnpm db:seed` con `ADMIN_TELEGRAM_ID`/`ADMIN_GOOGLE_EMAIL`.
- [ ] 2FA TOTP enrollado en `/admin/security`.
- [ ] `ADMIN_IP_ALLOWLIST` activado con tu(s) IP(s).
- [ ] Bot PROD distinto del de DEV (token de BotFather aparte).
- [ ] `TELEGRAM_ADMIN_CHAT_ID` apunta a tu chat personal.

## 4. Test end-to-end con plata real

- [ ] Crear un usuario tester (vos mismo desde otro Telegram), aprobarlo con cuenta MEX dummy.
- [ ] Configurar wallet TRC20 en `/wallets`.
- [ ] Configurar regla `*->USDT/TRC20`.
- [ ] Depositar 5 USDT a la cuenta MEX del tester desde una billetera externa.
- [ ] Verificar:
  - [ ] Watcher detecta el deposito (logs worker + notif Telegram).
  - [ ] `bounce_jobs` se crea con `withdraw_order_id` y `state=pending`.
  - [ ] Engine pasa por `withdrawing` -> `awaiting_withdrawal` -> `done`.
  - [ ] `withdrawals` row queda con `status='success'` y `on_chain_tx` poblado.
  - [ ] Llega Telegram `bounce_done` al usuario con TX hash valido.
  - [ ] La wallet TRC20 tester recibe el monto neto correcto.
- [ ] Forzar fail (apagar momentaneamente la wallet de destino o usar address invalida) y verificar que aparece en `/admin/operations` en rojo con paso fallido visible.
- [ ] Probar `/admin/system` -> activar y desactivar mantenimiento, verificar banner.
- [ ] Probar suspender un usuario y barrer fondos manualmente.
- [ ] Lanzar sweep manual del cron (`SELECT pg_notify(...)` o esperar al horario) y verificar que la wallet master recibe.

## 5. Plan de rollback

Si algo falla en las primeras 48hs en prod:

1. Activar mantenimiento global desde `/admin/system` (modal + doble click).
2. Notificar a usuarios via Telegram broadcast (manual desde `/admin/balances` -> mirar quienes tienen saldo en MEX).
3. Si hay bug critico:
   - Revertir el deploy en Railway al commit anterior.
   - Si el cambio toco DB schema, revertir migracion (verificar `drizzle/<n>_<name>.sql` y aplicar reverse SQL manual).
4. Si hay dudas sobre integridad de retiros:
   - `SELECT * FROM withdrawals WHERE created_at > NOW() - INTERVAL '24 hours' AND status NOT IN ('success','failed')`.
   - Cruzar con `getWithdrawHistory` de cada cuenta MEX (uso del wrapper en consola).
5. Si necesitas pausar TODO sin Web:
   ```sql
   UPDATE system_settings
   SET value = '{"enabled": true, "reason": "rollback emergencia"}'::jsonb
   WHERE key = 'maintenance_mode';
   ```

## 6. Comunicacion al primer cliente

- [ ] Aviso por Telegram que el sistema esta en beta.
- [ ] Indicar que las primeras 24hs vas a monitorear de cerca (chequeo cada 1-2hs).
- [ ] Definir canal de soporte (mismo Telegram).
- [ ] Compromiso de responder dudas en X horas.

## 7. Monitoring (post-go-live, opcional)

- [ ] Conectar `/api/health` a UptimeRobot o BetterStack.
- [ ] Sentry SDK en `web`, `worker`, `bot` (los DSN ya estan listos para conectar).
- [ ] Alerta Telegram ad-hoc si `operations.status='failed' COUNT > 5 en ultima hora`.
