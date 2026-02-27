import { NextResponse } from "next/server";
import { z } from "zod";

export const jsonError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export const parseBody = async <T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<{ success: true; data: z.infer<T> } | { success: false; response: NextResponse }> => {
  const json = await request.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { success: false, response: jsonError(parsed.error.issues[0]?.message ?? "Invalid request") };
  }
  return { success: true, data: parsed.data };
};

export const getAuthedUser = async (request: Request) => {
  const { createUserSupabaseFromRequest } = await import("@/lib/supabase/server");
  const client = createUserSupabaseFromRequest(request);
  if (!client) {
    return { error: jsonError("Missing bearer token", 401), client: null, user: null };
  }
  const {
    data: { user },
    error
  } = await client.auth.getUser();
  if (error || !user) {
    return { error: jsonError("Unauthorized", 401), client: null, user: null };
  }
  return { error: null, client, user };
};

export const getAuthedClient = async (request: Request) => {
  const { createUserSupabaseFromRequest } = await import("@/lib/supabase/server");
  const client = createUserSupabaseFromRequest(request);
  if (!client) {
    return { error: jsonError("Missing bearer token", 401), client: null };
  }
  return { error: null, client };
};
