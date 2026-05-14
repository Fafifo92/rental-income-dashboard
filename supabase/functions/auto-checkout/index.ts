// Supabase Edge Function: auto-checkout
// Marca check-out automáticamente para reservas cuya fecha de
// fin ya pasó (end_date <= hoy) y checkout_done = false.
// También garantiza checkin_done = true si el auto-checkin lo pasó por alto.
// Adicionalmente marca como 'done' las limpiezas pendientes de esas reservas.
//
// Despliegue:  npx supabase functions deploy auto-checkout
// Cron:        ver supabase/cron_auto_checkout.sql

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

interface BookingLite {
  id: string;
  end_date: string;
  status: string | null;
  checkin_done: boolean | null;
  checkout_done: boolean | null;
}

// Timezone-aware "today" for Bogotá (UTC-5).
// Same pattern as auto-checkin/index.ts — Deno can't share modules.
const todayISO = (tz = 'America/Bogota'): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

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

  const today = todayISO();

  // All bookings whose end_date has passed and checkout is still pending
  const { data: bookings, error: bErr } = await admin
    .from('bookings')
    .select('id, end_date, status, checkin_done, checkout_done')
    .lte('end_date', today)
    .or('checkout_done.is.null,checkout_done.eq.false');

  if (bErr) {
    return new Response(JSON.stringify({ error: bErr.message }), { status: 500 });
  }

  let processed = 0, skipped = 0, errors = 0;

  for (const b of (bookings ?? []) as BookingLite[]) {
    if ((b.status ?? '').toLowerCase().includes('cancel')) { skipped++; continue; }

    const updates: Record<string, boolean> = { checkout_done: true };
    // If auto-checkin somehow missed this booking, mark it too
    if (!b.checkin_done) updates.checkin_done = true;

    const { error: upErr } = await admin
      .from('bookings')
      .update(updates)
      .eq('id', b.id);

    if (upErr) { errors++; continue; }

    // Auto-mark any pending cleanings as done (end_date is the reference date)
    await admin
      .from('booking_cleanings')
      .update({ status: 'done', done_date: b.end_date })
      .eq('booking_id', b.id)
      .eq('status', 'pending');

    processed++;
  }

  return new Response(
    JSON.stringify({ processed, skipped, errors, date: today }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
