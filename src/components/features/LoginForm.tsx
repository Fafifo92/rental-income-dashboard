'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { signIn, signUp, signOut, isSupabaseConfigured } from '@/services/auth';

type Mode = 'login' | 'signup' | 'admin';

export default function LoginForm() {
  const [mode, setMode]           = useState<Mode>('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  const resetMessages = () => { setError(null); setSuccess(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    if (mode === 'signup') {
      const result = await signUp(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('✅ Cuenta creada. Debe ser aprobada por el administrador antes de iniciar sesión.');
        setMode('login');
      }
      setLoading(false);
      return;
    }

    const outcome = await signIn(email, password);

    if (outcome.kind === 'pending') {
      setError('Tu cuenta está pendiente de aprobación por el administrador.');
      setLoading(false);
      return;
    }
    if (outcome.kind === 'suspended') {
      setError('Tu cuenta ha sido suspendida. Contacta al administrador.');
      setLoading(false);
      return;
    }
    if (outcome.kind === 'error') {
      setError(outcome.message);
      setLoading(false);
      return;
    }

    if (mode === 'admin') {
      if (outcome.profile.role !== 'admin') {
        await signOut();
        setError('Credenciales de administrador inválidas.');
        setLoading(false);
        return;
      }
      window.location.href = '/admin';
      return;
    }

    window.location.href = '/dashboard';
  };

  const enterDemo = () => {
    window.location.href = '/dashboard';
  };

  const isAdmin = mode === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-blue-400 rounded-full opacity-20"
            style={{ left: `${(i * 5.2) % 100}%`, top: `${(i * 7.3) % 100}%` }}
            animate={{ opacity: [0.1, 0.4, 0.1], scale: [1, 1.8, 1] }}
            transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.3 }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-6 text-center border-b border-white/10">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg ${
                isAdmin ? 'bg-amber-500 shadow-amber-500/30' : 'bg-blue-500 shadow-blue-500/30'
              }`}
            >
              {isAdmin ? <ShieldCheck className="w-7 h-7" /> : 'A'}
            </motion.div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              {isAdmin ? 'Acceso administrador' : 'STR Analytics'}
            </h1>
            <p className={`text-sm mt-1 ${isAdmin ? 'text-amber-200' : 'text-blue-200'}`}>
              {isAdmin ? 'Solo personal autorizado' : 'Gestión inteligente de rentas cortas'}
            </p>
          </div>

          {!isAdmin && (
            <div className="flex mx-8 mt-6 mb-2 bg-white/5 rounded-xl p-1">
              {(['login', 'signup'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); resetMessages(); }}
                  className="relative flex-1 py-2 text-sm font-medium rounded-lg transition-colors"
                >
                  {mode === m && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-0 bg-white/15 rounded-lg"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className={`relative z-10 ${mode === m ? 'text-white' : 'text-white/50'}`}>
                    {m === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="px-8 pb-8 pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1.5">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="tu@correo.com"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1.5">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
              />
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-lg px-3 py-2"
                >
                  {error === 'DEMO_MODE' ? 'Supabase no configurado. Usa el modo demo.' : error}
                </motion.div>
              )}
              {success && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-green-300 text-sm bg-green-500/10 border border-green-400/20 rounded-lg px-3 py-2"
                >
                  {success}
                </motion.div>
              )}
            </AnimatePresence>

            {configured && (
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={`w-full py-3 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors shadow-lg flex items-center justify-center gap-2 ${
                  isAdmin
                    ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/20'
                    : 'bg-blue-500 hover:bg-blue-400 shadow-blue-500/20'
                }`}
              >
                {loading ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block"
                  />
                ) : null}
                {mode === 'login' ? 'Iniciar sesión' : mode === 'signup' ? 'Crear cuenta' : 'Entrar al panel'}
              </motion.button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => { setMode('login'); resetMessages(); }}
                className="w-full text-center text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                ← Volver al login normal
              </button>
            )}

            {!isAdmin && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-white/30 text-xs">o</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                <motion.button
                  type="button"
                  onClick={enterDemo}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 font-medium rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <span>🚀</span>
                  {configured ? 'Entrar en modo demo' : 'Continuar en modo demo (sin cuenta)'}
                </motion.button>
              </>
            )}

            {!configured && (
              <p className="text-center text-white/30 text-xs">
                Configura <code className="text-blue-300">PUBLIC_SUPABASE_URL</code> en <code className="text-blue-300">.env</code> para activar auth real.
              </p>
            )}
          </form>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          STR Analytics — Plataforma de gestión financiera de STR
        </p>
      </motion.div>

      {!isAdmin && configured && (
        <button
          type="button"
          onClick={() => { setMode('admin'); resetMessages(); setEmail(''); setPassword(''); }}
          aria-label="Acceso administrador"
          title="Acceso administrador"
          className="fixed bottom-4 right-4 z-50 w-10 h-10 rounded-full bg-white/5 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/40 backdrop-blur-md flex items-center justify-center text-white/40 hover:text-amber-300 transition-all"
        >
          <ShieldCheck className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
