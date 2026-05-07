'use client';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryItemStatus,
  PropertyRow,
} from '@/types/database';
import type { CreateInventoryItemInput } from '@/services/inventory';
import { useBackdropClose } from '@/lib/useBackdropClose';
import MoneyInput from '@/components/MoneyInput';
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
export function ItemFormModal({
  item, properties, categories, items, onCreateCategory, onClose, onSave,
}: {
  item: InventoryItemRow | null;
  properties: PropertyRow[];
  categories: InventoryCategoryRow[];
  items: InventoryItemRow[];
  onCreateCategory: (name: string) => Promise<string | null>;
  onClose: () => void;
  onSave: (id: string | null, payload: CreateInventoryItemInput) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [name, setName] = useState(item?.name ?? '');
  const [propertyId, setPropertyId] = useState(item?.property_id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.category_id ?? null);
  const [description, setDescription] = useState(item?.description ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [status, setStatus] = useState<InventoryItemStatus>(item?.status ?? 'good');
  const [quantity, setQuantity] = useState<number | null>(item ? Number(item.quantity) : 1);
  const [unit, setUnit] = useState(item?.unit ?? 'unidad');
  const [isConsumable, setIsConsumable] = useState(item?.is_consumable ?? false);
  const [minStock, setMinStock] = useState<number | null>(item?.min_stock !== null && item?.min_stock !== undefined ? Number(item.min_stock) : null);
  const [purchaseDate, setPurchaseDate] = useState(item?.purchase_date ?? '');
  const [purchasePrice, setPurchasePrice] = useState<number | null>(item?.purchase_price !== null && item?.purchase_price !== undefined ? Number(item.purchase_price) : null);
  const [lifetime, setLifetime] = useState<number | null>(item?.expected_lifetime_months ?? null);
  const [notes, setNotes] = useState(item?.notes ?? '');

  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  const [locationOpen, setLocationOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locationSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) {
      if (it.location?.trim()) seen.add(it.location.trim());
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredLocations = useMemo(() => {
    const q = location.trim().toLowerCase();
    if (!q) return locationSuggestions;
    return locationSuggestions.filter(l => l.toLowerCase().includes(q));
  }, [location, locationSuggestions]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Nombre requerido'); return; }
    if (!propertyId) { setErr('Selecciona una propiedad'); return; }
    if (quantity === null || quantity < 0) { setErr('Cantidad inválida'); return; }
    setSaving(true);
    setErr(null);
    const payload: CreateInventoryItemInput = {
      property_id: propertyId,
      category_id: categoryId,
      name: name.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      status,
      quantity,
      unit: unit.trim() || null,
      min_stock: isConsumable ? minStock : null,
      is_consumable: isConsumable,
      purchase_date: purchaseDate || null,
      purchase_price: purchasePrice ?? null,
      expected_lifetime_months: lifetime ?? null,
      photo_url: null,
      notes: notes.trim() || null,
    };
    const error = await onSave(item?.id ?? null, payload);
    setSaving(false);
    if (error) setErr(error);
    else onClose();
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    const id = await onCreateCategory(newCatName.trim());
    setCreatingCat(false);
    if (id) {
      setCategoryId(id);
      setNewCatName('');
    }
  };

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
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-slate-800">
            {item ? 'Editar item' : 'Nuevo item de inventario'}
          </h3>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
                placeholder="Ej: Sofá, Cafetera Oster, Detergente, Toallas blancas"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad *</label>
              <select
                value={propertyId} onChange={e => setPropertyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {!propertyId && (
                  <option value="" disabled>ÔÇö Selecciona una propiedad ÔÇö</option>
                )}
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Categoría</label>
              <select
                value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon ?? ''} {c.name}</option>)}
              </select>
              <div className="flex gap-1 mt-1">
                <input
                  type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  placeholder="+ Crear categoría"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                  className="flex-1 px-2 py-1 text-xs border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button" onClick={addCategory} disabled={creatingCat || !newCatName.trim()}
                  className="px-2 py-1 text-[11px] font-semibold text-white bg-slate-700 rounded hover:bg-slate-800 disabled:opacity-50"
                >
                  Crear
                </button>
              </div>
            </div>

            <div className="relative">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ubicación</label>
              <input
                type="text"
                value={location}
                onChange={e => { setLocation(e.target.value); setLocationOpen(true); }}
                onFocus={() => setLocationOpen(true)}
                onBlur={() => setTimeout(() => setLocationOpen(false), 150)}
                placeholder="Ej: Cocina, Habitación principal, Baño 1"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <AnimatePresence>
                {locationOpen && filteredLocations.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-44 overflow-y-auto"
                  >
                    {filteredLocations.map(loc => (
                      <li key={loc}>
                        <button
                          type="button"
                          onMouseDown={() => { setLocation(loc); setLocationOpen(false); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700"
                        >
                          {loc}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Estado *</label>
              <select
                value={status} onChange={e => setStatus(e.target.value as InventoryItemStatus)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="good">Bueno</option>
                <option value="needs_maintenance">Mantenimiento</option>
                <option value="damaged">Dañado</option>
                <option value="lost">Perdido</option>
                <option value="depleted">Agotado</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción</label>
              <textarea
                value={description} onChange={e => setDescription(e.target.value)} rows={2}
                placeholder="Marca, modelo, color, detalles relevantesÔÇª"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2 flex items-start gap-2 p-3 bg-sky-50 rounded-lg border border-sky-100">
              <input
                type="checkbox" id="is_consumable" checked={isConsumable}
                onChange={e => setIsConsumable(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor="is_consumable" className="text-xs text-sky-900 cursor-pointer flex-1">
                <span className="font-semibold">Es un insumo consumible</span> (jabón, detergente, papel higiénicoÔÇª). Se podrá registrar consumo y alertar cuando llegue al stock mínimo.
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cantidad *</label>
              <input
                type="number" step="0.01" min="0" value={quantity ?? ''}
                onChange={e => setQuantity(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Unidad</label>
              <input
                type="text" value={unit} onChange={e => setUnit(e.target.value)}
                placeholder="unidad, litro, paquete, rollo"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {isConsumable && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Stock mínimo (alerta)</label>
                <input
                  type="number" step="0.01" min="0" value={minStock ?? ''}
                  onChange={e => setMinStock(e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="Ej: 2 (avisar cuando queden 2 o menos)"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de compra</label>
              <input
                type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Costo unitario</label>
              <MoneyInput value={purchasePrice} onChange={setPurchasePrice} />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Vida útil esperada (meses)</label>
              <input
                type="number" min="0" value={lifetime ?? ''}
                onChange={e => setLifetime(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Informativo (Ej: nevera = 120 meses)"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'GuardandoÔÇª' : item ? 'Guardar cambios' : 'Crear item'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
