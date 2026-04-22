import { useEffect, useState } from 'react';
import { getSession, isSupabaseConfigured } from '@/services/auth';

export type AuthStatus = 'checking' | 'authed' | 'demo';

export function useAuth(requireAuth = true): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    // No env vars → always demo mode (local dev / public demo)
    if (!isSupabaseConfigured()) {
      setStatus('demo');
      return;
    }
    getSession().then(session => {
      if (session) {
        setStatus('authed');
      } else if (requireAuth) {
        // Supabase is configured but user is not logged in → go to login
        window.location.href = '/login';
      } else {
        setStatus('demo');
      }
    });
  }, [requireAuth]);

  return status;
}
