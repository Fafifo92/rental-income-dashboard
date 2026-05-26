import { supabase } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { AccountStatus, ProfileRow } from '@/types/database';

export type AuthResult<T> = { data: T; error: null } | { data: null; error: string };

// ─── Demo mode detection ──────────────────────────────────────────────────────

export function isSupabaseConfigured(): boolean {
  try {
    const url = import.meta.env.PUBLIC_SUPABASE_URL as string;
    const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;
    return !!(url && key && url.startsWith('https') && !url.includes('placeholder'));
  } catch {
    return false;
  }
}

// ─── Auth operations ──────────────────────────────────────────────────────────

export type SignInOutcome =
  | { kind: 'ok'; session: Session; profile: Pick<ProfileRow, 'id' | 'role' | 'status'> }
  | { kind: 'pending' }
  | { kind: 'suspended' }
  | { kind: 'error'; message: string };

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  if (!isSupabaseConfigured()) return { kind: 'error', message: 'DEMO_MODE' };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { kind: 'error', message: error.message };
  if (!data.session) return { kind: 'error', message: 'No se pudo iniciar sesión' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, status')
    .eq('id', data.session.user.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    return { kind: 'error', message: 'No se pudo verificar el estado de la cuenta' };
  }

  if (profile.status === 'pending') {
    await supabase.auth.signOut();
    return { kind: 'pending' };
  }
  if (profile.status === 'suspended') {
    await supabase.auth.signOut();
    return { kind: 'suspended' };
  }

  return { kind: 'ok', session: data.session, profile };
}

export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult<User>> {
  if (!isSupabaseConfigured()) return { data: null, error: 'DEMO_MODE' };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { data: null, error: error.message };
  if (!data.user) return { data: null, error: 'Error al crear cuenta' };
  return { data: data.user, error: null };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function getUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

// ─── Admin operations ─────────────────────────────────────────────────────────

export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return data?.role === 'admin';
}

export async function listAllProfiles(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function adminSetAccountStatus(
  targetId: string,
  newStatus: AccountStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_set_account_status', {
    target_id: targetId,
    new_status: newStatus,
  });
  return { error: error?.message ?? null };
}

export async function adminDeleteUser(
  targetId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_delete_user', { target_id: targetId });
  return { error: error?.message ?? null };
}

// ─── Password actions (vía Edge Function admin-password-actions) ──────────────
// La Edge Function valida que el caller es admin y usa service_role
// internamente. El service_role nunca toca el navegador.

type PasswordActionResult =
  | { ok: true; link?: string }
  | { ok: false; error: string };

async function callPasswordAction(body: {
  action: 'generate_link' | 'set_password';
  target_id: string;
  new_password?: string;
  redirect_to?: string;
}): Promise<PasswordActionResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; link?: string; error?: string }>(
    'admin-password-actions',
    { body },
  );
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok !== true) {
    return { ok: false, error: data?.error ?? 'unknown_error' };
  }
  return { ok: true, link: data.link };
}

export function adminSetUserPassword(targetId: string, newPassword: string) {
  return callPasswordAction({
    action: 'set_password',
    target_id: targetId,
    new_password: newPassword,
  });
}

export function adminGenerateRecoveryLink(targetId: string) {
  const redirectTo = typeof window !== 'undefined'
    ? `${window.location.origin}/reset-password`
    : undefined;
  return callPasswordAction({
    action: 'generate_link',
    target_id: targetId,
    redirect_to: redirectTo,
  });
}

