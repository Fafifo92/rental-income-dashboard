import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';
import type { DuplicateEntry, DuplicateAction, DuplicateResolutions, ParsedBooking } from '@/services/etl';
import { formatDateDisplay } from '@/lib/dateUtils';

interface Props {
  duplicates: DuplicateEntry[];
  allBookings: ParsedBooking[];
  onResolve: (keptBookings: ParsedBooking[]) => void;
  onBack: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Estado',
  guest_name: 'Huésped',
  start_date: 'Check-in',
  end_date: 'Check-out',
  num_nights: 'Noches',
  listing_name: 'Anuncio',
  revenue: 'Ingresos',
};

const ALL_FIELDS = ['status', 'guest_name', 'start_date', 'end_date', 'num_nights', 'listing_name', 'revenue'] as const;

function fmtDate(d: string): string {
  return formatDateDisplay(d);
}

function fmtValue(field: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'revenue') return formatCurrency(Number(value));
  if (field === 'start_date' || field === 'end_date') return fmtDate(String(value));
  return String(value);
}

function getSmartDefault(dup: DuplicateEntry): DuplicateAction {
  if (dup.type === 'within_file') return 'use_incoming';
  if (dup.existing.has_payout) return 'keep_existing';
  if (dup.differingFields.length === 0) return 'keep_existing';
  return 'use_incoming';
}

function DuplicateCard({
  dup,
  action,
  onChange,
}: {
  dup: DuplicateEntry;
  action: DuplicateAction;
  onChange: (a: DuplicateAction) => void;
}) {
  const isDb = dup.type === 'with_db';
  const hasPayout = dup.existing.has_payout;
  const hasNotes = dup.existing.has_notes;
  const noDiff = dup.differingFields.length === 0;
  const [showWarning, setShowWarning] = useState(false);

  const handleUseIncoming = () => {
    if (isDb && hasPayout && action !== 'use_incoming') {
      setShowWarning(true);
    } else {
      onChange('use_incoming');
    }
  };

  const confirmUseIncoming = () => {
    setShowWarning(false);
    onChange('use_incoming');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-xl p-4 transition-colors ${
        action === 'keep_existing'
          ? 'border-slate-200 bg-slate-50/40'
          : 'border-blue-200 bg-blue-50/30'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full">
            {dup.confirmation_code}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            isDb ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isDb ? '🗄️ vs base de datos' : '📁 mismo archivo'}
          </span>
          {noDiff && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              ✓ Sin cambios
            </span>
          )}
        </div>
        {isDb && (hasPayout || hasNotes) && (
          <div className="flex gap-1.5 flex-wrap">
            {hasPayout && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                💳 Tiene pago registrado
              </span>
            )}
            {hasNotes && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                📝 Tiene notas
              </span>
            )}
          </div>
        )}
      </div>

      {/* Payout warning modal */}
      {showWarning && (
        <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-xs font-semibold text-orange-800 mb-1">⚠️ Advertencia: datos de pago</p>
          <p className="text-xs text-orange-700 mb-2">
            La versión actual tiene un pago registrado. Al reemplazar con el archivo, <strong>se perderá esa información</strong>.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowWarning(false)}
              className="flex-1 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirmUseIncoming}
              className="flex-1 py-1.5 text-xs font-semibold bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              Sí, reemplazar de todas formas
            </button>
          </div>
        </div>
      )}

      {/* Field comparison table */}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1 pr-3 w-[90px]">
                Campo
              </th>
              <th className={`text-left text-[10px] font-bold uppercase tracking-wide py-1 px-2 rounded-tl ${
                action === 'use_incoming' ? 'bg-blue-100 text-blue-700' : 'text-slate-400'
              }`}>
                {isDb ? 'Del archivo' : 'Última ocurrencia'}
              </th>
              <th className={`text-left text-[10px] font-bold uppercase tracking-wide py-1 px-2 rounded-tr ${
                action === 'keep_existing' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'
              }`}>
                {isDb ? 'En base de datos' : 'Primera ocurrencia'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ALL_FIELDS.map(field => {
              const incomingVal = fmtValue(field, dup.incoming[field] as string | number);
              const existingVal = fmtValue(field, dup.existing[field as keyof typeof dup.existing] as string | number);
              const differs = dup.differingFields.includes(field);
              return (
                <tr key={field} className={differs ? 'bg-yellow-50/60' : ''}>
                  <td className="py-1.5 pr-3 font-medium text-slate-500 whitespace-nowrap">
                    {differs && <span className="text-yellow-600 mr-1" title="Campo diferente">●</span>}
                    {FIELD_LABELS[field]}
                  </td>
                  <td className={`py-1.5 px-2 ${differs && action === 'use_incoming' ? 'font-semibold text-blue-700' : 'text-slate-600'}`}>
                    {incomingVal}
                  </td>
                  <td className={`py-1.5 px-2 ${differs && action === 'keep_existing' ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                    {existingVal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleUseIncoming}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
            action === 'use_incoming'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          {action === 'use_incoming' ? '✓ ' : ''}{isDb ? 'Actualizar desde archivo' : 'Usar última ocurrencia'}
        </button>
        <button
          onClick={() => onChange('keep_existing')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
            action === 'keep_existing'
              ? 'bg-slate-700 text-white border-slate-700 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-700'
          }`}
        >
          {action === 'keep_existing' ? '✓ ' : ''}{isDb ? 'Conservar actual' : 'Usar primera ocurrencia'}
        </button>
      </div>
    </motion.div>
  );
}

export default function DuplicateResolver({ duplicates, allBookings, onResolve, onBack }: Props) {
  const [resolutions, setResolutions] = useState<DuplicateResolutions>(() =>
    Object.fromEntries(duplicates.map(d => [d.confirmation_code, getSmartDefault(d)])),
  );

  const withinFileDupes = useMemo(() => duplicates.filter(d => d.type === 'within_file'), [duplicates]);
  const dbDupes = useMemo(() => duplicates.filter(d => d.type === 'with_db'), [duplicates]);

  const setAll = (action: DuplicateAction) => {
    setResolutions(Object.fromEntries(duplicates.map(d => [d.confirmation_code, action])));
  };

  const setOne = (code: string, action: DuplicateAction) =>
    setResolutions(prev => ({ ...prev, [code]: action }));

  const useIncomingCount = Object.values(resolutions).filter(v => v === 'use_incoming').length;
  const keepExistingCount = duplicates.length - useIncomingCount;

  const handleContinue = () => {
    const objectsToRemove = new Set<ParsedBooking>();
    const codesToSkip = new Set<string>();

    for (const dup of duplicates) {
      const action = resolutions[dup.confirmation_code] ?? getSmartDefault(dup);
      if (dup.type === 'within_file') {
        // Remove ALL occurrences of this code except the chosen one
        const chosenRef = action === 'use_incoming' ? dup.incoming : dup.existing._fileRef;
        for (const b of allBookings) {
          if (b.confirmation_code === dup.confirmation_code && b !== chosenRef) {
            objectsToRemove.add(b);
          }
        }
      } else {
        if (action === 'keep_existing') codesToSkip.add(dup.confirmation_code);
      }
    }

    const kept = allBookings.filter(b => !objectsToRemove.has(b) && !codesToSkip.has(b.confirmation_code));
    onResolve(kept);
  };

  return (
    <div className="space-y-5">
      {/* Summary header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            🔁 {duplicates.length} duplicado{duplicates.length !== 1 ? 's' : ''} detectado{duplicates.length !== 1 ? 's' : ''}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {withinFileDupes.length > 0 && `${withinFileDupes.length} dentro del archivo`}
            {withinFileDupes.length > 0 && dbDupes.length > 0 && ' · '}
            {dbDupes.length > 0 && `${dbDupes.length} ya en base de datos`}
            {' · '}
            <span className="text-blue-600 font-medium">{useIncomingCount} se actualizarán</span>
            {' · '}
            <span className="text-slate-600 font-medium">{keepExistingCount} se conservarán</span>
          </p>
        </div>
        {/* Bulk actions */}
        {duplicates.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setAll('use_incoming')}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              Actualizar todos desde archivo
            </button>
            <button
              onClick={() => setAll('keep_existing')}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Conservar todos existentes
            </button>
          </div>
        )}
      </div>

      {/* Within-file section */}
      {withinFileDupes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
            <span>📁</span> Mismo código en el archivo ({withinFileDupes.length})
          </p>
          {withinFileDupes.map(dup => (
            <DuplicateCard
              key={dup.id}
              dup={dup}
              action={resolutions[dup.confirmation_code] ?? 'use_incoming'}
              onChange={a => setOne(dup.confirmation_code, a)}
            />
          ))}
        </div>
      )}

      {/* DB duplicates section */}
      {dbDupes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
            <span>🗄️</span> Ya existen en base de datos ({dbDupes.length})
          </p>
          {dbDupes.map(dup => (
            <DuplicateCard
              key={dup.id}
              dup={dup}
              action={resolutions[dup.confirmation_code] ?? getSmartDefault(dup)}
              onChange={a => setOne(dup.confirmation_code, a)}
            />
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          ← Atrás
        </button>
        <button
          onClick={handleContinue}
          className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Continuar ({allBookings.length - keepExistingCount} reservas) →
        </button>
      </div>
    </div>
  );
}
