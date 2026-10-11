// Public browser config. These values are safe to expose because the frontend only
// uses the Supabase publishable key; privileged writes stay inside Edge Functions.
export const SUPABASE_URL = 'https://jvgnpffouipxjrewbgch.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Pc7LhijgWqm7HI7HIVXCfQ_honDlM7Z';
export const ADMIN_API_BASE_URL = `${SUPABASE_URL}/functions/v1/admin-api`;
