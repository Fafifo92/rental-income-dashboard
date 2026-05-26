// Supabase Edge Function: admin-password-actions
// ============================================================
// Permite al administrador de la app realizar acciones de contraseña
// sobre OTRAS cuentas:
//
//   - generate_link : devuelve un link de recuperación (con expiración
//                     definida en Supabase Auth) que el admin puede
//                     enviar al usuario por el canal que prefiera.
//   - set_password  : el admin establece directamente una nueva
//                     contraseña (mínimo 8 chars).
//
// Seguridad:
//   - Requiere JWT válido del caller (Authorization: Bearer <jwt>).
//   - Verifica que el caller tenga profiles.role = 'admin'.
//   - El service_role key vive en variables de entorno de la Edge
//     Function — nunca llega al navegador.
//   - El caller no puede operar sobre sí mismo ni sobre otros admins
//     vía esta función (por seguridad operacional).
//
// Despliegue:  npx supabase functions deploy admin-password-actions
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  action: 'generate_link' | 'set_password';
  target_id: string;
  new_password?: string;
  redirect_to?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 1) Validar JWT del caller usando anon key + Authorization header
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'missing_bearer_token' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'invalid_token' }, 401);
  }
  const callerId = userData.user.id;

  // 2) Verificar que el caller es admin (usando service_role para evitar RLS)
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile, error: profErr } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', callerId)
    .single();

  if (profErr || !callerProfile || callerProfile.role !== 'admin') {
    return json({ error: 'forbidden_not_admin' }, 403);
  }

  // 3) Parsear body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.target_id || !body.action) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (body.target_id === callerId) {
    return json({ error: 'cannot_target_self' }, 400);
  }

  // 4) Verificar que el target existe y NO es admin (un admin no puede
  // operar sobre otro admin desde esta función — por seguridad)
  const { data: targetProfile, error: targetErr } = await adminClient
    .from('profiles')
    .select('id, email, role')
    .eq('id', body.target_id)
    .single();

  if (targetErr || !targetProfile) {
    return json({ error: 'target_not_found' }, 404);
  }
  if (targetProfile.role === 'admin') {
    return json({ error: 'cannot_target_admin' }, 403);
  }

  // 5) Ejecutar acción
  if (body.action === 'set_password') {
    if (!body.new_password || body.new_password.length < 8) {
      return json({ error: 'password_too_short' }, 400);
    }
    const { error: updErr } = await adminClient.auth.admin.updateUserById(
      body.target_id,
      { password: body.new_password },
    );
    if (updErr) return json({ error: updErr.message }, 500);
    return json({ ok: true });
  }

  if (body.action === 'generate_link') {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: targetProfile.email,
      options: body.redirect_to ? { redirectTo: body.redirect_to } : undefined,
    });
    if (error) return json({ error: error.message }, 500);
    const link = data?.properties?.action_link ?? null;
    if (!link) return json({ error: 'no_link_returned' }, 500);
    return json({ ok: true, link });
  }

  return json({ error: 'unknown_action' }, 400);
});
