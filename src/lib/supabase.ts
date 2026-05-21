import { createClient } from '@supabase/supabase-js'

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://dummy-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy_key'

// Remove the /rest/v1 suffix if the user accidentally copied it
if (supabaseUrl.endsWith('/rest/v1/') || supabaseUrl.endsWith('/rest/v1')) {
  supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
