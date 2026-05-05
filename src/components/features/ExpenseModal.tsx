import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, BookingRow, ListingRow, ExpenseSubcategory } from '@/types/database';
import { EXPENSE_SUBCATEGORY_META, SUBCATEGORY_TO_CATEGORY } from '@/types/database';
import { listBookings } from '@/services/bookings';
import { listListings } from '@/services/listings';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import MoneyInput from '@/components/MoneyInput';
import { addMoney, splitMoney } from '@/lib/money';
import { todayISO } from '@/lib/dateUtils';

type FormData = Omit<Expense, 'id' | 'owner_id'>;

interface Props {
  properties?: PropertyRow[];
  bankAccounts?: BankAccountRow[];
  onClose: () => void;
  onSave: (expense: FormData) => void;
  /** Si se provee, habilita el modo "gasto compartido entre varias propiedades". */
  onSaveShared?: (rows: FormData[]) => void;
  /** Editando una fila que pertenece a un gasto compartido: aplicar
   *  estado/banco/fecha a TODAS las filas del grupo en una sola operación. */
  onSaveGroup?: (patch: Partial<Pick<Expense, 'status' | 'bank_account_id' | 'date'>>) => void;
  /** id del grupo cuando se está editando una fila compartida. */
  editingGroupId?: string | null;
  /** total de filas que tiene el grupo (para mostrar en el toggle). */
  editingGroupSize?: number;
  error?: string;
  /** Si se provee, el modal entra en modo edición. */
  initial?: FormData | null;
  /** Valores sugeridos al crear (NO activa modo edición). */
  prefill?: Partial<FormData> | null;
  /** Si el gasto está vinculado a un ajuste de reserva (cobro por daño),
   *  pasar este handler activa el botón "Descartar gasto + ajuste". */
  onDiscardLinked?: () => void;
}

const INITIAL: FormData = {
  category: '',
  subcategory: null,
  type: 'variable',
  amount: 0,
  date: todayISO(),
  description: null,
  status: 'pending',
  property_id: null,
  bank_account_id: null,
  vendor: null,
  person_in_charge: null,
  booking_id: null,
  adjustment_id: null,
};

// Catálogo de detalles específicos por subcategoría (4+3 taxonomía).
// El detalle elegido se persiste como prefijo `[Detalle] …` en `description`,
// para no requerir columnas extra en BD y mantener compatibilidad con datos previos.
const SUBTYPE_OPTIONS: Record<ExpenseSubcategory, string[]> = {
  utilities:       ['Energía', 'Agua', 'Gas', 'Internet', 'TV / Streaming', 'Aseo público', 'Otro'],
  administration:  ['Administración', 'Impuesto predial', 'Seguro', 'Otro impuesto', 'Otro'],
  maintenance:     ['Cocina', 'Baño', 'Sala', 'Habitación', 'Exterior / Balcón', 'Electrodoméstico', 'Plomería', 'Eléctrico', 'General'],
  stock:           ['Lencería', 'Papel higiénico', 'Jabón / amenities', 'Cocina (utensilios)', 'Decoración', 'Otros'],
  cleaning:        ['Aseo (turn)', 'Insumos de limpieza', 'Lavandería externa', 'Otro'],
  damage:          ['Mancha / lavado', 'Rotura', 'Electrodoméstico', 'Mobiliario', 'Limpieza profunda', 'Otro'],
  guest_amenities: ['Welcome kit', 'Snack / bebida', 'Regalo', 'Detalle especial', 'Otro'],
};

// Parsea "[Subtipo] resto" → { subtype, rest }. También extrae el tag de daño
// (`__item:uuid` o `__subject:slug`) para no mostrarlo al editar, pero
// preservarlo al guardar — `reportDamage` lo usa para idempotencia.
const DAMAGE_TAG_RE = /\s*__(?:item|subject):[A-Za-z0-9-]+(?:\s|$)/g;
const parseDescription = (desc: string | null): { subtype: string; rest: string; tag: string } => {
  if (!desc) return { subtype: '', rest: '', tag: '' };
  const tagMatch = desc.match(/__(?:item|subject):[A-Za-z0-9-]+/);
  const tag = tagMatch ? tagMatch[0] : '';
  const cleaned = desc.replace(DAMAGE_TAG_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  const m = cleaned.match(/^\[([^\]]+)\]\s*(.*)$/);
  return m ? { subtype: m[1], rest: m[2], tag } : { subtype: '', rest: cleaned, tag };
};

const composeDescription = (subtype: string, rest: string, tag = ''): string | null => {
  const t = rest.trim();
  const body = subtype ? `[${subtype}]${t ? ' ' + t : ''}` : (t || '');
  if (!body && !tag) return null;
  if (!tag) return body || null;
  return body ? `${body} ${tag}` : tag;
};

export default function ExpenseModal({ properties = [], bankAccounts = [], onClose, onSave, onSaveShared, onSaveGroup, editingGroupId, editingGroupSize, error, initial, prefill, onDiscardLinked }: Props) {
  const initialForm = initial ?? { ...INITIAL, date: todayISO(), ...(prefill ?? {}) };
  const initialParsed = parseDescription(initialForm.description ?? null);
  const [form, setForm] = useState<FormData>({ ...initialForm, description: initialParsed.rest || null });
  const [subtype, setSubtype] = useState<string>(initialParsed.subtype);
  const [damageTag] = useState<string>(initialParsed.tag);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isEdit = !!initial;
  const isLinkedToDamage = isEdit && !!initial?.adjustment_id;
  const isGroupedEdit = isEdit && !!editingGroupId && !!onSaveGroup;
  // Por defecto, si esta fila pertenece a un grupo compartido, aplicamos los
  // cambios de estado/banco/fecha a todo el grupo (es lo que el usuario quiere
  // siempre: una factura = un solo estado).
  const [applyToGroup, setApplyToGroup] = useState<boolean>(isGroupedEdit);

  // ── Estado modo compartido (Bloque 6) ──────────────────────────────────
  // Solo disponible en CREAR (no edición) y cuando hay >=2 propiedades en el catálogo.
  const sharedAllowed = !isEdit && properties.length >= 2 && !!onSaveShared;
  const [sharedMode, setSharedMode] = useState(false);
  const [sharedPropIds, setSharedPropIds] = useState<string[]>([]);
  const [sharedSplitMode, setSharedSplitMode] = useState<'equal' | 'manual'>('equal');
  const [sharedManual, setSharedManual] = useState<Record<string, number | null>>({});

  const currentSection: 'property' | 'booking' | null =
    form.subcategory ? EXPENSE_SUBCATEGORY_META[form.subcategory as ExpenseSubcategory].section : null;
  const isBookingScope = currentSection === 'booking';

  // Carga listings para mapear booking → property (auto-fill propiedad)
  const [listings, setListings] = useState<ListingRow[]>([]);
  useEffect(() => {
    listListings().then(res => { if (!res.error) setListings(res.data ?? []); });
  }, []);
  const listingToPropertyId = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listings) m.set(l.id, l.property_id);
    return m;
  }, [listings]);

  // Carga reservas. Si hay propiedad seleccionada → filtra por ella; si no → todas.
  useEffect(() => {
    listBookings(form.property_id ? { propertyId: form.property_id } : undefined).then(res => {
      if (!res.error) setBookings((res.data ?? []).slice(0, 100));
    });
  }, [form.property_id]);

  // Cuando se elige una reserva sin propiedad seleccionada, autocompletar propiedad.
  useEffect(() => {
    if (!form.booking_id || form.property_id) return;
    const b = bookings.find(x => x.id === form.booking_id);
    if (!b) return;
    const propId = listingToPropertyId.get(b.listing_id);
    if (propId) setForm(prev => ({ ...prev, property_id: propId }));
  }, [form.booking_id, form.property_id, bookings, listingToPropertyId]);

  // Al cambiar subcategoría, resetea subtipo si ya no aplica
  useEffect(() => {
    if (!form.subcategory) { setSubtype(''); return; }
    const opts = SUBTYPE_OPTIONS[form.subcategory as ExpenseSubcategory];
    if (subtype && !opts.includes(subtype)) setSubtype('');
  }, [form.subcategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!form.subcategory) e.subcategory = 'Selecciona el tipo de gasto';
    if (!form.category) e.category = 'Selecciona una categoría';
    if (!form.amount || form.amount <= 0) e.amount = 'Ingresa un monto válido';
    if (!form.date) e.date = 'La fecha es requerida';
    if (isBookingScope && !form.property_id) e.property_id = 'Selecciona la propiedad de la reserva';
    if (isBookingScope && !form.booking_id) e.booking_id = 'Vincula este gasto a una reserva';
    if (form.status === 'paid' && !form.bank_account_id) e.bank_account_id = 'Indica de qué cuenta salió el dinero (obligatorio para gastos pagados).';
    if (sharedMode) {
      if (sharedPropIds.length < 2) e.property_id = 'Selecciona al menos 2 propiedades para compartir';
      if (sharedSplitMode === 'manual') {
        const sum = addMoney(...sharedPropIds.map(id => sharedManual[id] ?? 0));
        if (Math.abs(sum - (form.amount ?? 0)) > 0.005) {
          e.amount = `La suma de las partes (${sum}) no coincide con el total (${form.amount ?? 0})`;
        }
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const merged: FormData = {
      ...form,
      description: composeDescription(subtype, form.description ?? '', damageTag),
    };

    // Modo compartido: emitir N filas
    if (sharedMode && onSaveShared) {
      const total = merged.amount ?? 0;
      const parts: number[] =
        sharedSplitMode === 'equal'
          ? splitMoney(total, sharedPropIds.length)
          : sharedPropIds.map(id => sharedManual[id] ?? 0);
      const rows: FormData[] = sharedPropIds.map((pid, i) => ({
        ...merged,
        property_id: pid,
        amount: parts[i] ?? 0,
      }));
      onSaveShared(rows);
      return;
    }

    // Edición de fila compartida: aplicar estado/banco/fecha al GRUPO entero
    // (lo demás — descripción, vendor, monto — sigue siendo per-row vía onSave).
    if (isGroupedEdit && applyToGroup && onSaveGroup) {
      onSaveGroup({
        status: merged.status,
        bank_account_id: merged.bank_account_id ?? null,
        date: merged.date,
      });
      // Igual disparamos el save individual para que se persistan los demás
      // cambios de la fila (descripción, monto, vendor, etc.).
      onSave(merged);
      return;
    }

    onSave(merged);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        {...makeBackdropHandlers(onClose)}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{isEdit ? 'Editar Gasto' : 'Registrar Gasto'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{isEdit ? 'Modifica los datos del gasto.' : 'Agrega un nuevo gasto a tu registro'}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-lg"
            >
              ✕
            </button>
          </div>

          {/* Banner contextual: gasto vinculado a cobro por daño */}
          {isLinkedToDamage && (
            <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none">🔗</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    Gasto vinculado a cobro por daño
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Este gasto fue generado automáticamente por un ajuste "Cobro por daño" en una reserva.
                    Completa los datos reales de la reparación (monto real, proveedor, cuenta bancaria, marca como <b>Pagado</b>)
                    para que deje de aparecer en "Cuentas por Pagar". El neto del daño se calcula como
                    <span className="italic"> cobrado al huésped − costo real reparación</span>.
                  </p>
                  <p className="text-xs text-amber-700 mt-1.5">
                    ¿No vas a reparar? Usa <b>"Descartar"</b> abajo — eliminará también el ajuste de la reserva.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">

            {/* Subcategoría (taxonomía 4+3) — auto-completa categoría */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo de gasto *</label>
              <select
                value={form.subcategory ?? ''}
                onChange={e => {
                  const sub = e.target.value as ExpenseSubcategory | '';
                  if (sub) {
                    set('subcategory', sub);
                    set('category', SUBCATEGORY_TO_CATEGORY[sub]);
                  } else {
                    set('subcategory', null);
                  }
                }}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.subcategory ? 'border-red-400' : 'border-slate-200'}`}
              >
                <option value="">— Seleccionar —</option>
                <optgroup label="Sobre propiedades">
                  {(Object.entries(EXPENSE_SUBCATEGORY_META) as [ExpenseSubcategory, typeof EXPENSE_SUBCATEGORY_META[ExpenseSubcategory]][])
                    .filter(([, m]) => m.section === 'property')
                    .map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
                </optgroup>
                <optgroup label="Sobre reservas">
                  {(Object.entries(EXPENSE_SUBCATEGORY_META) as [ExpenseSubcategory, typeof EXPENSE_SUBCATEGORY_META[ExpenseSubcategory]][])
                    .filter(([, m]) => m.section === 'booking')
                    .map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
                </optgroup>
              </select>
              {form.subcategory && (
                <div className={`mt-2 flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                  isBookingScope
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}>
                  <span className="font-semibold whitespace-nowrap">
                    {isBookingScope ? '🏨 Sobre reserva' : '🏠 Sobre propiedad'}
                  </span>
                  <span className="text-slate-600">
                    {EXPENSE_SUBCATEGORY_META[form.subcategory as ExpenseSubcategory].description}
                  </span>
                </div>
              )}
              {form.subcategory === 'damage' && (
                <div className="mt-2 text-xs px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-900 space-y-1">
                  <p>
                    ⚠️ <strong>Daños del huésped</strong> es solo para daños ocurridos durante una reserva
                    específica (vinculados al huésped). Si el daño NO está relacionado con una reserva
                    (avería del edificio, desgaste, accidente sin huésped) usa <strong>Mantenimiento</strong>.
                  </p>
                  <p className="pt-1 border-t border-amber-200/60">
                    💡 <strong>Recomendado:</strong> registra el daño desde el botón
                    <span className="font-mono bg-amber-100 px-1 rounded mx-1">⚠ Registrar daño</span>
                    en el detalle de la reserva o desde Inventario. Así queda vinculado al item específico
                    (o a la zona de la propiedad), evita duplicados y crea automáticamente el ajuste de
                    cobro al huésped/plataforma cuando aplique.
                  </p>
                </div>
              )}
              {errors.subcategory && <p className="text-xs text-red-500 mt-1">{errors.subcategory}</p>}
            </div>

            {/* Detalle específico según subcategoría + Tipo (variable/fijo) */}
            {form.subcategory && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Detalle <span className="text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <select
                    value={subtype}
                    onChange={e => setSubtype(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">— Sin detalle —</option>
                    {SUBTYPE_OPTIONS[form.subcategory as ExpenseSubcategory].map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {form.subcategory === 'utilities'       && '¿Cuál servicio público es?'}
                    {form.subcategory === 'administration'  && '¿Qué tipo de cargo administrativo?'}
                    {form.subcategory === 'maintenance'     && '¿En qué área del inmueble?'}
                    {form.subcategory === 'stock'           && '¿Qué insumo se repuso?'}
                    {form.subcategory === 'cleaning'        && '¿Qué tipo de servicio de limpieza?'}
                    {form.subcategory === 'damage'          && '¿Qué tipo de daño causó el huésped?'}
                    {form.subcategory === 'guest_amenities' && '¿Qué atención específica?'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo *</label>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                    {(['variable', 'fixed'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => set('type', t)}
                        className={`flex-1 py-2 text-sm font-medium transition-colors ${
                          form.type === t
                            ? t === 'variable' ? 'bg-orange-500 text-white' : 'bg-blue-600 text-white'
                            : 'text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {t === 'variable' ? 'Variable' : 'Fijo'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {form.type === 'variable' ? 'Cambia mes a mes (luz, agua, daños…).' : 'Mismo monto recurrente (admin, internet, predial).'}
                  </p>
                </div>
              </div>
            )}

            {/* Edición de fila perteneciente a un gasto compartido */}
            {isGroupedEdit && (
              <div className="border border-violet-200 bg-violet-50/60 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToGroup}
                    onChange={e => setApplyToGroup(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="flex-1">
                    <span className="text-sm font-semibold text-violet-800">
                      ⇄ Aplicar estado, fecha y cuenta a las {editingGroupSize ?? '?'} propiedades del grupo
                    </span>
                    <span className="block text-[11px] text-violet-700/80 mt-0.5">
                      Esta fila pertenece a una factura compartida. Al activarlo, los cambios de
                      <b> estado</b>, <b>fecha</b> y <b>cuenta bancaria</b> se replican en todas las filas
                      del grupo. La descripción, el monto y el vendor se mantienen por fila.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Modo compartido (Bloque 6) — solo en CREAR + propiedad scope */}
            {sharedAllowed && !isBookingScope && (
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sharedMode}
                    onChange={e => {
                      setSharedMode(e.target.checked);
                      if (!e.target.checked) {
                        setSharedPropIds([]);
                        setSharedManual({});
                      }
                    }}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1">
                    <span className="text-sm font-medium text-slate-700">Compartir entre varias propiedades</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Útil para servicios públicos (luz, agua, internet) que cubren más de una propiedad. Se creará una entrada por propiedad con la porción correspondiente, todas vinculadas como un mismo gasto.
                    </span>
                  </span>
                </label>

                {sharedMode && (
                  <div className="mt-3 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-600">Propiedades involucradas *</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded p-2">
                      {properties.map(p => {
                        const checked = sharedPropIds.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSharedPropIds(prev =>
                                  prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]
                                );
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs text-slate-700 truncate">{p.name}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setSharedSplitMode('equal')}
                        className={`px-2.5 py-1 rounded border transition ${sharedSplitMode === 'equal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}
                      >
                        Reparto equitativo
                      </button>
                      <button
                        type="button"
                        onClick={() => setSharedSplitMode('manual')}
                        className={`px-2.5 py-1 rounded border transition ${sharedSplitMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}
                      >
                        Manual por propiedad
                      </button>
                    </div>

                    {sharedSplitMode === 'manual' && sharedPropIds.length > 0 && (
                      <div className="space-y-1.5">
                        {sharedPropIds.map(id => {
                          const prop = properties.find(p => p.id === id);
                          return (
                            <div key={id} className="flex items-center gap-2">
                              <span className="flex-1 text-xs text-slate-600 truncate">{prop?.name ?? id}</span>
                              <div className="w-40">
                                <MoneyInput
                                  value={sharedManual[id] ?? null}
                                  onChange={v => setSharedManual(prev => ({ ...prev, [id]: v }))}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          );
                        })}
                        <div className="text-[11px] text-slate-500 text-right">
                          Suma actual: {addMoney(...sharedPropIds.map(id => sharedManual[id] ?? 0)).toLocaleString('es-CO')} / Total: {(form.amount ?? 0).toLocaleString('es-CO')}
                        </div>
                      </div>
                    )}

                    {sharedSplitMode === 'equal' && sharedPropIds.length > 0 && (form.amount ?? 0) > 0 && (
                      <div className="text-[11px] text-slate-500">
                        Cada propiedad asume aprox. {((form.amount ?? 0) / sharedPropIds.length).toLocaleString('es-CO', { maximumFractionDigits: 2 })} (los centavos restantes se ajustan en la primera).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Propiedad */}
            {properties.length > 0 && !sharedMode && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Propiedad {isBookingScope && <span className="text-rose-600">*</span>}
                </label>
                <select
                  value={form.property_id ?? ''}
                  onChange={e => set('property_id', e.target.value || null)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${errors.property_id ? 'border-red-400' : 'border-slate-200'}`}
                >
                  <option value="">{isBookingScope ? '— Selecciona la propiedad —' : 'General / Sin propiedad específica'}</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {errors.property_id && <p className="text-xs text-red-500 mt-1">{errors.property_id}</p>}
              </div>
            )}

            {/* Monto */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto (COP) *</label>
              <MoneyInput
                value={form.amount || null}
                onChange={(v) => set('amount', v ?? 0)}
                placeholder="150.000"
                error={!!errors.amount}
              />
              {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
            </div>

            {/* Fecha + Estado */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${errors.date ? 'border-red-400' : 'border-slate-200'}`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Estado</label>
                <select
                  value={form.status}
                  onChange={e => set('status', e.target.value as Expense['status'])}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                >
                  <option value="pending">Pendiente</option>
                  <option value="paid">Pagado</option>
                  <option value="partial">Parcial</option>
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
              <textarea
                rows={2}
                value={form.description ?? ''}
                onChange={e => set('description', e.target.value || null)}
                placeholder="Descripción opcional…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
              />
            </div>

            {/* Proveedor + A cargo de */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Proveedor <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.vendor ?? ''}
                  onChange={e => set('vendor', e.target.value || null)}
                  placeholder="Ej: EPM, Claro, ferretería…"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  A cargo de <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.person_in_charge ?? ''}
                  onChange={e => set('person_in_charge', e.target.value || null)}
                  placeholder="Ej: María (aseadora)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                />
              </div>
            </div>

            {/* Cuenta bancaria */}
            {bankAccounts.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Pagado desde {form.status === 'paid'
                    ? <span className="text-rose-600">*</span>
                    : <span className="text-slate-400 font-normal">(opcional)</span>}
                </label>
                <select
                  value={form.bank_account_id ?? ''}
                  onChange={e => set('bank_account_id', e.target.value || null)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none transition ${
                    form.status === 'paid' && !form.bank_account_id ? 'border-rose-300' : 'border-slate-200'
                  }`}
                >
                  <option value="">— Sin asignar —</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.bank ? ` (${a.bank})` : ''}
                    </option>
                  ))}
                </select>
                {form.status === 'paid' && !form.bank_account_id && (
                  <p className="text-[11px] text-rose-600 mt-1">Obligatorio cuando el gasto está pagado: indica de qué cuenta salió el dinero.</p>
                )}
              </div>
            )}

            {/* Vincular a reserva — required si la subcategoría es "sobre reservas" */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Vincular a reserva {isBookingScope ? <span className="text-rose-600">*</span> : <span className="text-slate-400 font-normal">(opcional)</span>}
              </label>
              {bookings.length > 0 ? (
                <select
                  value={form.booking_id ?? ''}
                  onChange={e => set('booking_id', e.target.value || null)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none transition ${errors.booking_id ? 'border-red-400' : 'border-slate-200'}`}
                >
                  <option value="">— No vinculado —</option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.confirmation_code} · {b.guest_name ?? 'sin nombre'} · {b.start_date}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  No hay reservas disponibles todavía.
                </p>
              )}
              {errors.booking_id && <p className="text-xs text-red-500 mt-1">{errors.booking_id}</p>}
              <p className="text-xs text-slate-500 mt-1">
                {isBookingScope
                  ? 'Este tipo de gasto siempre está atribuible a un huésped específico.'
                  : 'Útil para amenities, daños, atenciones o cargos ligados a una estadía puntual.'}
              </p>
            </div>

            {/* API Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <motion.button
                type="submit"
                whileTap={{ scale: 0.97 }}
                className="flex-1 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {isEdit ? 'Guardar cambios' : 'Guardar Gasto'}
              </motion.button>
            </div>

            {/* Descartar gasto + ajuste vinculado (sólo en damage_charge) */}
            {onDiscardLinked && isLinkedToDamage && (
              <div className="pt-3 mt-3 border-t border-slate-100">
                {!confirmDiscard ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(true)}
                    className="w-full py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                  >
                    🗑 Descartar este gasto y su ajuste por daño
                  </button>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-red-900">
                      ⚠ ¿Descartar definitivamente?
                    </p>
                    <p className="text-xs text-red-800 mt-1">
                      Se eliminarán <b>dos registros</b>:
                    </p>
                    <ul className="text-xs text-red-800 list-disc list-inside mt-1 space-y-0.5">
                      <li>Este gasto pendiente.</li>
                      <li>El ajuste <span className="font-mono">damage_charge</span> de la reserva vinculada (el "ingreso" cobrado al huésped por ese daño también desaparece).</li>
                    </ul>
                    <p className="text-xs text-red-700 mt-2 italic">
                      Úsalo sólo si el cobro nunca se efectuó o decidiste no proceder. Acción irreversible.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="flex-1 py-2 text-xs font-medium text-slate-700 border border-slate-200 bg-white rounded-lg hover:bg-slate-50"
                      >
                        No, dejar como está
                      </button>
                      <button
                        type="button"
                        onClick={onDiscardLinked}
                        className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
                      >
                        Sí, descartar ambos
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
