import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import {
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  computeBalances,
  listUnassignedMoney,
  getBankAccountTransactions,
  BANK_TX_KIND_META,
  type BankAccountBalance,
  type UnassignedMoney,
  type BankTransaction,
} from '@/services/bankAccounts';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import MoneyInput from '@/components/MoneyInput';

const BANKS = ['Bancolombia', 'Caja Social', 'Davivienda', 'BBVA', 'Scotiabank Colpatria', 'Banco de Bogotá', 'Nequi', 'Daviplata', 'Otro'];

type FormState = {
  name: string;
  bank: string;
  account_type: 'ahorros' | 'corriente' | 'billetera' | 'crédito' | 'otro';
  account_number_mask: string;
  currency: string;
  opening_balance: number | null;
  notes: string;
  credit_limit: number | null;
};

const EMPTY_FORM: FormState = {
  name: '',
  bank: '',
  account_type: 'ahorros',
  account_number_mask: '',
  currency: 'COP',
  opening_balance: 0,
  notes: '',
  credit_limit: null,
};

export default function BankAccountsClient() {
  const authStatus = useAuth(true);
  const [balances, setBalances] = useState<BankAccountBalance[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedMoney | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BankAccountRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyAccount, setHistoryAccount] = useState<BankAccountRow | null>(null);

  const load = async () => {
    setLoading(true);
    const [res, unassignedRes] = await Promise.all([
      computeBalances(),
      listUnassignedMoney(),
    ]);
    if (!res.error) setBalances(res.data ?? []);
    if (!unassignedRes.error) setUnassigned(unassignedRes.data);
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
      account_type: acc.is_credit ? 'crédito' : (acc.account_type ?? 'ahorros'),
      account_number_mask: acc.account_number_mask ?? '',
      currency: acc.currency,
      opening_balance: Number(acc.opening_balance) || 0,
      notes: acc.notes ?? '',
      credit_limit: acc.credit_limit != null ? Number(acc.credit_limit) : null,
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
      opening_balance: form.opening_balance ?? 0,
      notes: form.notes || null,
      is_active: true,
      is_credit: form.account_type === 'crédito',
      credit_limit: form.account_type === 'crédito' ? form.credit_limit : null,
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

      {/* Bloque 4: dinero sin asignar */}
      {unassigned && (unassigned.unassignedPayouts.length > 0 || unassigned.unassignedPaidExpenses.length > 0) && (
        <div className="mb-6 p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💸</span>
            <div className="flex-1">
              <h3 className="font-bold text-amber-900">Dinero sin asignar a cuenta bancaria</h3>
              <p className="text-sm text-amber-800 mt-1">
                Hay flujos de dinero registrados sin indicar en qué cuenta cayó/salió. Asígnalos para que los saldos cuadren.
              </p>
              {unassigned.unassignedPayouts.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                    Payouts de reservas pendientes ({unassigned.unassignedPayouts.length}) — total {formatCurrency(unassigned.totalPayouts)}
                  </p>
                  <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                    {unassigned.unassignedPayouts.slice(0, 8).map(p => (
                      <li key={p.id} className="text-xs text-amber-900 flex justify-between gap-2">
                        <a href={`/bookings?focus=${p.id}`} className="underline truncate">
                          {p.confirmation_code} · {p.guest_name}
                        </a>
                        <span className="font-mono whitespace-nowrap">{formatCurrency(p.net_payout)}</span>
                      </li>
                    ))}
                    {unassigned.unassignedPayouts.length > 8 && (
                      <li className="text-xs text-amber-700 italic">…y {unassigned.unassignedPayouts.length - 8} más</li>
                    )}
                  </ul>
                </div>
              )}
              {unassigned.unassignedPaidExpenses.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                    Gastos pagados ({unassigned.unassignedPaidExpenses.length}) — total {formatCurrency(unassigned.totalPaidExpenses)}
                  </p>
                  <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                    {unassigned.unassignedPaidExpenses.slice(0, 8).map(e => (
                      <li key={e.id} className="text-xs text-amber-900 flex justify-between gap-2">
                        <a href={`/expenses?focus=${e.id}`} className="underline truncate">
                          {e.description ?? e.category} · {e.date}
                        </a>
                        <span className="font-mono whitespace-nowrap">{formatCurrency(e.amount)}</span>
                      </li>
                    ))}
                    {unassigned.unassignedPaidExpenses.length > 8 && (
                      <li className="text-xs text-amber-700 italic">…y {unassigned.unassignedPaidExpenses.length - 8} más</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
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
                    <h3 className="font-bold text-slate-800 truncate flex items-center gap-2">
                      {account.name}
                      {account.is_credit ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded">CRÉDITO</span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">DÉBITO</span>
                      )}
                    </h3>
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
                  <p className="text-xs uppercase tracking-wider text-slate-400">
                    {account.is_credit ? 'Saldo (deuda si negativo)' : 'Saldo actual'}
                  </p>
                  <p className={`text-2xl font-extrabold mt-1 ${currentBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatCurrency(currentBalance)}
                  </p>
                  {account.is_credit && account.credit_limit != null && (
                    <p className="text-xs text-slate-500 mt-1">
                      Cupo disponible: <span className="font-semibold">{formatCurrency(Number(account.credit_limit) + currentBalance)}</span> / {formatCurrency(Number(account.credit_limit))}
                    </p>
                  )}
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
                    onClick={() => setHistoryAccount(account)}
                    className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    📋 Historial
                  </button>
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
                      onChange={e => setForm({ ...form, account_type: e.target.value as FormState['account_type'], credit_limit: e.target.value !== 'crédito' ? null : form.credit_limit })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="ahorros">Ahorros</option>
                      <option value="corriente">Corriente</option>
                      <option value="billetera">Billetera</option>
                      <option value="crédito">Crédito</option>
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
                  <MoneyInput
                    value={form.opening_balance}
                    onChange={(v) => setForm({ ...form, opening_balance: v })}
                    allowNegative
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {form.account_type === 'crédito'
                      ? 'Deuda actual al registrar la tarjeta. Pon un valor negativo si ya tienes saldo usado.'
                      : 'Saldo actual cuando registras esta cuenta. Los payouts y gastos futuros se suman/restan.'}
                  </p>
                </div>

                {/* Cupo de crédito: solo visible cuando el tipo es Crédito */}
                {form.account_type === 'crédito' && (
                  <div className="border border-rose-200 rounded-lg p-3 bg-rose-50">
                    <p className="text-[11px] text-rose-600 mb-2">
                      Las cuentas de crédito permiten quedar en saldo negativo (deuda).
                    </p>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Cupo total (opcional)</label>
                    <MoneyInput
                      value={form.credit_limit}
                      onChange={(v) => setForm({ ...form, credit_limit: v })}
                      placeholder="2.000.000"
                    />
                  </div>
                )}

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

      <AnimatePresence>
        {historyAccount && (
          <BankHistoryModal
            account={historyAccount}
            onClose={() => setHistoryAccount(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function BankHistoryModal({
  account, onClose,
}: { account: BankAccountRow; onClose: () => void }): JSX.Element {
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const backdrop = makeBackdropHandlers(onClose);

  useEffect(() => {
    setLoading(true);
    getBankAccountTransactions(account.id).then(res => {
      setTxs(res.data ?? []);
      setLoading(false);
    });
  }, [account.id]);

  const filtered = txs.filter(t => {
    if (filter === 'all') return true;
    const meta = BANK_TX_KIND_META[t.kind];
    return meta.tone === filter;
  });

  const totalIn = txs.filter(t => t.amount > 0 && t.kind !== 'opening').reduce((s, t) => s + t.amount, 0);
  const totalOut = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const opening = txs.find(t => t.kind === 'opening')?.amount ?? 0;
  const balance = opening + totalIn - totalOut;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="p-5 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">📋 Historial de transacciones</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {account.name} · {account.bank ?? 'Sin banco'} {account.is_credit ? '· CRÉDITO' : '· DÉBITO'}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-xs">
            <div className="bg-slate-50 rounded-lg p-2">
              <div className="text-slate-500">Apertura</div>
              <div className="font-bold text-slate-800">{formatCurrency(opening)}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-2">
              <div className="text-emerald-600">Ingresos</div>
              <div className="font-bold text-emerald-700">+{formatCurrency(totalIn)}</div>
            </div>
            <div className="bg-rose-50 rounded-lg p-2">
              <div className="text-rose-600">Egresos</div>
              <div className="font-bold text-rose-700">−{formatCurrency(totalOut)}</div>
            </div>
            <div className={`rounded-lg p-2 ${balance >= 0 ? 'bg-blue-50' : 'bg-amber-50'}`}>
              <div className={balance >= 0 ? 'text-blue-600' : 'text-amber-600'}>Saldo</div>
              <div className={`font-bold ${balance >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
                {formatCurrency(balance)}
              </div>
            </div>
          </div>

          <div className="flex gap-1 mt-3">
            {(['all', 'in', 'out'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full ${
                  filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f === 'all' ? 'Todo' : f === 'in' ? 'Ingresos' : 'Egresos'}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Sin movimientos</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(t => {
                const meta = BANK_TX_KIND_META[t.kind];
                const isIn = t.amount > 0;
                return (
                  <li key={t.id} className="py-3 flex items-start gap-3">
                    <div className="text-2xl">{meta.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
                        {t.booking_code && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {t.booking_code}
                          </span>
                        )}
                        {t.category && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {t.category}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {t.date}{t.property_name ? ` · ${t.property_name}` : ''}
                      </p>
                    </div>
                    <div className={`text-sm font-bold whitespace-nowrap ${
                      t.kind === 'opening' ? 'text-slate-600' :
                      isIn ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {t.kind === 'opening' ? '' : isIn ? '+' : '−'}{formatCurrency(Math.abs(t.amount))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
