import { useEffect, useState } from 'react';
import { getSession, isSupabaseConfigured } from '@/services/auth';

export type AuthStatus = 'checking' | 'authed' | 'demo';

export function useAuth(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus('demo');
      return;
    }
    getSession().then(session => {
      // No session → demo mode (user can log in from the nav)
      setStatus(session ? 'authed' : 'demo');
    });
  }, []);

  return status;
}
