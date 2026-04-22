import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { getSession, isSupabaseConfigured } from '@/services/auth';

interface Props {
  children: ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const [status, setStatus] = useState<'checking' | 'authed' | 'redirect'>('checking');

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus('authed'); // demo mode — no auth required
      return;
    }
    getSession().then(session => {
      if (session) {
        setStatus('authed');
      } else {
        setStatus('redirect');
        window.location.href = '/login';
      }
    });
  }, []);

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full"
        />
      </div>
    );
  }

  if (status === 'redirect') return null;

  return <>{children}</>;
}
