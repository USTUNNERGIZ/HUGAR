
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export async function verifyPassword(
  email: string,
  password: string,
  expectedUserId: string
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || !email || !password || !expectedUserId) {
    return false;
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  return (
    !error &&
    !!data.session &&
    data.user?.id === expectedUserId
  );
}
