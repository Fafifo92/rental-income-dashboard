'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export default function ResetPasswordClient() {
  const [ready, setReady]     = useState(false);
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  // Cuando el usuario llega vía link de recuperación, Supabase coloca
  // tokens en el hash. detectSessionInUrl=true (default) los procesa
  // automáticamente. Solo esperamos a que la sesión esté establecida.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setReady(true);
      } else {
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            setReady(true);
          }
        });
        return () => sub.subscription.unsubscribe();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener mínimo 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => { window.location.href = '/login'; }, 2500);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-8 pt-8 pb-6 text-center border-b border-white/10">
          <div className="w-14 h-14 bg-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-500/30">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">Nueva contraseña</h1>
          <p className="text-blue-200 text-sm mt-1">Define tu contraseña para acceder</p>
        </div>

        {!ready && !success && (
          <div className="px-8 py-12 text-center">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin mx-auto mb-3" />
            <p className="text-white/60 text-sm">Verificando link de recuperación...</p>
          </div>
        )}

        {success && (
          <div className="px-8 py-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h2 className="text-white font-bold mb-1">Contraseña actualizada</h2>
            <p className="text-white/60 text-sm">Redirigiendo al login...</p>
          </div>
        )}

        {ready && !success && (
          <form onSubmit={handleSubmit} className="px-8 pb-8 pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1.5">Nueva contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1.5">Confirmar contraseña</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>

            {error && (
              <div className="text-red-300 text-sm bg-red-500/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Actualizar contraseña
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
