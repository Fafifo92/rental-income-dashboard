import { supabase } from '@/lib/supabase/client';
import type {
  UserNotificationSettingsRow,
  NotificationCadence,
} from '@/types/database';
import type { ServiceResult } from './expenses';

export const DEFAULT_NOTIFICATION_SETTINGS: Omit<UserNotificationSettingsRow, 'user_id' | 'updated_at'> = {
  reminders_enabled:   true,
  email_enabled:       false,   // email OFF por defecto (feature-flag hasta integrar Resend)
  lead_days:           5,
  repeat_cadence:      'daily',
  send_hour:           8,
  notify_recurring:    true,
  notify_maintenance:  true,
  notify_shared_bills: true,
  notify_damage:       true,
  notify_cleaner:      true,
  timezone:            'America/Bogota',
};

/** Obtiene (o crea por defecto) la configuración del usuario autenticado. */
export const getNotificationSettings = async (): Promise<ServiceResult<UserNotificationSettingsRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (data) return { data, error: null };

  // Crear defaults la primera vez
  const { data: inserted, error: insErr } = await supabase
    .from('user_notification_settings')
    .insert({ user_id: user.id, ...DEFAULT_NOTIFICATION_SETTINGS })
    .select()
    .single();
  if (insErr) return { data: null, error: insErr.message };
  return { data: inserted, error: null };
};

export type NotificationSettingsPatch = Partial<Omit<UserNotificationSettingsRow, 'user_id' | 'updated_at'>>;

export const updateNotificationSettings = async (
  patch: NotificationSettingsPatch,
): Promise<ServiceResult<UserNotificationSettingsRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('user_notification_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const CADENCE_LABELS: Record<NotificationCadence, string> = {
  daily:          'Todos los días',
  every_2_days:   'Cada 2 días',
  weekly:         'Una vez por semana',
};
