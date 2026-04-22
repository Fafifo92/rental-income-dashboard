import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ExpensesList from './ExpensesList';
import ExpenseModal from './ExpenseModal';
import FilterBar from './FilterBar';
import {
  listExpenses,
  createExpense,
  deleteExpense,
  type ExpenseFilters,
} from '@/services/expenses';
import type { Expense } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';

// Shown while Supabase isn't connected yet
const DEMO_EXPENSES: Expense[] = [
  { id: '1', property_id: 'demo', category: 'Limpieza', type: 'variable', amount: 150000, date: '2024-03-01', description: 'Limpieza post-huésped', status: 'paid' },
  { id: '2', property_id: 'demo', category: 'Internet', type: 'fixed', amount: 89000, date: '2024-03-05', description: null, status: 'paid' },
  { id: '3', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed', amount: 320000, date: '2024-03-10', description: 'Agua y luz', status: 'pending' },
  { id: '4', property_id: 'demo', category: 'Mantenimiento', type: 'variable', amount: 450000, date: '2024-03-12', description: 'Reparación de grifo', status: 'partial' },
  { id: '5', property_id: 'demo', category: 'Lavandería', type: 'variable', amount: 80000, date: '2024-03-15', description: null, status: 'paid' },
  { id: '6', property_id: 'demo', category: 'Administración', type: 'fixed', amount: 200000, date: '2024-03-20', description: 'Comisión plataforma', status: 'pending' },
];

const EMPTY_FILTERS: ExpenseFilters = {};

export default function ExpensesClient() {
  const authStatus = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_FILTERS);
  const [saveError, setSaveError] = useState('');

  const loadExpenses = useCallback(async (f: ExpenseFilters) => {
    setLoading(true);
    const result = await listExpenses(undefined, f);
    if (result.error) {
      // Supabase not connected — fall back to demo data with client-side filtering
      let demo = DEMO_EXPENSES;
      if (f.category) demo = demo.filter(e => e.category === f.category);
      if (f.type) demo = demo.filter(e => e.type === f.type);
      if (f.status) demo = demo.filter(e => e.status === f.status);
      if (f.dateFrom) demo = demo.filter(e => e.date >= f.dateFrom!);
      if (f.dateTo) demo = demo.filter(e => e.date <= f.dateTo!);
      if (f.search) {
        const q = f.search.toLowerCase();
        demo = demo.filter(e => e.category.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q));
      }
      setExpenses(demo);
      setDbConnected(false);
    } else {
      setExpenses(result.data);
      setDbConnected(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadExpenses(filters); }, [filters, loadExpenses]);

  // Auth guard (after all hooks)
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  const handleSave = async (data: Omit<Expense, 'id' | 'owner_id' | 'property_id'>) => {
    setSaveError('');
    const fullData: Omit<Expense, 'id' | 'owner_id'> = { ...data, property_id: null };
    if (dbConnected) {
      const result = await createExpense(fullData);
      if (result.error) { setSaveError(result.error); return; }
      setExpenses(prev => [result.data, ...prev]);
    } else {
      setExpenses(prev => [{ ...fullData, id: crypto.randomUUID() }, ...prev]);
    }
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (dbConnected) {
      const result = await deleteExpense(id);
      if (result.error) return;
    }
    setExpenses(prev => prev.filter(e => e.id !== id));
  };

  const totalFixed = expenses.filter(e => e.type === 'fixed').reduce((s, e) => s + e.amount, 0);
  const totalVariable = expenses.filter(e => e.type === 'variable').reduce((s, e) => s + e.amount, 0);
  const pendingExpenses = expenses.filter(e => e.status === 'pending');
  const totalPending = pendingExpenses.reduce((s, e) => s + e.amount, 0);

  const kpis = [
    { label: 'Gastos Fijos', value: formatCurrency(totalFixed), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Gastos Variables', value: formatCurrency(totalVariable), color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Pendiente de Pago', value: formatCurrency(totalPending), color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <>
      <main className="p-8 max-w-7xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between"
        >
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Gastos</h2>
              {!dbConnected && (
                <span className="text-xs font-semibold px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                  Modo demo
                </span>
              )}
            </div>
            <p className="text-slate-500 mt-1">Control de gastos fijos y variables por propiedad.</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            + Registrar Gasto
          </motion.button>
        </motion.div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="p-6 bg-white border rounded-xl shadow-sm"
            >
              <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Cuentas por Pagar */}
        <AnimatePresence>
          {pendingExpenses.length > 0 && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-yellow-900 flex items-center gap-2">
                    <span>⏳</span> Cuentas por Pagar
                    <span className="text-xs font-semibold px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded-full">
                      {pendingExpenses.length}
                    </span>
                  </h3>
                  <span className="font-bold text-yellow-800">{formatCurrency(totalPending)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pendingExpenses.map((e, i) => (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.06 }}
                      className="bg-white rounded-lg p-4 border border-yellow-100 shadow-sm flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{e.category}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{e.date}</p>
                      </div>
                      <p className="font-bold text-yellow-700 text-sm">{formatCurrency(e.amount)}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Filters */}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
        />

        {/* Table */}
        <ExpensesList
          expenses={expenses}
          loading={loading}
          onDelete={handleDelete}
        />
      </main>

      <AnimatePresence>
        {showModal && (
          <ExpenseModal
            onClose={() => { setShowModal(false); setSaveError(''); }}
            onSave={handleSave}
            error={saveError}
          />
        )}
      </AnimatePresence>
    </>
  );
}

