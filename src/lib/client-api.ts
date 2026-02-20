"use client";

import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

const REQUEST_FAILED_MSG = "Request failed";
const GATEWAY_FAILED_MSG = "Network gateway error. Please retry.";

const getAccessToken = async (): Promise<string> => {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Login required");
  }
  return session.access_token;
};

const readErrorMessage = async (res: Response): Promise<string> => {
  const text = await res.text().catch(() => "");
  if (!text) return REQUEST_FAILED_MSG;

  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // non-json response body
  }

  const lower = text.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("bad gateway")
  ) {
    return GATEWAY_FAILED_MSG;
  }
  return REQUEST_FAILED_MSG;
};

const readJsonOrNull = async <T>(res: Response): Promise<T | null> => {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }

  const parsed = await readJsonOrNull<T>(res);
  return (parsed ?? ({} as T)) as T;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const token = await getAccessToken();
  const res = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }

  const parsed = await readJsonOrNull<T>(res);
  return (parsed ?? ({} as T)) as T;
};
