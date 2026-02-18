"use client";

import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

const getAccessToken = async (): Promise<string> => {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }
  return session.access_token;
};

export const apiPost = async <T>(path: string, body?: unknown): Promise<T> => {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? "요청 실패");
  }
  return json as T;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const token = await getAccessToken();
  const res = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? "요청 실패");
  }
  return json as T;
};
