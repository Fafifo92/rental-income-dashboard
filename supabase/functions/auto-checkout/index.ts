// Supabase Edge Function: auto-checkout
// Marca check-out automáticamente para reservas cuya fecha de fin llegó
// (end_date <= hoy en la TZ del owner) y checkout_done = false.
// También garantiza checkin_done = true si el auto-checkin lo pasó por alto.
// Adicionalmente marca como 'done' las limpiezas pendientes de esas reservas.
//
// Se ejecuta CADA HORA via pg_cron. Por cada owner con settings guardados,
// verifica si la hora local actual es la 12:00 (mediodía). Si es así, procesa
// las reservas de ese owner. Esto garantiza que el horario se respeta
// independientemente de la timezone configurada en la cuenta.
//
// Despliegue:  npx supabase functions deploy auto-checkout
// Cron:        ver supabase/cron_auto_checkout.sql

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CHECKOUT_HOUR = 12; // 12:00 PM (mediodía) hora local del owner

interface BookingLite {
  id: string;
  end_date: string;
  status: string | null;
  checkin_done: boolean | null;
  checkout_done: boolean | null;
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
  // Solo se procesa un owner si su hora local actual es CHECKOUT_HOUR (12:00).
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

    // Reservas PASADAS (end_date < hoy): procesar siempre para recuperar las
    // que se escaparon del slot horario en días anteriores.
    // Reservas de HOY: solo procesar a partir de CHECKOUT_HOUR para no marcar
    // check-out antes de que el huésped pueda haber salido.
    const cutoffDate = hour >= CHECKOUT_HOUR ? today : (() => {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    // Bookings are not directly scoped by owner_id; ownership is resolved
    // through listings → properties. Fetch the listing IDs for this owner first.
    const { data: propsData, error: propErr } = await admin
      .from('properties')
      .select('listings(id)')
      .eq('owner_id', settings.user_id);

    if (propErr) { errors++; results[settings.user_id] = { processed, skipped, errors, date: today }; continue; }

    const listingIds: string[] = (propsData ?? []).flatMap(
      (p: { listings: Array<{ id: string }> | null }) =>
        (p.listings ?? []).map((l) => l.id),
    );

    if (listingIds.length === 0) {
      results[settings.user_id] = { processed, skipped, errors, date: today };
      continue;
    }

    const { data: bookings, error: bErr } = await admin
      .from('bookings')
      .select('id, end_date, status, checkin_done, checkout_done')
      .in('listing_id', listingIds)
      .lte('end_date', cutoffDate)
      .or('checkout_done.is.null,checkout_done.eq.false');

    if (bErr) { errors++; results[settings.user_id] = { processed, skipped, errors, date: today }; continue; }

    for (const b of (bookings ?? []) as BookingLite[]) {
      if ((b.status ?? '').toLowerCase().includes('cancel')) { skipped++; continue; }

      const updates: Record<string, boolean> = { checkout_done: true };
      // Si auto-checkin lo pasó por alto, marcarlo también
      if (!b.checkin_done) updates.checkin_done = true;

      const { error: upErr } = await admin
        .from('bookings')
        .update(updates)
        .eq('id', b.id);

      if (upErr) { errors++; continue; }

      // Auto-marcar las limpiezas pendientes como completadas
      await admin
        .from('booking_cleanings')
        .update({ status: 'done', done_date: b.end_date })
        .eq('booking_id', b.id)
        .eq('status', 'pending');

      processed++;
    }

    results[settings.user_id] = { processed, skipped, errors, date: today };
  }

  return new Response(
    JSON.stringify({ results, utc: now.toISOString() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
