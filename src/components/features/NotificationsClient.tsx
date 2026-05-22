import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';
import {
  getNotificationSettings,
  updateNotificationSettings,
  CADENCE_LABELS,
} from '@/services/notificationSettings';
import type { UserNotificationSettingsRow, NotificationCadence } from '@/types/database';
import { COMMON_TIMEZONES, setCachedTimezone } from '@/lib/dateUtils';

export default function NotificationsClient() {
  const authStatus = useAuth(true);
  const [settings, setSettings] = useState<UserNotificationSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    (async () => {
      const res = await getNotificationSettings();
      if (res.error) setError(res.error);
      else if (res.data) {
        setSettings(res.data);
        // Sincronizar timezone al localStorage para que todayISO() lo use de inmediato
        if (res.data.timezone) setCachedTimezone(res.data.timezone);
      }
      setLoading(false);
    })();
  }, [authStatus]);

  const patch = async (key: keyof UserNotificationSettingsRow, value: unknown) => {
    if (!settings) return;
    setSavingKey(String(key));
    const optimistic = { ...settings, [key]: value } as UserNotificationSettingsRow;
    setSettings(optimistic);
    // Si cambia la timezone, actualizar caché de localStorage al instante
    if (key === 'timezone' && typeof value === 'string') setCachedTimezone(value);
    const res = await updateNotificationSettings({ [key]: value });
    if (res.error) {
      setError(res.error);
      setSettings(settings); // rollback
    } else {
      setSettings(res.data);
      setSavedAt(Date.now());
    }
    setSavingKey(null);
  };

  if (authStatus === 'checking' || loading) {
    return <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />;
  }

  if (error || !settings) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
        {error ?? 'No se pudo cargar la configuración.'}
      </div>
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Notificaciones</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Configura cómo y cuándo recibir recordatorios de tus obligaciones mensuales.
        </p>
        {savedAt && (
          <p key={savedAt} className="text-xs text-emerald-600 mt-2 animate-pulse">✓ Guardado</p>
        )}
      </motion.div>

      <div className="space-y-6">
        {/* Configuración regional */}
        <Section title="Configuración regional" subtitle="Afecta los cálculos de fechas y alertas en toda la app.">
          <div className="space-y-1 p-4">
            <LabeledField label={<span className="flex items-center gap-1.5"><Globe size={14} className="text-slate-500" />Zona horaria</span>}>
              <select
                value={settings.timezone ?? 'America/Bogota'}
                onChange={e => patch('timezone', e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-[240px]"
                disabled={savingKey === 'timezone'}
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              {savingKey === 'timezone' && (
                <span className="text-xs text-slate-400 ml-2 animate-pulse">Guardando…</span>
              )}
            </LabeledField>
            <p className="text-xs text-slate-400 mt-2">
              Determina qué se considera "hoy" al registrar reservas, calcular estados y mostrar alertas.
              La hora actual en tu zona: <span className="font-medium text-slate-600">
                {new Intl.DateTimeFormat('es-CO', { timeZone: settings.timezone ?? 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}
              </span>
            </p>
          </div>
        </Section>

        {/* Canales */}
        <Section title="Canales de entrega">
          <ToggleRow
            label="Recordatorios en la app"
            description="Badge en la campana del menú con los pagos pendientes."
            checked={settings.reminders_enabled}
            saving={savingKey === 'reminders_enabled'}
            onChange={v => patch('reminders_enabled', v)}
          />
          <ToggleRow
            label="Recordatorios por email"
            description="Próximamente: envío automático a tu correo con un resumen diario."
            checked={settings.email_enabled}
            saving={false}
            disabled
            badge="Próximamente"
            onChange={() => {}}
          />
        </Section>

        {/* Cadencia */}
        <Section title="Cuándo avisar" subtitle="Aplica a todas las categorías activadas abajo.">
          <div className="space-y-4 p-4">
            <LabeledField label="Días de anticipación">
              <input
                type="number" min={0} max={30}
                value={settings.lead_days}
                onChange={e => patch('lead_days', Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <span className="text-xs text-slate-500 ml-2">
                días antes de la fecha sugerida
              </span>
            </LabeledField>

            <LabeledField label="Cadencia">
              <select
                value={settings.repeat_cadence}
                onChange={e => patch('repeat_cadence', e.target.value as NotificationCadence)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {(Object.keys(CADENCE_LABELS) as NotificationCadence[]).map(k => (
                  <option key={k} value={k}>{CADENCE_LABELS[k]}</option>
                ))}
              </select>
              <span className="text-xs text-slate-500 ml-2">hasta resolver el pendiente</span>
            </LabeledField>

            <LabeledField label="Hora del día">
              <input
                type="number" min={0} max={23}
                value={settings.send_hour}
                onChange={e => patch('send_hour', Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="w-20 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <span className="text-xs text-slate-500 ml-2">h (formato 24h, hora local)</span>
            </LabeledField>
          </div>
        </Section>

        {/* Categorías */}
        <Section title="Categorías que quiero ver" subtitle="Activa o silencia tipos específicos.">
          <ToggleRow
            label="Gastos recurrentes"
            description="Administración, internet, servicios, seguros…"
            checked={settings.notify_recurring}
            saving={savingKey === 'notify_recurring'}
            onChange={v => patch('notify_recurring', v)}
          />
          <ToggleRow
            label="Mantenimientos programados"
            description="Rutinas de mantenimiento con fecha de próximo vencimiento."
            checked={settings.notify_maintenance}
            saving={savingKey === 'notify_maintenance'}
            onChange={v => patch('notify_maintenance', v)}
          />
          <ToggleRow
            label="Facturas compartidas"
            description="Cuando una factura no se ha distribuido entre todas las propiedades."
            checked={settings.notify_shared_bills}
            saving={savingKey === 'notify_shared_bills'}
            onChange={v => patch('notify_shared_bills', v)}
          />
          <ToggleRow
            label="Cobros por daño"
            description="Daños cargados al huésped que aún no se han resuelto contra costo real."
            checked={settings.notify_damage}
            saving={savingKey === 'notify_damage'}
            onChange={v => patch('notify_damage', v)}
          />
          <ToggleRow
            label="Aseos por liquidar"
            description="Aseos terminados sin pagar a la persona encargada."
            checked={settings.notify_cleaner}
            saving={savingKey === 'notify_cleaner'}
            onChange={v => patch('notify_cleaner', v)}
          />
        </Section>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>Nota:</strong> las notificaciones por email se habilitarán cuando conectemos el
          servicio de envío. Mientras tanto, la campana en el menú superior muestra siempre tus
          pendientes en tiempo real.
        </div>
      </div>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange, saving, disabled, badge,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  saving?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-3.5 ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">{label}</span>
          {badge && (
            <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || saving}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-slate-200'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function LabeledField({ label, children }: { label: string | ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-slate-700 w-44">{label}</label>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
