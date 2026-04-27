'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listVendors, createVendor, type Vendor } from '@/services/vendors';
import { listBankAccounts } from '@/services/bankAccounts';
import {
  listAllCleanings,
  updateCleaning,
  computeCleanerBalances,
  payoutCleanerConsolidated,
  type BookingCleaning,
} from '@/services/cleanings';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { useBackdropClose } from '@/lib/useBackdropClose';

export default function AseoClient(): JSX.Element {
  const [cleaners, setCleaners] = useState<Vendor[]>([]);
  const [cleanings, setCleanings] = useState<BookingCleaning[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({ name: '', contact: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Vendor | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, cRes, bRes] = await Promise.all([
      listVendors('cleaner'),
      listAllCleanings(),
      listBankAccounts(),
    ]);
    if (vRes.data) setCleaners(vRes.data);
    if (cRes.data) setCleanings(cRes.data);
    if (bRes.data) setBanks(bRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const balances = useMemo(() => computeCleanerBalances(cleanings), [cleanings]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio.'); return; }
    setSaving(true);
    const res = await createVendor({
      name: form.name.trim(),
      kind: 'cleaner',
      contact: form.contact.trim() || null,
      notes: null,
      active: true,
      category: null,
      default_amount: null,
      day_of_month: null,
      is_variable: false,
    });
    setSaving(false);
    if (res.error) { setErr(res.error); return; }
    setNewModal(false);
    setForm({ name: '', contact: '' });
    setErr(null);
    await load();
  };

  const markPaid = async (c: BookingCleaning) => {
    const today = new Date().toISOString().split('T')[0];
    await updateCleaning(c.id, { status: 'paid', paid_date: today });
    await load();
  };

  const totalOwed = useMemo(
    () => Array.from(balances.values()).reduce((s, b) => s + b.total_owed, 0),
    [balances],
  );
  const totalPending = useMemo(
    () => cleanings.filter(c => c.status !== 'paid').length,
    [cleanings],
  );
  const totalDone = useMemo(
    () => cleanings.filter(c => c.status === 'done' && !c.paid_date).length,
    [cleanings],
  );

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">🧹 Aseo</h1>
          <p className="text-sm text-slate-500">Personal, saldos adeudados y liquidación semanal.</p>
        </div>
        <button
          onClick={() => setNewModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm inline-flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Nueva persona
        </button>
      </header>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Personal activo" value={cleaners.filter(c => c.active).length.toString()} tone="slate" />
        <KPICard label="Aseos pendientes" value={totalPending.toString()} tone="amber" />
        <KPICard label="Hechos sin pagar" value={totalDone.toString()} tone="blue" />
        <KPICard label="Total adeudado" value={formatCurrency(totalOwed)} tone="red" highlight />
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando…</p>
      ) : cleaners.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">🧹</div>
          <p className="text-slate-600 font-medium mb-1">Aún no has agregado personal de aseo</p>
          <p className="text-xs text-slate-500 mb-4">Asigna trabajadoras de limpieza para llevar cuenta de lo que les debes.</p>
          <button onClick={() => setNewModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            Agregar primera persona
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cleaners.map(c => {
            const b = balances.get(c.id);
            const owed = b?.total_owed ?? 0;
            const canPay = (b?.done_unpaid_count ?? 0) > 0;
            return (
              <motion.div
                key={c.id}
                whileHover={{ y: -2 }}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                  owed > 0 ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <div className={`px-5 py-4 border-b ${owed > 0 ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-white ${
                        owed > 0 ? 'bg-red-500' : 'bg-slate-400'
                      }`}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 leading-tight">{c.name}</div>
                        <div className="text-xs text-slate-500">{c.contact ?? 'sin contacto'}</div>
                      </div>
                    </div>
                    {!c.active && <span className="text-xs text-slate-400">inactivo</span>}
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-amber-50 rounded-lg py-2">
                      <div className="text-lg font-bold text-amber-700">{b?.pending_count ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Pendientes</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg py-2">
                      <div className="text-lg font-bold text-blue-700">{b?.done_unpaid_count ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold">Hechos s/pagar</div>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-2 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 uppercase">Total adeudado</span>
                    <span className={`text-xl font-bold ${owed > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {formatCurrency(owed)}
                    </span>
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex gap-2">
                  <button
                    onClick={() => setDetail(c)}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                  >
                    Ver historial
                  </button>
                  <button
                    onClick={() => setPayoutTarget(c)}
                    disabled={!canPay}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    title={canPay ? 'Consolidar pago y generar gasto' : 'No hay aseos hechos sin pagar'}
                  >
                    💸 Liquidar
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {newModal && (
          <NewCleanerModal
            form={form}
            setForm={setForm}
            saving={saving}
            err={err}
            onClose={() => setNewModal(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <DetailModal
            cleaner={detail}
            cleanings={cleanings.filter(c => c.cleaner_id === detail.id)}
            onClose={() => setDetail(null)}
            onMarkPaid={markPaid}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payoutTarget && (
          <PayoutModal
            cleaner={payoutTarget}
            balance={balances.get(payoutTarget.id)}
            banks={banks}
            onClose={() => setPayoutTarget(null)}
            onConfirm={async (args) => {
              const res = await payoutCleanerConsolidated({
                cleanerId: payoutTarget.id,
                cleanerName: payoutTarget.name,
                ...args,
              });
              if (res.error) return res.error;
              setPayoutTarget(null);
              await load();
              return null;
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function KPICard({ label, value, tone, highlight }: { label: string; value: string; tone: 'slate'|'amber'|'blue'|'red'; highlight?: boolean }) {
  const color = {
    slate: 'text-slate-800',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    red: 'text-red-600',
  }[tone];
  return (
    <div className={`bg-white rounded-xl p-4 border ${highlight ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'}`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl lg:text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function NewCleanerModal({
  form, setForm, saving, err, onClose, onCreate,
}: {
  form: { name: string; contact: string };
  setForm: (f: { name: string; contact: string }) => void;
  saving: boolean;
  err: string | null;
  onClose: () => void;
  onCreate: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">Nueva persona de aseo</h3>
        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text"
              value={form.contact}
              onChange={e => setForm({ ...form, contact: e.target.value })}
              placeholder="Teléfono / WhatsApp"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button
            onClick={onCreate}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailModal({
  cleaner, cleanings, onClose, onMarkPaid,
}: {
  cleaner: Vendor;
  cleanings: BookingCleaning[];
  onClose: () => void;
  onMarkPaid: (c: BookingCleaning) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-xl font-bold text-slate-800">🧹 {cleaner.name}</h3>
          <p className="text-sm text-slate-500">Historial de aseos ({cleanings.length})</p>
        </div>
        <div className="p-6">
          {cleanings.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Aún no hay aseos registrados para esta persona.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left py-2">Estado</th>
                  <th className="text-left py-2">Fecha hecho</th>
                  <th className="text-left py-2">Pagado</th>
                  <th className="text-right py-2">Tarifa</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cleanings.map(c => (
                  <tr key={c.id}>
                    <td className="py-2">
                      {c.status === 'paid' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Pagado</span>}
                      {c.status === 'done' && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Hecho</span>}
                      {c.status === 'pending' && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Pendiente</span>}
                    </td>
                    <td className="py-2 text-slate-500">{c.done_date ?? '—'}</td>
                    <td className="py-2 text-slate-500">{c.paid_date ?? '—'}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(c.fee)}</td>
                    <td className="py-2 text-right">
                      {c.status === 'done' && (
                        <button
                          onClick={() => onMarkPaid(c)}
                          className="text-emerald-600 text-xs font-semibold hover:underline"
                        >
                          Marcar pagado
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PayoutModal({
  cleaner, balance, banks, onClose, onConfirm,
}: {
  cleaner: Vendor;
  balance: ReturnType<typeof computeCleanerBalances> extends Map<string, infer V> ? V | undefined : never;
  banks: BankAccountRow[];
  onClose: () => void;
  onConfirm: (args: { paidDate: string; bankAccountId: string | null; includePending: boolean }) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().split('T')[0]);
  const [bankId, setBankId] = useState<string>('');
  const [includePending, setIncludePending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = (balance?.done_unpaid_amount ?? 0) + (includePending ? (balance?.pending_amount ?? 0) : 0);
  const count = (balance?.done_unpaid_count ?? 0) + (includePending ? (balance?.pending_count ?? 0) : 0);

  const submit = async () => {
    setWorking(true);
    setError(null);
    const err = await onConfirm({ paidDate, bankAccountId: bankId || null, includePending });
    setWorking(false);
    if (err) setError(err);
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b">
          <h3 className="text-xl font-bold text-slate-800">💸 Liquidar a {cleaner.name}</h3>
          <p className="text-xs text-slate-500 mt-1">Consolida todos los aseos pendientes en un único gasto.</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-xs text-emerald-700 font-semibold uppercase tracking-wide">A pagar ahora</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(amount)}</div>
            <div className="text-xs text-emerald-700 mt-0.5">{count} aseos serán marcados como pagados</div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includePending}
              onChange={e => setIncludePending(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Incluir aseos <strong>pendientes</strong> ({balance?.pending_count ?? 0} · {formatCurrency(balance?.pending_amount ?? 0)})
              <div className="text-xs text-slate-500">Normalmente solo se paga lo ya hecho. Actívalo si vas a pagar por adelantado.</div>
            </span>
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de pago</label>
            <input
              type="date"
              value={paidDate}
              onChange={e => setPaidDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta bancaria (opcional)</label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">— Sin especificar —</option>
              {banks.map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.bank ? ` · ${b.bank}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
            Se creará un gasto <strong>"Pago consolidado aseo – {cleaner.name}"</strong> con categoría{' '}
            <code className="bg-white px-1 rounded">cleaning</code> y status{' '}
            <code className="bg-white px-1 rounded">paid</code>. Los aseos involucrados quedarán vinculados al pago.
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={working || amount === 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {working ? 'Procesando…' : `Pagar ${formatCurrency(amount)}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
