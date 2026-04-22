import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseAirbnbFile, type ParsedBooking } from '@/services/etl';
import { upsertBookings, saveDemoBookings, type ImportResult } from '@/services/bookings';
import ListingMapper from './ListingMapper';
import { formatCurrency } from '@/lib/utils';

type Step = 'idle' | 'dragging' | 'parsing' | 'preview' | 'mapping' | 'importing' | 'complete' | 'error';

interface Props {
  onClose: () => void;
  onImport?: (bookings: ParsedBooking[]) => void;
}

const STATUS_COLORS: Record<string, string> = {
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-red-100 text-red-700',
  pendiente: 'bg-yellow-100 text-yellow-700',
};
const statusColor = (s: string) =>
  STATUS_COLORS[s.toLowerCase()] ?? 'bg-slate-100 text-slate-600';

const STEP_LABELS: Partial<Record<Step, string>> = {
  preview: '1. Vista previa',
  mapping: '2. Vincular anuncios',
  importing: '3. Importando…',
  complete: '3. Completado',
};

export default function CSVUploader({ onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [bookings, setBookings] = useState<ParsedBooking[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uniqueListingNames = useMemo(
    () => [...new Set(bookings.map(b => b.listing_name).filter(Boolean))],
    [bookings],
  );

  const totalRevenue = bookings.reduce((s, b) => s + b.revenue, 0);
  const totalNights = bookings.reduce((s, b) => s + b.num_nights, 0);

  const processFile = useCallback(async (file: File) => {
    setStep('parsing');
    setError('');
    try {
      const parsed = await parseAirbnbFile(file);
      if (parsed.length === 0) throw new Error('El archivo no contiene filas válidas.');
      setBookings(parsed);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al procesar el archivo.');
      setStep('error');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setStep('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleMappingConfirm = async (
    listingMap: Record<string, string>,
    isDemo: boolean,
  ) => {
    if (isDemo) {
      const importResult = saveDemoBookings(bookings);
      setResult(importResult);
      setStep('complete');
      onImport?.(bookings);
      return;
    }

    setStep('importing');
    const res = await upsertBookings(bookings, listingMap);
    if (res.error) {
      setError(res.error);
      setStep('error');
      return;
    }
    setResult(res.data);
    setStep('complete');
    onImport?.(bookings);
  };

  const isDropZone = step === 'idle' || step === 'dragging' || step === 'error';
  const currentStepLabel =
    step === 'preview' || step === 'mapping' || step === 'importing' || step === 'complete'
      ? Object.keys(STEP_LABELS)
          .map(k => ({ key: k as Step, label: STEP_LABELS[k as Step]! }))
      : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Importar desde Airbnb</h2>
            <p className="text-sm text-slate-500 mt-0.5">CSV o XLSX de reservaciones</p>
          </div>
          {/* Step indicators */}
          {currentStepLabel.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 mr-8">
              {currentStepLabel.map(({ key, label }) => (
                <span
                  key={key}
                  className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
                    step === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* STEP: Drop zone */}
          <AnimatePresence mode="wait">
            {isDropZone && (
              <motion.div
                key="dropzone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onDragOver={(e) => { e.preventDefault(); setStep('dragging'); }}
                onDragLeave={() => setStep(s => s === 'dragging' ? 'idle' : s)}
                onDrop={onDrop}
                style={{
                  borderColor: step === 'dragging' ? '#3b82f6' : '#e2e8f0',
                  backgroundColor: step === 'dragging' ? '#eff6ff' : '#f8fafc',
                }}
                className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors"
                onClick={() => inputRef.current?.click()}
              >
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
                {step === 'error' ? (
                  <div className="space-y-2">
                    <div className="text-4xl">⚠️</div>
                    <p className="font-semibold text-red-600">{error}</p>
                    <p className="text-sm text-slate-400">Haz clic o arrastra otro archivo</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-5xl">📁</div>
                    <p className="font-semibold text-slate-700 text-lg">
                      {step === 'dragging' ? 'Suelta el archivo aquí' : 'Arrastra tu archivo aquí'}
                    </p>
                    <p className="text-sm text-slate-400">o haz clic para buscar</p>
                    <div className="inline-flex gap-2">
                      <span className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-md">.csv</span>
                      <span className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-600 rounded-md">.xlsx</span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* STEP: Parsing */}
            {step === 'parsing' && (
              <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-16">
                <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-sm font-medium text-slate-500">Procesando archivo…</p>
              </motion.div>
            )}

            {/* STEP: Importing */}
            {step === 'importing' && (
              <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-16">
                <div className="w-12 h-12 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
                <p className="text-sm font-medium text-slate-500">Guardando en base de datos…</p>
              </motion.div>
            )}

            {/* STEP: Preview */}
            {step === 'preview' && (
              <motion.div key="preview" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Reservas', value: bookings.length.toString(), color: 'text-blue-600' },
                    { label: 'Ingresos brutos', value: formatCurrency(totalRevenue), color: 'text-green-600' },
                    { label: 'Noches totales', value: totalNights.toString(), color: 'text-purple-600' },
                  ].map((kpi, i) => (
                    <motion.div
                      key={kpi.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="p-4 bg-slate-50 rounded-xl border"
                    >
                      <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                      <p className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Vista previa ({bookings.length} filas)</span>
                    <button onClick={() => { setStep('idle'); setBookings([]); }} className="text-xs text-slate-400 hover:text-slate-600">
                      Cambiar archivo
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white border-b">
                        <tr>
                          {['Código', 'Estado', 'Huésped', 'Check-in', 'Check-out', 'Noches', 'Anuncio', 'Ingresos'].map(h => (
                            <th key={h} className="text-left px-4 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bookings.slice(0, 50).map((b, i) => (
                          <motion.tr
                            key={b.confirmation_code || i}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: Math.min(i * 0.015, 0.4) }}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-4 py-2 font-mono text-slate-500">{b.confirmation_code || '—'}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full font-medium ${statusColor(b.status)}`}>{b.status || '—'}</span>
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap text-slate-700">{b.guest_name || '—'}</td>
                            <td className="px-4 py-2 text-slate-500">{b.start_date}</td>
                            <td className="px-4 py-2 text-slate-500">{b.end_date}</td>
                            <td className="px-4 py-2 text-center font-medium">{b.num_nights}</td>
                            <td className="px-4 py-2 text-slate-600 max-w-[140px] truncate">{b.listing_name}</td>
                            <td className="px-4 py-2 text-right font-semibold text-slate-800">{formatCurrency(b.revenue)}</td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP: Listing Mapper */}
            {step === 'mapping' && (
              <motion.div key="mapping" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <ListingMapper
                  uniqueNames={uniqueListingNames}
                  onConfirm={handleMappingConfirm}
                  onBack={() => setStep('preview')}
                />
              </motion.div>
            )}

            {/* STEP: Complete */}
            {step === 'complete' && result && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8 space-y-5"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
                  className="text-6xl"
                >
                  ✅
                </motion.div>
                <div>
                  <p className="text-xl font-bold text-slate-900">¡Importación exitosa!</p>
                  <p className="text-slate-500 mt-1 text-sm">Las reservas han sido guardadas correctamente.</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
                  <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center">
                    <p className="text-xs font-medium text-green-700">Reservas guardadas</p>
                    <p className="text-2xl font-bold text-green-800 mt-0.5">{result.upserted}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border text-center">
                    <p className="text-xs font-medium text-slate-500">Omitidas</p>
                    <p className="text-2xl font-bold text-slate-700 mt-0.5">{result.skipped}</p>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <div className="text-left bg-red-50 border border-red-200 rounded-xl p-4 w-full max-w-xs">
                    <p className="text-xs font-semibold text-red-700 mb-2">Errores ({result.errors.length})</p>
                    {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                  </div>
                )}
                <a
                  href="/bookings"
                  className="w-full max-w-xs flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Ver Reservas →
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {step === 'preview' || step === 'mapping'
              ? `${bookings.length} reservas detectadas • ${uniqueListingNames.length} anuncio(s) único(s)`
              : 'Exporta desde Airbnb → Informes → Reservas'}
          </p>
          <div className="flex gap-3">
            {step !== 'complete' && (
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                Cancelar
              </button>
            )}
            {step === 'preview' && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setStep('mapping')}
                className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Siguiente: Vincular →
              </motion.button>
            )}
            {step === 'complete' && (
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                Cerrar
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

