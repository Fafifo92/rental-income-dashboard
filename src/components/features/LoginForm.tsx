'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signIn, signUp, isSupabaseConfigured } from '@/services/auth';

type Mode = 'login' | 'signup';

export default function LoginForm() {
  const [mode, setMode]           = useState<Mode>('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === 'login') {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        window.location.href = '/dashboard';
      }
    } else {
      const result = await signUp(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('✅ Cuenta creada. Revisa tu correo para confirmar.');
        setMode('login');
      }
    }
    setLoading(false);
  };

  const enterDemo = () => {
    window.location.href = '/dashboard';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      {/* Background pattern */}
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
        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center border-b border-white/10">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}
              className="w-14 h-14 bg-blue-500 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg shadow-blue-500/30"
            >
              A
            </motion.div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">STR Analytics</h1>
            <p className="text-blue-200 text-sm mt-1">Gestión inteligente de rentas cortas</p>
          </div>

          {/* Mode tabs */}
          <div className="flex mx-8 mt-6 mb-2 bg-white/5 rounded-xl p-1">
            {(['login', 'signup'] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
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

          {/* Form */}
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

            {/* Error / Success messages */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-lg px-3 py-2"
                >
                  {error === 'DEMO_MODE'
                    ? 'Supabase no configurado. Usa el modo demo.'
                    : error}
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

            {/* Submit */}
            {configured && (
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="w-full py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block"
                  />
                ) : null}
                {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
              </motion.button>
            )}

            {/* Demo divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/30 text-xs">o</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Demo button */}
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

            {!configured && (
              <p className="text-center text-white/30 text-xs">
                Configura <code className="text-blue-300">PUBLIC_SUPABASE_URL</code> en <code className="text-blue-300">.env</code> para activar auth real.
              </p>
            )}
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-white/20 text-xs mt-6">
          STR Analytics — Plataforma de gestión financiera de STR
        </p>
      </motion.div>
    </div>
  );
}
