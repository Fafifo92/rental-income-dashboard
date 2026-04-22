import { supabase } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

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

export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured()) return { data: null, error: 'DEMO_MODE' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { data: null, error: error.message };
  if (!data.session) return { data: null, error: 'No se pudo iniciar sesión' };
  return { data: data.session, error: null };
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
