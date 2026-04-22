import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient<Database>(url, key);

