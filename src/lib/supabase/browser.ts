"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export const getBrowserSupabaseClient = () => {
  if (browserClient) {
    return browserClient;
  }
  browserClient = createBrowserClient(clientEnv.supabaseUrl, clientEnv.supabaseAnonKey);
  return browserClient;
};
