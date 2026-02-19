import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";

const bodySchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(2, "Nickname must be at least 2 characters")
    .max(24, "Nickname must be at most 24 characters")
});

export async function GET(request: Request) {
  const { error, client, user } = await getAuthedUser(request);
  if (error || !client || !user) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const { data, error: profileError } = await client
    .from("user_profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return jsonError(profileError.message, 400);
  }

  return NextResponse.json({ nickname: data?.nickname ?? null });
}

export async function POST(request: Request) {
  const { error, client, user } = await getAuthedUser(request);
  if (error || !client || !user) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const parsed = await parseBody(request, bodySchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const nickname = parsed.data.nickname;

  const { data, error: upsertError } = await client
    .from("user_profiles")
    .upsert(
      {
        user_id: user.id,
        nickname,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    )
    .select("nickname")
    .single();

  if (upsertError) {
    return jsonError(upsertError.message, 400);
  }

  return NextResponse.json({ nickname: data.nickname });
}

