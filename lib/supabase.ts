import {createClient, SupabaseClient} from '@supabase/supabase-js';
export function getSupabase(): SupabaseClient | null {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 return url&&key&&!url.includes('YOUR_PROJECT')?createClient(url,key):null;
}
