import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import {
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  computeBalances,
  type BankAccountBalance,
} from '@/services/bankAccounts';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

const BANKS = ['Bancolombia', 'Caja Social', 'Davivienda', 'BBVA', 'Scotiabank Colpatria', 'Banco de Bogotá', 'Nequi', 'Daviplata', 'Otro'];

type FormState = {
  name: string;
  bank: string;
  account_type: 'ahorros' | 'corriente' | 'billetera' | 'otro';
  account_number_mask: string;
  currency: string;
  opening_balance: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  bank: '',
  account_type: 'ahorros',
  account_number_mask: '',
  currency: 'COP',
  opening_balance: '0',
  notes: '',
};

export default function BankAccountsClient() {
  const authStatus = useAuth(true);
  const [balances, setBalances] = useState<BankAccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BankAccountRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await computeBalances();
    if (!res.error) setBalances(res.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authStatus === 'authed') load();
    else if (authStatus === 'demo') setLoading(false);
  }, [authStatus]);

  if (authStatus === 'checking' || loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (authStatus !== 'authed') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800">
        Las cuentas bancarias solo están disponibles con una cuenta autenticada.{' '}
        <a href="/login" className="underline font-semibold">Iniciar sesión</a>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (acc: BankAccountRow) => {
    setEditing(acc);
    setForm({
      name: acc.name,
      bank: acc.bank ?? '',
      account_type: acc.account_type ?? 'ahorros',
      account_number_mask: acc.account_number_mask ?? '',
      currency: acc.currency,
      opening_balance: String(acc.opening_balance),
      notes: acc.notes ?? '',
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      bank: form.bank || null,
      account_type: form.account_type,
      account_number_mask: form.account_number_mask || null,
      currency: form.currency,
      opening_balance: parseFloat(form.opening_balance) || 0,
      notes: form.notes || null,
      is_active: true,
    };
    const res = editing
      ? await updateBankAccount(editing.id, payload)
      : await createBankAccount(payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setShowModal(false);
    await load();
  };

  const handleToggleActive = async (acc: BankAccountRow) => {
    await updateBankAccount(acc.id, { is_active: !acc.is_active });
    await load();
  };

  const handleDelete = async (acc: BankAccountRow) => {
    if (!confirm(`¿Eliminar la cuenta "${acc.name}"? Esto no borra reservas o gastos asociados, solo se descontecta el vínculo.`)) return;
    const res = await deleteBankAccount(acc.id);
    if (res.error) { alert(res.error); return; }
    await load();
  };

  const totalBalance = balances
    .filter(b => b.account.is_active)
    .reduce((sum, b) => sum + b.currentBalance, 0);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6"
      >
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Cuentas Bancarias</h2>
          <p className="text-slate-500 mt-1">
            Gestiona dónde recibes los payouts y desde dónde pagas los gastos.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-sm"
        >
          + Nueva cuenta
        </button>
      </motion.div>

      {/* Saldo total */}
      {balances.length > 0 && (
        <div className="mb-6 p-5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl text-white">
          <p className="text-xs uppercase tracking-wider opacity-80">Saldo total (cuentas activas)</p>
          <p className="text-3xl font-extrabold mt-1">{formatCurrency(totalBalance)}</p>
          <p className="text-xs opacity-80 mt-2">
            {balances.filter(b => b.account.is_active).length} cuenta(s) activa(s) · {balances.length} total
          </p>
        </div>
      )}

      {balances.length === 0 ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <h3 className="text-lg font-bold text-slate-700 mb-2">Sin cuentas registradas</h3>
          <p className="text-slate-500 mb-6 max-w-sm mx-auto">
            Registra tus cuentas de Bancolombia, Caja Social u otras para controlar ingresos netos y pagos.
          </p>
          <button
            onClick={openCreate}
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 shadow-sm"
          >
            + Registrar primera cuenta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {balances.map(({ account, inflows, outflows, currentBalance }, i) => (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
                account.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className={`h-1 ${account.is_active ? 'bg-blue-500' : 'bg-slate-300'}`} />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 truncate">{account.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {account.bank ?? 'Sin banco'} · {account.account_type ?? '—'}
                      {account.account_number_mask && ` · ${account.account_number_mask}`}
                    </p>
                  </div>
                  {!account.is_active && (
                    <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full">
                      Inactiva
                    </span>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Saldo actual</p>
                  <p className={`text-2xl font-extrabold mt-1 ${currentBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatCurrency(currentBalance)}
                  </p>
                  <div className="flex justify-between text-xs mt-2 text-slate-500">
                    <span>Apertura: {formatCurrency(Number(account.opening_balance))}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-emerald-600">+ {formatCurrency(inflows)}</span>
                    <span className="text-red-600">− {formatCurrency(outflows)}</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => openEdit(account)}
                    className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleToggleActive(account)}
                    className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100"
                  >
                    {account.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => handleDelete(account)}
                    className="text-xs font-medium py-1.5 px-3 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            {...makeBackdropHandlers(() => { if (!saving) setShowModal(false); })}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                {editing ? 'Editar cuenta' : 'Nueva cuenta bancaria'}
              </h3>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Bancolombia Ahorros Personal"
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Banco</label>
                    <select
                      value={form.bank}
                      onChange={e => setForm({ ...form, bank: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">— Seleccionar</option>
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo</label>
                    <select
                      value={form.account_type}
                      onChange={e => setForm({ ...form, account_type: e.target.value as FormState['account_type'] })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="ahorros">Ahorros</option>
                      <option value="corriente">Corriente</option>
                      <option value="billetera">Billetera</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Últimos 4 dígitos</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={form.account_number_mask}
                      onChange={e => setForm({ ...form, account_number_mask: e.target.value })}
                      placeholder="***1234"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Moneda</label>
                    <select
                      value={form.currency}
                      onChange={e => setForm({ ...form, currency: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="COP">COP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Saldo inicial</label>
                  <input
                    type="number"
                    step="1000"
                    value={form.opening_balance}
                    onChange={e => setForm({ ...form, opening_balance: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Saldo actual cuando registras esta cuenta. Los payouts y gastos futuros se suman/restan.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Notas</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !form.name.trim()}
                    className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear cuenta'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
