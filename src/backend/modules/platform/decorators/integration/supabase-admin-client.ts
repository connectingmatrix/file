import { createClient } from '@supabase/supabase-js';
import { EnvLoader } from '@giga/shared/lib/env';
import { supabaseFetch } from '@giga/shared/lib/supabase-fetch';
import '@giga/shared/lib/supabase-websocket';

const serviceRoleKey = EnvLoader.get('SUPABASE_SERVICE_ROLE_KEY') || EnvLoader.getOrThrow('SUPABASE_SERVICE_ROLE');

export const SupabaseClientAdmin = () =>
  createClient(EnvLoader.getOrThrow('SUPABASE_URL'), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: supabaseFetch },
  });
