import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ConflictEntry, ConflictAction, ConflictResolutions, ParsedBooking } from '@/services/etl';

interface Props {
  conflicts: ConflictEntry[];
  allBookings: ParsedBooking[];
  onResolve: (keptBookings: ParsedBooking[]) => void;
  onBack: () => void;
}

function fmtDate(d: string): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function BookingMiniCard({
  label,
  code,
  guest,
  start,
  end,
  nights,
  highlight,
}: {
  label: string;
  code: string;
  guest: string | null;
  start: string;
  end: string;
  nights: number;
  highlight?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 p-3 rounded-lg border transition-colors ${
      highlight ? 'bg-green-50 border-green-300 ring-1 ring-green-400' : 'bg-white border-slate-200'
    }`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{label}</p>
      <p className="text-xs font-mono font-semibold text-slate-700 truncate">{code || '—'}</p>
      <p className="text-sm text-slate-600 truncate mt-0.5">{guest || 'Huésped desconocido'}</p>
      <p className="text-xs text-slate-400 mt-1">
        {fmtDate(start)} → {fmtDate(end)}
        <span className="ml-1 font-medium text-slate-500">{nights} noche{nights !== 1 ? 's' : ''}</span>
      </p>
    </div>
  );
}

function ConflictCard({
  conflict,
  action,
  onChange,
}: {
  conflict: ConflictEntry;
  action: ConflictAction;
  onChange: (a: ConflictAction) => void;
}) {
  const { incoming, opponent, listingName, type } = conflict;
  const isDb = type === 'with_db';
  const resolved = action !== 'skip';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-xl p-4 transition-colors ${
        resolved
          ? 'border-green-200 bg-green-50/30'
          : 'border-rose-200 bg-rose-50/20'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full truncate max-w-[220px]">
          {listingName}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-none ${
          isDb ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {isDb ? '🗄️ vs base de datos' : '📁 mismo archivo'}
        </span>
      </div>

      {/* Both sides */}
      <div className="flex gap-2 mb-3">
        <BookingMiniCard
          label={isDb ? 'Del archivo' : `Opción A`}
          code={incoming.confirmation_code}
          guest={incoming.guest_name}
          start={incoming.start_date}
          end={incoming.end_date}
          nights={incoming.num_nights}
          highlight={action === 'import'}
        />
        <div className="flex-none self-center text-slate-300 font-bold text-lg select-none">↔</div>
        <BookingMiniCard
          label={isDb ? 'Ya en base de datos' : `Opción B`}
          code={opponent.confirmation_code}
          guest={opponent.guest_name}
          start={opponent.start_date}
          end={opponent.end_date}
          nights={opponent.num_nights}
          highlight={action === 'import_opponent'}
        />
      </div>

      {/* Resolution */}
      {isDb ? (
        /* with_db: just decide whether to import the incoming booking */
        <div className="flex gap-2">
          <button
            onClick={() => onChange('skip')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
              action === 'skip'
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-600'
            }`}
          >
            ✗ Saltar (no importar)
          </button>
          <button
            onClick={() => onChange('import')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
              action === 'import'
                ? 'bg-green-600 text-white border-green-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-green-300 hover:text-green-600'
            }`}
          >
            ✓ Importar de todas formas
          </button>
        </div>
      ) : (
        /* within_file: choose which one to keep (or skip both) */
        <div>
          <p className="text-xs text-slate-500 mb-2 text-center">¿Cuál reserva quieres importar?</p>
          <div className="flex gap-2">
            <button
              onClick={() => onChange('import')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
                action === 'import'
                  ? 'bg-green-600 text-white border-green-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-green-300 hover:text-green-600'
              }`}
            >
              ✓ {incoming.confirmation_code}
            </button>
            <button
              onClick={() => onChange('import_opponent')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
                action === 'import_opponent'
                  ? 'bg-green-600 text-white border-green-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-green-300 hover:text-green-600'
              }`}
            >
              ✓ {opponent.confirmation_code}
            </button>
            <button
              onClick={() => onChange('skip')}
              className={`flex-none px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                action === 'skip'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-rose-300 hover:text-rose-600'
              }`}
            >
              ✗ Saltar ambas
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function ConflictResolver({ conflicts, allBookings, onResolve, onBack }: Props) {
  const [resolutions, setResolutions] = useState<ConflictResolutions>(() => {
    const r: ConflictResolutions = {};
    for (const c of conflicts) {
      r[c.incoming.confirmation_code] = 'skip';
    }
    return r;
  });

  const setAll = (action: ConflictAction) => {
    setResolutions(() => {
      const r: ConflictResolutions = {};
      for (const c of conflicts) r[c.incoming.confirmation_code] = action;
      return r;
    });
  };

  const setOne = (code: string, action: ConflictAction) =>
    setResolutions(prev => ({ ...prev, [code]: action }));

  const fileConflicts = useMemo(() => conflicts.filter(c => c.type === 'within_file'), [conflicts]);
  const dbConflicts = useMemo(() => conflicts.filter(c => c.type === 'with_db'), [conflicts]);

  const resolvedCount = Object.values(resolutions).filter(v => v !== 'skip').length;
  const skipCount = conflicts.length - resolvedCount;

  const handleContinue = () => {
    // Build the set of codes to exclude from the final import
    const codesToSkip = new Set<string>();
    for (const c of conflicts) {
      const resolution = resolutions[c.incoming.confirmation_code] ?? 'skip';
      if (c.type === 'within_file') {
        const opCode = c.opponent.confirmation_code;
        if (resolution === 'skip') {
          codesToSkip.add(c.incoming.confirmation_code);
          codesToSkip.add(opCode);
        } else if (resolution === 'import') {
          // Keep incoming, skip opponent
          codesToSkip.add(opCode);
        } else if (resolution === 'import_opponent') {
          // Keep opponent, skip incoming
          codesToSkip.add(c.incoming.confirmation_code);
        }
      } else {
        // with_db: only the incoming booking is in play
        if (resolution === 'skip') {
          codesToSkip.add(c.incoming.confirmation_code);
        }
      }
    }
    const kept = allBookings.filter(b => !codesToSkip.has(b.confirmation_code));
    onResolve(kept);
  };

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl flex-none mt-0.5">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-900">
              {conflicts.length} conflicto{conflicts.length > 1 ? 's' : ''} de fechas detectado{conflicts.length > 1 ? 's' : ''}
            </p>
            <p className="text-sm text-amber-700 mt-0.5 leading-relaxed">
              {[
                fileConflicts.length > 0 && `${fileConflicts.length} dentro del archivo (elige cuál importar)`,
                dbConflicts.length > 0 && `${dbConflicts.length} con reservas ya guardadas`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => setAll('skip')}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 transition-colors font-medium"
          >
            Saltar todos
          </button>
          <button
            onClick={() => setAll('import')}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 transition-colors font-medium"
          >
            Importar todos de todas formas
          </button>
        </div>
      </div>

      {/* Within-file conflicts */}
      {fileConflicts.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-0.5">
            📁 Dentro del archivo ({fileConflicts.length})
          </p>
          {fileConflicts.map(c => (
            <ConflictCard
              key={c.id}
              conflict={c}
              action={resolutions[c.incoming.confirmation_code] ?? 'skip'}
              onChange={a => setOne(c.incoming.confirmation_code, a)}
            />
          ))}
        </section>
      )}

      {/* DB conflicts */}
      {dbConflicts.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-0.5">
            🗄️ Vs. base de datos ({dbConflicts.length})
          </p>
          {dbConflicts.map(c => (
            <ConflictCard
              key={c.id}
              conflict={c}
              action={resolutions[c.incoming.confirmation_code] ?? 'skip'}
              onChange={a => setOne(c.incoming.confirmation_code, a)}
            />
          ))}
        </section>
      )}

      {/* Footer */}
      <div className="border-t pt-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-green-600">{resolvedCount}</span> conflictos resueltos ·{' '}
          <span className="font-semibold text-slate-400">{skipCount}</span> se saltarán
        </p>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            ← Atrás
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleContinue}
            className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Continuar con importación →
          </motion.button>
        </div>
      </div>
    </div>
  );
}

