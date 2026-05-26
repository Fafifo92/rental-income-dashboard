// Supabase Edge Function: notify-reminders
// ============================================================
// Envía emails digest diarios con recordatorios de pendientes.
//
// Se ejecuta CADA HORA via pg_cron. Para cada usuario con
// `email_enabled=true`, verifica:
//   • Si su hora local actual coincide con `send_hour`
//   • Si toca enviar según `repeat_cadence` (daily/every_2_days/weekly)
//   • Si hay pendientes que reportar (categorías habilitadas)
// Si todo se cumple, llama a get_pending_digest() y envía email
// vía Resend.
//
// Requiere variables de entorno:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticas)
//   - RESEND_API_KEY (set via: npx supabase secrets set RESEND_API_KEY=...)
//   - REMINDER_FROM_EMAIL (opcional, default onboarding@resend.dev)
//   - APP_BASE_URL (opcional, para construir el link al dashboard)
//
// Despliegue:  npx supabase functions deploy notify-reminders
// Cron:        ver supabase/cron_notify_reminders.sql
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const FROM_EMAIL    = Deno.env.get('REMINDER_FROM_EMAIL') ?? 'STR Analytics <onboarding@resend.dev>';
const APP_BASE_URL  = Deno.env.get('APP_BASE_URL') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

interface Settings {
  user_id: string;
  timezone: string;
  email_enabled: boolean;
  reminders_enabled: boolean;
  lead_days: number;
  repeat_cadence: 'daily' | 'every_2_days' | 'weekly';
  send_hour: number;
  notify_recurring: boolean;
  notify_maintenance: boolean;
  notify_shared_bills: boolean;
  notify_damage: boolean;
  notify_cleaner: boolean;
  last_email_sent_at: string | null;
}

interface Digest {
  recurring: number;
  shared_bills: number;
  maintenance: number;
  cleanings: number;
  checkout_pending: number;
  inventory_pending: number;
  payout_pending: number;
  end_of_life: number;
  total: number;
}

const localHour = (tz: string): number =>
  parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  );

const daysBetween = (fromIso: string | null, now: Date): number => {
  if (!fromIso) return Infinity;
  const diff = now.getTime() - new Date(fromIso).getTime();
  return diff / (1000 * 60 * 60 * 24);
};

const cadenceMet = (cadence: Settings['repeat_cadence'], lastSentAt: string | null): boolean => {
  const days = daysBetween(lastSentAt, new Date());
  if (cadence === 'daily')        return days >= 0.9;
  if (cadence === 'every_2_days') return days >= 1.9;
  if (cadence === 'weekly')       return days >= 6.9;
  return true;
};

/** Filtra el digest según los toggles de categoría activos del usuario. */
const applyToggles = (d: Digest, s: Settings): Digest => {
  const out = { ...d };
  if (!s.notify_recurring)    out.recurring = 0;
  if (!s.notify_shared_bills) out.shared_bills = 0;
  if (!s.notify_maintenance) { out.maintenance = 0; out.end_of_life = 0; }
  if (!s.notify_cleaner)      out.cleanings = 0;
  if (!s.notify_damage) { /* booking alerts no se filtran por damage; quedan siempre */ }
  out.total = out.recurring + out.shared_bills + out.maintenance + out.cleanings
            + out.checkout_pending + out.inventory_pending + out.payout_pending + out.end_of_life;
  return out;
};

const buildEmailHtml = (digest: Digest, userEmail: string): string => {
  const rows: Array<{ label: string; count: number; color: string }> = [];
  if (digest.recurring > 0)         rows.push({ label: 'Gastos recurrentes pendientes',         count: digest.recurring,         color: '#f59e0b' });
  if (digest.shared_bills > 0)      rows.push({ label: 'Cuentas compartidas sin pagar',         count: digest.shared_bills,      color: '#f59e0b' });
  if (digest.maintenance > 0)       rows.push({ label: 'Mantenimientos próximos / vencidos',     count: digest.maintenance,       color: '#ef4444' });
  if (digest.cleanings > 0)         rows.push({ label: 'Aseos pendientes de pago',               count: digest.cleanings,         color: '#3b82f6' });
  if (digest.checkout_pending > 0)  rows.push({ label: 'Checkouts pendientes',                   count: digest.checkout_pending,  color: '#ef4444' });
  if (digest.inventory_pending > 0) rows.push({ label: 'Revisiones de inventario pendientes',    count: digest.inventory_pending, color: '#ef4444' });
  if (digest.payout_pending > 0)    rows.push({ label: 'Reservas sin cuenta de cobro',           count: digest.payout_pending,    color: '#f59e0b' });
  if (digest.end_of_life > 0)       rows.push({ label: 'Artículos al final de vida útil',        count: digest.end_of_life,       color: '#a855f7' });

  const rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937;">${r.label}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <span style="display:inline-block;min-width:32px;text-align:center;background:${r.color};color:white;font-weight:700;font-size:13px;padding:4px 10px;border-radius:12px;">${r.count}</span>
      </td>
    </tr>`).join('');

  const ctaUrl = APP_BASE_URL ? `${APP_BASE_URL}/notificaciones` : '#';
  const ctaButton = APP_BASE_URL ? `
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background:#3b82f6;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Ver detalles en el dashboard</a>
    </div>` : '';

  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr><td style="padding:24px 24px 16px;background:linear-gradient(135deg,#1e3a8a,#3b82f6);color:white;">
          <h1 style="margin:0;font-size:20px;">STR Analytics</h1>
          <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">Resumen de pendientes</p>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 16px;color:#374151;font-size:14px;">Hola, ${userEmail}.<br>Tienes <strong>${digest.total}</strong> pendiente${digest.total === 1 ? '' : 's'} por revisar:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${rowsHtml}
          </table>
          ${ctaButton}
          <p style="margin:24px 0 0;font-size:12px;color:#6b7280;text-align:center;">
            Recibes este correo porque tienes activos los recordatorios por email.<br>
            Puedes desactivarlos en Notificaciones → Email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `resend ${res.status}: ${text}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Permite forzar un email de prueba via body { force_user_id: '...' }
  let forceUserId: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.force_user_id === 'string') forceUserId = body.force_user_id;
  } catch { /* sin body */ }

  const { data: settings, error: sErr } = await admin
    .from('user_notification_settings')
    .select('*')
    .eq('email_enabled', true);

  if (sErr) return new Response(JSON.stringify({ error: sErr.message }), { status: 500 });

  const results: any[] = [];

  for (const s of (settings ?? []) as Settings[]) {
    const isForce = forceUserId === s.user_id;

    if (!s.reminders_enabled) {
      if (!isForce) { results.push({ user: s.user_id, skip: 'reminders_disabled' }); continue; }
    }

    // Filtro horario (excepto si es force test)
    if (!isForce) {
      const hour = localHour(s.timezone || 'America/Bogota');
      if (hour !== s.send_hour) {
        results.push({ user: s.user_id, skip: `hour ${hour} != send_hour ${s.send_hour}` });
        continue;
      }
      if (!cadenceMet(s.repeat_cadence, s.last_email_sent_at)) {
        results.push({ user: s.user_id, skip: `cadence ${s.repeat_cadence} not met` });
        continue;
      }
    }

    // Obtener email del usuario (auth.users)
    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(s.user_id);
    if (uErr || !userData?.user?.email) {
      results.push({ user: s.user_id, error: 'no_email' });
      continue;
    }
    const email = userData.user.email;

    // Computar digest
    const { data: digestRaw, error: dErr } = await admin.rpc('get_pending_digest', {
      p_owner_id:  s.user_id,
      p_lead_days: s.lead_days ?? 5,
    });
    if (dErr || !digestRaw) {
      results.push({ user: s.user_id, error: `digest: ${dErr?.message}` });
      continue;
    }
    const digest = applyToggles(digestRaw as Digest, s);

    if (digest.total === 0 && !isForce) {
      results.push({ user: s.user_id, skip: 'nothing_pending' });
      continue;
    }

    const subject = digest.total === 0
      ? '✅ Sin pendientes hoy — STR Analytics'
      : `📋 Tienes ${digest.total} pendiente${digest.total === 1 ? '' : 's'} — STR Analytics`;

    const html = buildEmailHtml(digest, email);
    const sent = await sendEmail(email, subject, html);

    if (!sent.ok) {
      results.push({ user: s.user_id, error: sent.error });
      continue;
    }

    await admin
      .from('user_notification_settings')
      .update({
        last_email_sent_at: new Date().toISOString(),
        last_email_summary: JSON.stringify(digest),
      })
      .eq('user_id', s.user_id);

    results.push({ user: s.user_id, sent: true, total: digest.total });
  }

  return new Response(JSON.stringify({ results, count: results.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
