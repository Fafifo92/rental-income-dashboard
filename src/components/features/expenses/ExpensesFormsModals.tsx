import { AnimatePresence } from 'framer-motion';
import ExpenseTypeChooser, { type ExpenseTypeChoice } from '../ExpenseTypeChooser';
import DamageFromExpensesFlow from '../DamageFromExpensesFlow';
import PropertyExpenseForm from '../expense-forms/PropertyExpenseForm';
import CleaningSuppliesForm from '../expense-forms/CleaningSuppliesForm';
import VendorExpenseForm from '../expense-forms/VendorExpenseForm';
import InventoryMaintenanceExpenseForm from '../expense-forms/InventoryMaintenanceExpenseForm';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, MaintenanceScheduleRow } from '@/types/database';

export interface ExpenseFormFlags {
  showChooser: boolean;
  showDamageFlow: boolean;
  showPropertyForm: boolean;
  showSuppliesForm: boolean;
  showVendorForm: boolean;
  showInventoryMaintenanceForm: boolean;
  invMaintPrefillSchedule: MaintenanceScheduleRow | null;
  defaultPropertyId: string | null;
}

export interface ExpenseFormHandlers {
  onChooserChoose: (choice: ExpenseTypeChoice) => void;
  closeChooser: () => void;
  closeDamageFlow: () => void;
  onDamageSaved: () => void;
  closePropertyForm: () => void;
  closeSuppliesForm: () => void;
  closeVendorForm: () => void;
  closeInventoryMaintenanceForm: () => void;
  onSave: (data: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean>;
  onSaveShared: (rows: Omit<Expense, 'id' | 'owner_id'>[]) => Promise<boolean>;
  onSaveInventoryMaintenance: (data: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean>;
}

interface Props {
  flags: ExpenseFormFlags;
  handlers: ExpenseFormHandlers;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  vendorSuggestions?: string[];
  saveError: string;
  /** When set, renders the appropriate specialized edit form for this expense. */
  editingExpense?: Expense | null;
  onEditSave?: (data: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean>;
  onEditClose?: () => void;
}

const PROPERTY_SUBS = new Set(['utilities', 'administration', 'maintenance', 'stock']);
/** Legacy category strings used before subcategory was introduced. */
const PROPERTY_CATS = new Set([
  'servicios públicos', 'administración', 'mantenimiento', 'stock / inventario', 'stock',
  'servicios publicos', 'insumos', 'otros gastos',
]);

/**
 * Pila de modales de creación de gastos: chooser + 5 formularios dedicados.
 * También gestiona la edición de gastos especializados mediante `editingExpense`.
 * Stateless — recibe flags y handlers; no toca contexto de gasto en edición.
 */
export default function ExpensesFormsModals({
  flags, handlers, properties, bankAccounts, vendorSuggestions = [], saveError,
  editingExpense = null, onEditSave, onEditClose,
}: Props) {
  const editSub = editingExpense?.subcategory ?? '';
  const editCat = (editingExpense?.category ?? '').toLowerCase();

  const isCleaningEdit = editSub === 'cleaning' || editCat.includes('aseo');
  const isVendorEdit = !!editingExpense?.vendor_id && !isCleaningEdit;
  // Inventory maintenance: subcategory='maintenance' with [Inventario] description prefix
  const isInventoryMaintenanceEdit = !!editingExpense
    && editSub === 'maintenance'
    && (editingExpense.description ?? '').startsWith('[Inventario]');
  // PropertyExpenseForm handles: known property subcategories, matching legacy categories, AND the fallback for everything else
  const isPropertyEdit = !!editingExpense && !isCleaningEdit && !isVendorEdit && !isInventoryMaintenanceEdit;

  const handleEditSave = async (data: Omit<Expense, 'id' | 'owner_id'>) => {
    const ok = await onEditSave!(data);
    if (ok) onEditClose!();
  };

  return (
    <AnimatePresence>
      {flags.showChooser && (
        <ExpenseTypeChooser onChoose={handlers.onChooserChoose} onClose={handlers.closeChooser} />
      )}

      {flags.showDamageFlow && (
        <DamageFromExpensesFlow
          properties={properties}
          onClose={handlers.closeDamageFlow}
          onSaved={handlers.onDamageSaved}
        />
      )}

      {flags.showPropertyForm && (
        <PropertyExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          vendorSuggestions={vendorSuggestions}
          error={saveError || undefined}
          onClose={handlers.closePropertyForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closePropertyForm(); }}
          onSaveShared={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closePropertyForm(); }}
        />
      )}

      {flags.showSuppliesForm && (
        <CleaningSuppliesForm
          properties={properties}
          bankAccounts={bankAccounts}
          error={saveError || undefined}
          onClose={handlers.closeSuppliesForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closeSuppliesForm(); }}
          onSaveShared={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closeSuppliesForm(); }}
        />
      )}

      {flags.showVendorForm && (
        <VendorExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          error={saveError || undefined}
          onClose={handlers.closeVendorForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closeVendorForm(); }}
          onSaveMultiple={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closeVendorForm(); }}
        />
      )}

      {flags.showInventoryMaintenanceForm && (
        <InventoryMaintenanceExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          linkedSchedule={flags.invMaintPrefillSchedule}
          defaultPropertyId={flags.defaultPropertyId}
          error={saveError || undefined}
          onClose={handlers.closeInventoryMaintenanceForm}
          onSave={handlers.onSaveInventoryMaintenance}
        />
      )}

      {/* Edit forms — routing based on subcategory/category/vendor_id */}

      {editingExpense && isCleaningEdit && (
        <CleaningSuppliesForm
          key={editingExpense.id}
          properties={properties}
          bankAccounts={bankAccounts}
          initial={editingExpense}
          error={saveError || undefined}
          onClose={onEditClose!}
          onSave={handleEditSave}
          onSaveShared={async () => {}}
        />
      )}

      {editingExpense && isVendorEdit && (
        <VendorExpenseForm
          key={editingExpense.id}
          properties={properties}
          bankAccounts={bankAccounts}
          initial={editingExpense}
          error={saveError || undefined}
          onClose={onEditClose!}
          onSave={handleEditSave}
        />
      )}

      {/* PropertyExpenseForm is the catch-all for all non-cleaning, non-vendor, non-inventory-maintenance edits
          (property subs, legacy category strings, booking-related, unclassified, etc.) */}
      {editingExpense && isInventoryMaintenanceEdit && (
        <InventoryMaintenanceExpenseForm
          key={editingExpense.id}
          properties={properties}
          bankAccounts={bankAccounts}
          initial={editingExpense}
          error={saveError || undefined}
          onClose={onEditClose!}
          onSave={handleEditSave}
        />
      )}

      {editingExpense && isPropertyEdit && (
        <PropertyExpenseForm
          key={editingExpense.id}
          properties={properties}
          bankAccounts={bankAccounts}
          vendorSuggestions={vendorSuggestions}
          initial={editingExpense}
          error={saveError || undefined}
          onClose={onEditClose!}
          onSave={handleEditSave}
          onSaveShared={async () => {}}
        />
      )}
    </AnimatePresence>
  );
}
