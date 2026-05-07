# 🔐 Bloque 7.4 — Política de Rotación de Claves y Secretos

> **Estado:** Política documentada. Implementación operativa = responsabilidad del owner del proyecto Supabase.

## 1. Inventario de claves y secretos

| Clave / Secreto                | Dónde vive                                            | Quién la usa                              | Sensibilidad |
|--------------------------------|-------------------------------------------------------|-------------------------------------------|:------------:|
| `SUPABASE_URL`                 | `.env`, build envs (Astro/Vercel)                     | Cliente + servidor                        | 🟢 Pública   |
| `SUPABASE_ANON_KEY`            | `.env`, build envs                                    | Cliente (browser) — RLS la limita         | 🟢 Pública   |
| `SUPABASE_SERVICE_ROLE_KEY`    | Variables del entorno servidor (NO en `.env` cliente) | Migrations, backups, scripts admin        | 🔴 Crítica   |
| `DATABASE_URL` (postgres conn) | Solo entornos seguros (Supabase Studio, scripts CI)   | Backups, `pg_dump`, migraciones manuales  | 🔴 Crítica   |
| Tokens de Airbnb / iCal feeds  | Si se guardan, deben ir en columna encriptada o env   | Sync de bookings                          | 🟡 Media     |
| GitHub Personal Access Tokens  | GitHub Settings (no en repo)                          | CI/CD                                     | 🟡 Media     |

## 2. Reglas

1. **Nunca commitear** `service_role` ni `DATABASE_URL`. Si alguna vez se filtró → rotar **inmediatamente**.
2. `.env*` está en `.gitignore` (verificar con `git check-ignore .env`).
3. La `anon` key vive en el bundle del cliente: la única protección real es **RLS estricto** (ver `audits/06_RLS_AUDIT.md`).
4. **Service role key**: rotar al menos cada **6 meses**, o inmediatamente si:
   - Se sospecha filtración (push accidental, log expuesto, ex-colaborador con acceso).
   - Cambio de proveedor de hosting / CI.
   - Empleado o colaborador con acceso deja el proyecto.

## 3. Procedimiento de rotación (Supabase)

### 3.1 Rotar `anon` key

1. Supabase Studio → **Project Settings → API → JWT Settings → Generate new secret**.
2. Esto **invalida todos los tokens activos**. Comunicar mantenimiento corto.
3. Actualizar `.env` local + secrets del entorno productivo (Vercel/Netlify/Cloudflare).
4. Re-deploy.

### 3.2 Rotar `service_role` key

1. Studio → **Project Settings → API → Reset service_role key**.
2. Actualizar:
   - Secrets del CI (GitHub Actions / Vercel envs).
   - Cualquier script local que lo use.
   - Edge Functions / cron jobs si hubiera.
3. Verificar que ningún log antiguo del CI lo expuso. Si sí → rotar de nuevo y limpiar logs.

### 3.3 Rotar `DATABASE_URL` / contraseña de Postgres

1. Studio → **Database → Connection → Reset database password**.
2. Actualizar todas las herramientas (DBeaver, scripts, backups automatizados).

## 4. Checklist de verificación tras rotación

- [ ] App productiva responde (login + listar properties).
- [ ] Migrations corren OK (`supabase db push` o flujo equivalente).
- [ ] Backups programados siguen funcionando (revisar logs del cron).
- [ ] No quedan referencias a la clave antigua en repos privados / Notion / Slack.

## 5. Auditoría continua

- Cada **trimestre**: revisar `git log -p -- .env*` y `git log -p -S "service_role"` para detectar fugas históricas.
- Cada **release mayor**: re-correr `audits/06_RLS_AUDIT.md` para confirmar que RLS sigue blindando la `anon` key.
- Si `audit_log` (migration_039) detecta cambios sospechosos en `properties`/`expenses`/`bookings` con `user_id IS NULL` o `user_id` inesperado → investigar.

---

**Próxima revisión sugerida:** trimestral (re-evaluar este documento y rotar `service_role` cada 6 meses).
