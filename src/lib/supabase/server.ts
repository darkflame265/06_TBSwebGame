import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

const getBearerToken = (authorization: string | null): string | null => {
  if (!authorization) {
    return null;
  }
  const [type, token] = authorization.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
};

export const createUserSupabaseFromRequest = (request: Request) => {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return null;
  }
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
};

export const createAdminSupabase = () => {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};
