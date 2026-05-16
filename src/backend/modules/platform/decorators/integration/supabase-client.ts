import { createClient } from '@supabase/supabase-js';
import { EnvLoader } from '@giga/shared/lib/env';
import { decodeDashedAccessToken, tokenExtractor } from '@giga/shared/lib/helper';
import { supabaseFetch } from '@giga/shared/lib/supabase-fetch';
import { readAppAccessToken } from '@giga/permissions/services/auth/app-auth-token';
import { markLifecycle } from '@connectingmatrix/logger/lifecycle-jsonl';
import { SupabaseClientAdmin } from './supabase-admin-client';
import { createUserSupabaseClient } from './user-supabase-client';

export const SupabaseClient = async (request) => {
  const lifecycleState = request?.lifecycleState;
  if (lifecycleState) {
    markLifecycle(lifecycleState, { layer: 'supabase.client', event: 'supabase.client.init', phase: 'start', transport: 'graphql' });
  }
  try {
    const tokenData = tokenExtractor(request);
    const { access_token, refresh_token } = tokenData;
    const appUser = readAppAccessToken(access_token);
    if (appUser?.sub) {
      const client = SupabaseClientAdmin();
      (client as any).__auth_user_id = appUser.sub;
      (client as any).__access_token = access_token;
      if (lifecycleState) {
        markLifecycle(lifecycleState, {
          layer: 'supabase.client',
          event: 'supabase.client.init',
          phase: 'end',
          transport: 'graphql',
          status: 'passed',
          meta: { mode: 'admin-app-user' },
        });
      }
      return client;
    }
    const dashedUserId = decodeDashedAccessToken(access_token);

    if (dashedUserId) {
      const client = SupabaseClientAdmin();
      (client as any).__auth_user_id = dashedUserId;
      (client as any).__access_token = access_token;
      if (lifecycleState) {
        markLifecycle(lifecycleState, {
          layer: 'supabase.client',
          event: 'supabase.client.init',
          phase: 'end',
          transport: 'graphql',
          status: 'passed',
          meta: { mode: 'admin-dashed-user' },
        });
      }
      return client;
    }

    if (!access_token || access_token === 'undefined') {
      if (lifecycleState) {
        markLifecycle(lifecycleState, {
          layer: 'supabase.client',
          event: 'supabase.client.init',
          phase: 'end',
          transport: 'graphql',
          status: 'passed',
          meta: { mode: 'anon' },
        });
      }
      return createClient(EnvLoader.getOrThrow('SUPABASE_URL'), EnvLoader.getOrThrow('SUPABASE_ANON_KEY'), {
        global: { fetch: supabaseFetch },
      });
    }

    const client = createUserSupabaseClient(access_token);

    if (access_token && access_token !== 'undefined' && refresh_token && refresh_token !== 'undefined') {
      try {
        const { error } = await client.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          console.warn('Failed to set session:', error.message);
        }
      } catch (sessionError) {
        console.warn('Session setup error:', sessionError);
      }
    }
    if (lifecycleState) {
      markLifecycle(lifecycleState, {
        layer: 'supabase.client',
        event: 'supabase.client.init',
        phase: 'end',
        transport: 'graphql',
        status: 'passed',
        meta: { mode: 'user' },
      });
    }

    return client;
  } catch (error) {
    if (lifecycleState) {
      markLifecycle(lifecycleState, {
        layer: 'supabase.client',
        event: 'supabase.client.init',
        phase: 'error',
        transport: 'graphql',
        status: 'failed',
      });
    }
    throw error;
  }
};
