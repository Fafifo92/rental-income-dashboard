import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  parseAirbnbFile, detectWithinFileConflicts, detectWithinFileDuplicates,
  type ParsedBooking, type ConflictEntry, type DuplicateEntry,
} from '@/services/etl';
import { upsertBookings, saveDemoBookings, detectDbConflicts, detectDbDuplicates, type ImportResult } from '@/services/bookings';
import ListingMapper from './ListingMapper';
import ConflictResolver from './ConflictResolver';
import DuplicateResolver from './DuplicateResolver';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

type Step = 'idle' | 'dragging' | 'parsing' | 'preview' | 'mapping' | 'checking_dupes' | 'dupes' | 'checking' | 'conflicts' | 'importing' | 'complete' | 'error';

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

export default function CSVUploader({ onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [bookings, setBookings] = useState<ParsedBooking[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [withinFileConflicts, setWithinFileConflicts] = useState<ConflictEntry[]>([]);
  const [dbConflicts, setDbConflicts] = useState<ConflictEntry[]>([]);
  const [withinFileDupes, setWithinFileDupes] = useState<DuplicateEntry[]>([]);
  const [dbDupes, setDbDupes] = useState<DuplicateEntry[]>([]);
  const [pendingListingMap, setPendingListingMap] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const allConflicts = useMemo(
    () => [...withinFileConflicts, ...dbConflicts],
    [withinFileConflicts, dbConflicts],
  );
  const allDuplicates = useMemo(
    () => [...withinFileDupes, ...dbDupes],
    [withinFileDupes, dbDupes],
  );

  // Set of confirmation_codes involved in within-file conflicts (for highlighting preview table)
  const conflictCodesInFile = useMemo(
    () => new Set([
      ...withinFileConflicts.flatMap(c => [c.incoming.confirmation_code, c.opponent.confirmation_code]),
    ]),
    [withinFileConflicts],
  );

  const hasConflictStep = allConflicts.length > 0 || step === 'checking' || step === 'conflicts';
  const hasDupesStep = allDuplicates.length > 0 || step === 'checking_dupes' || step === 'dupes';

  const STEP_LABELS = useMemo((): Partial<Record<Step, string>> => {
    const labels: Partial<Record<Step, string>> = { preview: '1. Vista previa', mapping: '2. Vincular' };
    let n = 3;
    if (hasDupesStep) { labels.dupes = `${n}. Duplicados`; n++; }
    if (hasConflictStep) { labels.conflicts = `${n}. Conflictos`; n++; }
    labels.importing = `${n}. Importando…`;
    labels.complete = `${n}. Completado`;
    return labels;
  }, [hasDupesStep, hasConflictStep]);

  const uniqueListingNames = useMemo(
    () => [...new Set(bookings.map(b => b.listing_name).filter(Boolean))],
    [bookings],
  );

  const totalRevenue = bookings.reduce((s, b) => s + b.revenue, 0);
  const totalNights = bookings.reduce((s, b) => s + b.num_nights, 0);

  const runImport = useCallback(async (booksToImport: ParsedBooking[], listingMap: Record<string, string>) => {
    setStep('importing');
    const res = await upsertBookings(booksToImport, listingMap);
    if (res.error) {
      setError(res.error);
      setStep('error');
      return;
    }
    setResult(res.data);
    setStep('complete');
    onImport?.(booksToImport);
  }, [onImport]);

  const processFile = useCallback(async (file: File) => {
    setStep('parsing');
    setError('');
    setWithinFileConflicts([]);
    setDbConflicts([]);
    setWithinFileDupes([]);
    setDbDupes([]);
    try {
      const parsed = await parseAirbnbFile(file);
      if (parsed.length === 0) throw new Error('El archivo no contiene filas válidas.');
      setBookings(parsed);
      setWithinFileConflicts(detectWithinFileConflicts(parsed));
      setWithinFileDupes(detectWithinFileDuplicates(parsed));
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

  const checkConflictsAndImport = useCallback(async (
    booksToCheck: ParsedBooking[],
    listingMap: Record<string, string>,
  ) => {
    setStep('checking');
    const res = await detectDbConflicts(booksToCheck, listingMap);
    if (res.error) {
      setError(res.error);
      setStep('error');
      return;
    }
    const dbc = res.data ?? [];
    setDbConflicts(dbc);
    const combined = [...withinFileConflicts, ...dbc];
    if (combined.length > 0) {
      setStep('conflicts');
    } else {
      await runImport(booksToCheck, listingMap);
    }
  }, [withinFileConflicts, runImport]);

  const handleMappingConfirm = useCallback(async (
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

    setPendingListingMap(listingMap);
    setStep('checking_dupes');

    const dupRes = await detectDbDuplicates(bookings);
    if (dupRes.error) {
      setError(dupRes.error);
      setStep('error');
      return;
    }

    const newDbDupes = dupRes.data ?? [];
    setDbDupes(newDbDupes);
    const allDupes = [...withinFileDupes, ...newDbDupes];

    if (allDupes.length > 0) {
      setStep('dupes');
    } else {
      await checkConflictsAndImport(bookings, listingMap);
    }
  }, [bookings, withinFileDupes, checkConflictsAndImport, onImport]);

  const handleDupesResolved = useCallback(async (resolvedBookings: ParsedBooking[]) => {
    setBookings(resolvedBookings);
    await checkConflictsAndImport(resolvedBookings, pendingListingMap);
  }, [pendingListingMap, checkConflictsAndImport]);

  const isDropZone = step === 'idle' || step === 'dragging' || step === 'error';
  // Map transient steps to their indicator tab
  const displayStep = (step === 'checking_dupes' ? 'dupes' : step === 'checking' ? 'conflicts' : step) as Step;
  const currentStepLabel =
    ['preview', 'mapping', 'checking_dupes', 'dupes', 'checking', 'conflicts', 'importing', 'complete'].includes(step)
      ? (Object.keys(STEP_LABELS) as Step[]).map(k => ({ key: k, label: STEP_LABELS[k]! }))
      : [];

  return (
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
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
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
                    displayStep === key
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
                    <p className="font-semibold text-red-600">{error}</p>
                    <p className="text-sm text-slate-400">Haz clic o arrastra otro archivo</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
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

            {/* STEP: Checking duplicates */}
            {step === 'checking_dupes' && (
              <motion.div key="checking_dupes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-16">
                <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                <p className="text-sm font-medium text-slate-500">Verificando duplicados…</p>
              </motion.div>
            )}

            {/* STEP: Checking conflicts */}
            {step === 'checking' && (
              <motion.div key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-16">
                <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                <p className="text-sm font-medium text-slate-500">Verificando conflictos de fechas…</p>
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
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
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

                {/* Within-file duplicate warning */}
                {withinFileDupes.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-start gap-3"
                  >
                    <span className="text-lg flex-none">🔁</span>
                    <div>
                      <p className="text-sm font-semibold text-purple-800">
                        {withinFileDupes.length} código{withinFileDupes.length > 1 ? 's' : ''} duplicado{withinFileDupes.length > 1 ? 's' : ''} en el archivo
                      </p>
                      <p className="text-xs text-purple-600 mt-0.5">
                        Las filas marcadas con 🔁 tienen el mismo código de confirmación. Podrás elegir cuál conservar.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Within-file conflict warning */}
                {withinFileConflicts.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3"
                  >
                    <span className="text-lg flex-none">⚠️</span>
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {withinFileConflicts.length} conflicto{withinFileConflicts.length > 1 ? 's' : ''} de fechas en el archivo
                      </p>
                      <p className="text-xs text-amber-600 mt-0.5">
                        Las filas marcadas con ⚠️ se solapan con otras reservas del mismo anuncio. Podrás resolverlos después de vincular los anuncios.
                      </p>
                    </div>
                  </motion.div>
                )}

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
                        {bookings.slice(0, 50).map((b, i) => {
                          const hasConflict = conflictCodesInFile.has(b.confirmation_code);
                          const isDupe = withinFileDupes.some(d => d.confirmation_code === b.confirmation_code);
                          return (
                            <motion.tr
                              key={b.confirmation_code || i}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: Math.min(i * 0.015, 0.4) }}
                              className={`hover:bg-slate-50 ${hasConflict ? 'bg-amber-50/60' : isDupe ? 'bg-purple-50/60' : ''}`}
                            >
                              <td className="px-4 py-2 font-mono text-slate-500">
                                {hasConflict && <span className="mr-1" title="Conflicto de fechas">⚠️</span>}
                                {isDupe && !hasConflict && <span className="mr-1" title="Código duplicado">🔁</span>}
                                {b.confirmation_code || '—'}
                              </td>
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
                          );
                        })}
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

            {/* STEP: Duplicate Resolver */}
            {step === 'dupes' && (
              <motion.div key="dupes" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <DuplicateResolver
                  duplicates={allDuplicates}
                  allBookings={bookings}
                  onResolve={handleDupesResolved}
                  onBack={() => setStep('mapping')}
                />
              </motion.div>
            )}

            {/* STEP: Conflict Resolver */}
            {step === 'conflicts' && (
              <motion.div key="conflicts" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <ConflictResolver
                  conflicts={allConflicts}
                  allBookings={bookings}
                  onResolve={(kept) => runImport(kept, pendingListingMap)}
                  onBack={() => setStep(hasDupesStep ? 'dupes' : 'mapping')}
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
                  className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
                <div>
                  <p className="text-xl font-bold text-slate-900">¡Importación exitosa!</p>
                  <p className="text-slate-500 mt-1 text-sm">Las reservas han sido guardadas correctamente.</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full max-w-xs mx-auto">
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
                  <div className="text-left bg-red-50 border border-red-200 rounded-xl p-4 w-full max-w-xs mx-auto">
                    <p className="text-xs font-semibold text-red-700 mb-2">Errores ({result.errors.length})</p>
                    {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                  </div>
                )}
                <a
                  href="/bookings"
                  className="w-full max-w-xs mx-auto flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
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
            {(['preview', 'mapping', 'dupes', 'conflicts'] as Step[]).includes(step)
              ? `${bookings.length} reservas detectadas • ${uniqueListingNames.length} anuncio(s) único(s)`
              : 'Exporta desde Airbnb → Informes → Reservas'}
          </p>
          <div className="flex gap-3">
            {step !== 'complete' && step !== 'checking' && step !== 'checking_dupes' && step !== 'conflicts' && step !== 'dupes' && (
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

