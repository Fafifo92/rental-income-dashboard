// Supabase Edge Function: auto-checkin
// Marca check-in automáticamente para reservas confirmadas cuya fecha de
// inicio ya llegó (start_date <= hoy en la TZ del owner) y descuenta créditos
// de las bolsas activas si aplica.
//
// Se ejecuta CADA HORA via pg_cron. Por cada owner con settings guardados,
// verifica si la hora local actual es la 15:00 (3 PM). Si es así, procesa
// las reservas de ese owner. Esto garantiza que el horario se respeta
// independientemente de la timezone configurada en la cuenta.
//
// Despliegue:  npx supabase functions deploy auto-checkin
// Cron:        ver supabase/cron_auto_checkin.sql

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CHECKIN_HOUR = 15; // 3:00 PM hora local del owner

interface BookingLite {
  id: string;
  owner_id: string;
  start_date: string;
  end_date: string;
  num_adults: number;
  num_children: number;
  num_nights: number;
  status: string | null;
  checkin_done: boolean | null;
}

interface OwnerSettings {
  user_id: string;
  timezone: string;
}

/** Devuelve la fecha actual en formato YYYY-MM-DD para la timezone dada. */
const todayISO = (tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/** Devuelve la hora local actual (0-23) para la timezone dada. */
const localHour = (tz: string): number =>
  parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()), 10);

const calcUnits = (
  b: BookingLite,
  rule: 'per_person_per_night' | 'per_person_per_booking' | 'per_booking',
  childWeight: number,
): number => {
  const adults = Math.max(0, b.num_adults ?? 0);
  const children = Math.max(0, b.num_children ?? 0);
  const persons = adults + children * childWeight;
  if (rule === 'per_booking') return 1;
  if (rule === 'per_person_per_booking') return persons;
  const nights = Math.max(1, b.num_nights ?? 1);
  return persons * nights;
};

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

  // Obtener la timezone de cada owner desde user_notification_settings.
  // Solo se procesa un owner si su hora local actual es CHECKIN_HOUR (15:00).
  const { data: allSettings, error: sErr } = await admin
    .from('user_notification_settings')
    .select('user_id, timezone');

  if (sErr) {
    return new Response(JSON.stringify({ error: sErr.message }), { status: 500 });
  }

  const now = new Date();
  const results: Record<string, { processed: number; skipped: number; errors: number; date: string }> = {};

  for (const settings of (allSettings ?? []) as OwnerSettings[]) {
    const tz = settings.timezone || 'America/Bogota';
    const hour = localHour(tz);
    const today = todayISO(tz);
    let processed = 0, skipped = 0, errors = 0;

    // Reservas PASADAS (start_date < hoy): procesar siempre para recuperar las
    // que se escaparon del slot horario en días anteriores.
    // Reservas de HOY: solo procesar a partir de CHECKIN_HOUR para no marcar
    // check-in antes de que el huésped pueda haber llegado.
    const cutoffDate = hour >= CHECKIN_HOUR ? today : (() => {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const { data: bookings, error: bErr } = await admin
      .from('bookings')
      .select('id, owner_id, start_date, end_date, num_adults, num_children, num_nights, status, checkin_done')
      .eq('owner_id', settings.user_id)
      .lte('start_date', cutoffDate)
      .or('checkin_done.is.null,checkin_done.eq.false');

    if (bErr) { errors++; results[settings.user_id] = { processed, skipped, errors, date: today }; continue; }

    for (const b of (bookings ?? []) as BookingLite[]) {
      if ((b.status ?? '').toLowerCase().includes('cancel')) { skipped++; continue; }

      const { error: upErr } = await admin
        .from('bookings')
        .update({ checkin_done: true })
        .eq('id', b.id);
      if (upErr) { errors++; continue; }

      const { data: pools } = await admin
        .from('credit_pools')
        .select('*')
        .eq('owner_id', b.owner_id)
        .eq('status', 'active')
        .lte('activated_at', b.start_date)
        .order('activated_at', { ascending: false });

      const pool = (pools ?? []).find((p: any) => Number(p.credits_total) - Number(p.credits_used) > 0);
      if (!pool) { processed++; continue; }

      const { data: existing } = await admin
        .from('credit_pool_consumptions')
        .select('id')
        .eq('pool_id', pool.id)
        .eq('booking_id', b.id)
        .maybeSingle();
      if (existing) { processed++; continue; }

      const units = calcUnits(b, pool.consumption_rule, Number(pool.child_weight ?? 1));
      const requested = units * Number(pool.credits_per_unit);
      const available = Number(pool.credits_total) - Number(pool.credits_used);
      const toUse = Math.min(requested, available);
      const insufficient = requested > available;

      await admin.from('credit_pool_consumptions').insert({
        owner_id: b.owner_id,
        pool_id: pool.id,
        booking_id: b.id,
        units,
        credits_used: toUse,
        occurred_at: today,
        notes: insufficient ? 'Saldo insuficiente: se consumió el remanente.' : null,
      });

      const newUsed = Number(pool.credits_used) + toUse;
      const newStatus = newUsed >= Number(pool.credits_total) ? 'depleted' : pool.status;
      await admin.from('credit_pools').update({ credits_used: newUsed, status: newStatus }).eq('id', pool.id);

      if (insufficient) {
        const missing = requested - toUse;
        const unitPrice = Number(pool.credits_total) > 0 ? Number(pool.total_price) / Number(pool.credits_total) : 0;
        const suggested = Math.round(missing * unitPrice);
        await admin.from('expenses').insert({
          owner_id: b.owner_id,
          property_id: null,
          category: 'Seguros',
          type: 'variable',
          amount: suggested,
          currency: 'COP',
          date: today,
          description: `Recarga sugerida de créditos · ${pool.name} (faltan ${missing.toFixed(0)} créditos)`,
          status: 'pending',
          bank_account_id: null,
          booking_id: null,
          vendor: pool.name,
          person_in_charge: null,
          adjustment_id: null,
          vendor_id: pool.vendor_id ?? null,
          shared_bill_id: null,
          subcategory: null,
          expense_group_id: null,
        });
      }
      processed++;
    }

    results[settings.user_id] = { processed, skipped, errors, date: today };
  }

  return new Response(JSON.stringify({ results, utc: now.toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
