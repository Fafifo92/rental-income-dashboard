import { useEffect, useState } from 'react';
import { getSession, isSupabaseConfigured } from '@/services/auth';

export type AuthStatus = 'checking' | 'authed' | 'demo';

export function useAuth(requireAuth = true): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured()) {
      setStatus('demo');
      return;
    }
    getSession().then(session => {
      if (cancelled) return;
      if (session) {
        setStatus('authed');
      } else if (requireAuth) {
        window.location.href = '/login';
      } else {
        setStatus('demo');
      }
    }).catch(() => { if (!cancelled) setStatus('demo'); });
    return () => { cancelled = true; };
  }, [requireAuth]);

  return status;
}
