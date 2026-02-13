import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client using the service_role key.
 * This bypasses RLS, which is necessary because the processing service
 * updates job statuses on behalf of users.
 *
 * IMPORTANT: Only use this in the server-side processing service.
 * Never expose the service_role key to the frontend.
 */
export function getSupabaseServiceClient(): SupabaseClient {
    if (!serviceClient) {
        const url = process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !serviceRoleKey) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        }

        serviceClient = createClient(url, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }

    return serviceClient;
}
