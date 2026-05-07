import { motion } from 'framer-motion';
import type { PropertyRow, CreditPoolRow, CreditPoolConsumptionRule } from '@/types/database';
import type { Vendor } from '@/services/vendors';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { formatCurrency } from '@/lib/utils';
import MoneyInput from '@/components/MoneyInput';
import { parseMoney } from '@/lib/money';
import { KINDS, KINDS_FORM, kindDescription, defaultCategoryFor, type VendorForm, type PropShare } from './vendorTypes';

interface Props {
  editing: Vendor | null;
  form: VendorForm;
  setForm: React.Dispatch<React.SetStateAction<VendorForm>>;
  err: string | null;
  saving: boolean;
  editingPool: CreditPoolRow | null;
  properties: PropertyRow[];
  toggleProp: (propertyId: string) => void;
  setPropShare: (propertyId: string, raw: string) => void;
  setPropFixed: (propertyId: string, raw: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function VendorFormModal({
  editing, form, setForm, err, saving, editingPool,
  properties, toggleProp, setPropShare, setPropFixed,
  onSave, onClose,
}: Props) {
  return (
    <motion.div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">
          {editing ? 'Editar proveedor' : 'Nuevo proveedor'}
        </h3>

        {editing && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            ℹ️ Al editar este proveedor <b>no se modifican los gastos ya registrados</b>.
            El nuevo precio o datos solo aplicarán a futuros pagos.
          </p>
        )}

        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Hospitable, Contador Pérez, Predial 2025"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo *</label>
            <select
              value={form.kind}
              onChange={e => {
                const newKind = e.target.value as typeof form.kind;
                setForm(f => ({ ...f, kind: newKind, category: defaultCategoryFor(newKind) }));
              }}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              {KINDS_FORM.map(k => <option key={k.value} value={k.value}>{k.icon} {k.label}</option>)}
              {!KINDS_FORM.some(k => k.value === form.kind) && (
                <option value={form.kind}>
                  {(KINDS.find(k => k.value === form.kind)?.icon ?? '🗂') + ' '}
                  {KINDS.find(k => k.value === form.kind)?.label ?? form.kind} (legacy)
                </option>
              )}
            </select>
            <p className="text-[11px] text-slate-500 mt-1 italic">{kindDescription(form.kind)}</p>
          </div>

          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            💼 Los gastos de este proveedor se registrarán en la categoría <b>{defaultCategoryFor(form.kind)}</b>.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {form.kind === 'insurance' ? 'Precio de la bolsa (COP)' : 'Monto mensual estimado'}
              </label>
              <MoneyInput
                value={parseMoney(form.defaultAmount)}
                onChange={(v) => setForm({ ...form, defaultAmount: v == null ? '' : String(v) })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Día del mes</label>
              <input
                type="number"
                min={1} max={31}
                value={form.dayOfMonth}
                onChange={e => setForm({ ...form, dayOfMonth: e.target.value })}
                placeholder="ej. 15"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {form.kind === 'insurance' && (
            <InsurancePoolSection form={form} setForm={setForm} editingPool={editingPool} />
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Vigente desde (mes)</label>
            <input
              type="month"
              value={form.startYearMonth}
              onChange={e => setForm({ ...form, startYearMonth: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">Si lo dejas en blanco se generan periodos pendientes desde hace varios meses. Defínelo para que no aparezcan meses anteriores que no debes pagar.</p>
          </div>

          <label className="flex items-start gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100">
            <input
              type="checkbox"
              checked={form.isVariable}
              onChange={e => setForm({ ...form, isVariable: e.target.checked })}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-semibold text-slate-700">El monto cambia mes a mes</div>
              <div className="text-[11px] text-slate-500">Marca esto si el total varía (ej. luz, gas, agua). Al pagar, el sistema te pedirá el total real y el monto exacto que paga cada apartamento.</div>
            </div>
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text"
              value={form.contact}
              onChange={e => setForm({ ...form, contact: e.target.value })}
              placeholder="Teléfono, email o ambos"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setForm({ ...form, active: e.target.checked })}
              className="w-4 h-4"
            />
            Activo
          </label>

          <PropsSectionInForm
            properties={properties}
            props={form.props}
            toggleProp={toggleProp}
            setPropShare={setPropShare}
            setPropFixed={setPropFixed}
          />
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Insurance credit pool sub-section ──────────────────────────────────────
function InsurancePoolSection({
  form, setForm, editingPool,
}: {
  form: VendorForm;
  setForm: React.Dispatch<React.SetStateAction<VendorForm>>;
  editingPool: CreditPoolRow | null;
}) {
  return (
    <div className="border border-amber-200 rounded-xl bg-amber-50 p-4 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.poolEnabled}
          onChange={e => setForm(f => ({ ...f, poolEnabled: e.target.checked }))}
          className="w-4 h-4 accent-amber-600"
        />
        <span className="text-sm font-semibold text-amber-900">Configurar como bolsa de créditos</span>
      </label>
      <p className="text-[11px] text-amber-700">
        Activa esto si este seguro funciona por créditos prepagados que se descuentan al hacer check-in de cada reserva.
      </p>
      {form.poolEnabled && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Total de créditos *</label>
              <input
                type="number" min={1}
                value={form.poolCreditsTotal}
                onChange={e => setForm(f => ({ ...f, poolCreditsTotal: e.target.value }))}
                placeholder="Ej: 1000"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Créditos por unidad</label>
              <input
                type="number" min={0.01} step={0.01}
                value={form.poolCreditsPerUnit}
                onChange={e => setForm(f => ({ ...f, poolCreditsPerUnit: e.target.value }))}
                placeholder="1"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Regla de consumo</label>
            <select
              value={form.poolConsumptionRule}
              onChange={e => setForm(f => ({ ...f, poolConsumptionRule: e.target.value as CreditPoolConsumptionRule }))}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none bg-white"
            >
              <option value="per_person_per_night">Por persona y noche</option>
              <option value="per_person_per_booking">Por persona (toda la reserva)</option>
              <option value="per_booking">Por reserva (fijo)</option>
            </select>
          </div>
          {form.poolConsumptionRule !== 'per_booking' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Peso de niños (0–1)</label>
              <input
                type="number" min={0} max={1} step={0.1}
                value={form.poolChildWeight}
                onChange={e => setForm(f => ({ ...f, poolChildWeight: e.target.value }))}
                placeholder="1"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-0.5">1 = niños cuentan igual que adultos, 0.5 = mitad de créditos</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Activar desde *</label>
              <input
                type="date"
                value={form.poolActivatedAt}
                onChange={e => setForm(f => ({ ...f, poolActivatedAt: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Vence (opcional)</label>
              <input
                type="date"
                value={form.poolExpiresAt}
                onChange={e => setForm(f => ({ ...f, poolExpiresAt: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>
          <p className="text-[10px] text-amber-700">
            💡 El precio de la bolsa se toma del campo "Monto mensual estimado" de arriba.
          </p>
          {editingPool && (
            <div className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
              Bolsa activa: <b>{editingPool.credits_used}</b> / {editingPool.credits_total} créditos usados
              {editingPool.status === 'depleted' && <span className="ml-2 text-red-600 font-semibold">· AGOTADA</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Properties assignment section inside form ───────────────────────────────
function PropsSectionInForm({
  properties, props, toggleProp, setPropShare, setPropFixed,
}: {
  properties: PropertyRow[];
  props: PropShare[];
  toggleProp: (propertyId: string) => void;
  setPropShare: (propertyId: string, raw: string) => void;
  setPropFixed: (propertyId: string, raw: string) => void;
}) {
  return (
    <div className="pt-3 border-t border-slate-100">
      <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedades cubiertas</label>
      <p className="text-[11px] text-slate-500 mb-2">
        Marca las propiedades que paga este servicio. Reglas de reparto al pagar la factura mensual:<br/>
        <span className="font-semibold">monto fijo</span> tiene prioridad; si no, se usa el <span className="font-semibold">%</span>;
        si no hay nada, se reparte por partes iguales.
      </p>
      {properties.length === 0 ? (
        <p className="text-xs text-slate-400">No tienes propiedades creadas aún.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
          {properties.map(p => {
            const sel = props.find(fp => fp.propertyId === p.id);
            return (
              <div key={p.id} className="px-3 py-2 hover:bg-slate-50">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!sel}
                    onChange={() => toggleProp(p.id)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 text-sm text-slate-700 truncate">{p.name}</span>
                </label>
                {sel && (
                  <div className="grid grid-cols-2 gap-2 mt-2 ml-6">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Monto fijo</label>
                      <MoneyInput
                        value={sel.fixedAmount ?? null}
                        onChange={(v) => setPropFixed(p.id, v == null ? '' : String(v))}
                        placeholder="—"
                        prefix={null}
                        inputClassName="text-xs text-right"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">o % del total</label>
                      <input
                        type="number" min={0} max={100} step={0.1}
                        value={sel.sharePercent ?? ''}
                        onChange={e => setPropShare(p.id, e.target.value)}
                        placeholder="auto"
                        className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 outline-none text-right"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {props.length > 0 && (() => {
        const fixed    = props.filter(p => p.fixedAmount != null);
        const pct      = props.filter(p => p.fixedAmount == null && p.sharePercent != null);
        const eq       = props.filter(p => p.fixedAmount == null && p.sharePercent == null);
        const fixedSum = fixed.reduce((s, p) => s + (p.fixedAmount ?? 0), 0);
        const pctSum   = pct.reduce((s, p) => s + (p.sharePercent ?? 0), 0);
        return (
          <p className="text-[11px] text-slate-600 mt-1">
            {fixed.length > 0 && <>{formatCurrency(fixedSum)} fijo · </>}
            {pct.length > 0 && <>{pctSum.toFixed(1)}% · </>}
            {eq.length > 0 && <>{eq.length} con reparto igual del resto</>}
          </p>
        );
      })()}
    </div>
  );
}
