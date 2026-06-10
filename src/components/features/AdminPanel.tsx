'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, CheckCircle2, XCircle, PauseCircle, PlayCircle, Trash2, Loader2, Key, Copy, Check } from 'lucide-react';
import {
  isCurrentUserAdmin,
  listAllProfiles,
  adminSetAccountStatus,
  adminDeleteUser,
  adminSetUserPassword,
  adminGenerateRecoveryLink,
  signOut,
} from '@/services/auth';
import type { ProfileRow, AccountStatus } from '@/types/database';

type Filter = 'all' | AccountStatus;

const STATUS_LABEL: Record<AccountStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  suspended: 'Suspendido',
};

const STATUS_STYLE: Record<AccountStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border border-amber-400/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30',
  suspended: 'bg-rose-500/15 text-rose-300 border border-rose-400/30',
};

export default function AdminPanel() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [profiles, setProfiles]     = useState<ProfileRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<Filter>('all');
  const [busyId, setBusyId]         = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<ProfileRow | null>(null);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    const ok = await isCurrentUserAdmin();
    setAuthorized(ok);
    if (!ok) { setLoading(false); return; }
    await refresh();
    setLoading(false);
  }

  async function refresh() {
    try {
      const rows = await listAllProfiles();
      setProfiles(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar usuarios');
    }
  }

  async function handleSetStatus(id: string, status: AccountStatus) {
    setBusyId(id);
    const { error: err } = await adminSetAccountStatus(id, status);
    if (err) setError(err); else await refresh();
    setBusyId(null);
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`¿Eliminar permanentemente la cuenta ${email}? Esto borra todos sus datos.`)) return;
    setBusyId(id);
    const { error: err } = await adminDeleteUser(id);
    if (err) setError(err); else await refresh();
    setBusyId(null);
  }

  async function handleLogout() {
    await signOut();
    window.location.href = '/login';
  }

  if (authorized === null || loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-rose-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white mb-2">Acceso denegado</h1>
          <p className="text-slate-400 text-sm mb-4">No tienes permisos de administrador.</p>
          <a href="/login" className="text-amber-400 hover:underline text-sm">Volver al login</a>
        </div>
      </div>
    );
  }

  const filtered = filter === 'all' ? profiles : profiles.filter(p => p.status === filter);
  const counts = {
    all:       profiles.length,
    pending:   profiles.filter(p => p.status === 'pending').length,
    approved:  profiles.filter(p => p.status === 'approved').length,
    suspended: profiles.filter(p => p.status === 'suspended').length,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Panel de administración</h1>
              <p className="text-xs text-slate-400">Gestión de cuentas operativas</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-rose-500/10 border border-rose-400/30 text-rose-300 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {(['all', 'pending', 'approved', 'suspended'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {f === 'all' ? 'Todas' : STATUS_LABEL[f]}{' '}
              <span className="opacity-60">({counts[f]})</span>
            </button>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Rol</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="text-left px-4 py-3 font-medium">Registro</th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-12 text-sm">Sin cuentas en este filtro.</td></tr>
              )}
              {filtered.map(p => {
                const busy = busyId === p.id;
                return (
                  <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium">{p.email}</td>
                    <td className="px-4 py-3 text-slate-300">{p.full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${p.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>
                        {p.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[p.status]}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(p.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-400 mr-2 self-center" />}
                        {p.status === 'pending' && (
                          <button
                            disabled={busy}
                            onClick={() => handleSetStatus(p.id, 'approved')}
                            title="Aprobar"
                            className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-30"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {p.status === 'approved' && p.role !== 'admin' && (
                          <button
                            disabled={busy}
                            onClick={() => handleSetStatus(p.id, 'suspended')}
                            title="Suspender"
                            className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded disabled:opacity-30"
                          >
                            <PauseCircle className="w-4 h-4" />
                          </button>
                        )}
                        {p.status === 'suspended' && (
                          <button
                            disabled={busy}
                            onClick={() => handleSetStatus(p.id, 'approved')}
                            title="Reactivar"
                            className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-30"
                          >
                            <PlayCircle className="w-4 h-4" />
                          </button>
                        )}
                        {p.role !== 'admin' && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => setPasswordTarget(p)}
                              title="Cambiar contraseña"
                              className="p-1.5 text-sky-400 hover:bg-sky-500/10 rounded disabled:opacity-30"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => handleDelete(p.id, p.email)}
                              title="Eliminar cuenta"
                              className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded disabled:opacity-30"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {passwordTarget && (
        <PasswordModal
          target={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

// ─── Password modal ─────────────────────────────────────────────────────────

type ModalMode = 'choose' | 'set' | 'link';

function PasswordModal({
  target,
  onClose,
  onError,
}: {
  target: ProfileRow;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<ModalMode>('choose');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSetPassword() {
    setLocalError(null);
    if (newPassword.length < 8) {
      setLocalError('Mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    const res = await adminSetUserPassword(target.id, newPassword);
    setBusy(false);
    if (!res.ok) {
      setLocalError(res.error);
      onError(res.error);
      return;
    }
    setSuccess('Contraseña actualizada correctamente.');
    setNewPassword('');
    setConfirmPassword('');
  }

  async function handleGenerateLink() {
    setLocalError(null);
    setBusy(true);
    const res = await adminGenerateRecoveryLink(target.id);
    setBusy(false);
    if (!res.ok) {
      setLocalError(res.error);
      onError(res.error);
      return;
    }
    setGeneratedLink(res.link ?? null);
  }

  async function copyLink() {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-white">Cambiar contraseña</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Cerrar"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="text-sm">
            <span className="text-slate-400">Cuenta:</span>{' '}
            <span className="text-white font-medium">{target.email}</span>
          </div>

          {mode === 'choose' && (
            <div className="space-y-2">
              <button
                onClick={() => setMode('link')}
                className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              >
                <div className="font-medium text-white text-sm">Generar link de recuperación</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Genera un link único con expiración. Tú lo copias y se lo envías al usuario.
                </div>
              </button>
              <button
                onClick={() => setMode('set')}
                className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              >
                <div className="font-medium text-white text-sm">Definir contraseña directamente</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Estableces una contraseña nueva y se la comunicas al usuario.
                </div>
              </button>
            </div>
          )}

          {mode === 'set' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nueva contraseña</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Confirmar</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              {success && (
                <div className="text-emerald-300 text-sm bg-emerald-500/10 border border-emerald-400/30 rounded px-3 py-2">
                  {success}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('choose')}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm"
                >
                  ← Volver
                </button>
                <button
                  onClick={handleSetPassword}
                  disabled={busy}
                  className="flex-1 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-medium rounded-lg text-sm flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Actualizar
                </button>
              </div>
            </div>
          )}

          {mode === 'link' && (
            <div className="space-y-3">
              {!generatedLink ? (
                <>
                  <p className="text-sm text-slate-300">
                    Se generará un link de recuperación de <span className="font-medium">un solo uso</span> que
                    expira en <span className="font-medium">15 minutos</span>. Cópialo y compártelo
                    con <span className="font-medium">{target.email}</span> por el canal que prefieras.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMode('choose')}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm"
                    >
                      ← Volver
                    </button>
                    <button
                      onClick={handleGenerateLink}
                      disabled={busy}
                      className="flex-1 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-medium rounded-lg text-sm flex items-center justify-center gap-2"
                    >
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      Generar link
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-emerald-300 text-sm bg-emerald-500/10 border border-emerald-400/30 rounded px-3 py-2">
                    Link generado. Cópialo y envíalo al usuario.
                  </div>
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 break-all text-xs text-slate-200 font-mono">
                    {generatedLink}
                  </div>
                  <button
                    onClick={copyLink}
                    className="w-full py-2 bg-sky-500 hover:bg-sky-400 text-white font-medium rounded-lg text-sm flex items-center justify-center gap-2"
                  >
                    {copied ? <><Check className="w-4 h-4" /> ¡Copiado!</> : <><Copy className="w-4 h-4" /> Copiar link</>}
                  </button>
                </>
              )}
            </div>
          )}

          {localError && (
            <div className="text-rose-300 text-sm bg-rose-500/10 border border-rose-400/30 rounded px-3 py-2">
              {localError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
