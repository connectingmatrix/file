import { createClient } from '@supabase/supabase-js';
import { EnvLoader } from '@giga/shared/lib/env';
import { readSupabaseAccessTokenSubject } from '@giga/shared/lib/helper';
import { supabaseFetch } from '@giga/shared/lib/supabase-fetch';

export const createUserSupabaseClient = (accessToken: string) => {
  const client = createClient(EnvLoader.getOrThrow('SUPABASE_URL'), EnvLoader.getOrThrow('SUPABASE_ANON_KEY'), {
    global: {
      fetch: supabaseFetch,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  (client as any).__access_token = accessToken;
  (client as any).__auth_user_id = readSupabaseAccessTokenSubject(accessToken) || undefined;
  return client;
};
