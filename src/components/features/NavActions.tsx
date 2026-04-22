import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getUser, signOut, isSupabaseConfigured } from '@/services/auth';

export default function NavActions() {
  const [email, setEmail]           = useState<string | null>(null);
  const [showMenu, setShowMenu]     = useState(false);
  const [isDemo, setIsDemo]         = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsDemo(true);
      return;
    }
    getUser().then(user => setEmail(user?.email ?? null));
  }, []);

  const handleLogout = async () => {
    await signOut();
    window.location.href = '/login';
  };

  if (isDemo) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full font-semibold border border-amber-200">
          Modo demo
        </span>
        <a
          href="/login"
          className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          Iniciar sesión →
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu(v => !v)}
        className="flex items-center gap-2 focus:outline-none group"
        aria-label="Menú de usuario"
      >
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm group-hover:ring-2 group-hover:ring-blue-300 transition">
          {email ? email[0].toUpperCase() : '?'}
        </div>
        <span className="hidden md:block text-sm font-medium text-slate-600 max-w-[140px] truncate">
          {email ?? 'Usuario'}
        </span>
      </button>

      <AnimatePresence>
        {showMenu && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-20 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-2"
            >
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-xs text-slate-400">Sesión activa</p>
                <p className="text-sm font-medium text-slate-700 truncate">{email}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <span>🚪</span> Cerrar sesión
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
