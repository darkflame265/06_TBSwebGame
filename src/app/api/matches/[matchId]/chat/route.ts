import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});

const postBodySchema = z.object({
  message: z.string().trim().min(1).max(300)
});

type Context = {
  params: Promise<{ matchId: string }>;
};

const ensureMembership = async (
  client: Awaited<ReturnType<typeof getAuthedUser>>["client"],
  matchId: string,
  userId: string
) => {
  if (!client) return false;
  const { data, error } = await client
    .from("match_players")
    .select("user_id")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
};

export async function GET(request: Request, context: Context) {
  const { error, client, user } = await getAuthedUser(request);
  if (error || !client || !user) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return jsonError("Invalid match id", 400);
  }
  const { matchId } = parsedParams.data;

  const isMember = await ensureMembership(client, matchId, user.id);
  if (!isMember) {
    return jsonError("You are not part of this match", 403);
  }

  const { data: rows, error: chatError } = await client
    .from("match_chat_messages")
    .select("id,match_id,user_id,message,created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (chatError) {
    return jsonError(chatError.message, 400);
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const nicknameMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await client
      .from("user_profiles")
      .select("user_id,nickname")
      .in("user_id", userIds);
    if (profileError) {
      return jsonError(profileError.message, 400);
    }
    for (const profile of profiles ?? []) {
      nicknameMap.set(profile.user_id, profile.nickname ?? null);
    }
  }

  return NextResponse.json(
    (rows ?? []).map((row) => ({
      ...row,
      nickname: nicknameMap.get(row.user_id) ?? null
    }))
  );
}

export async function POST(request: Request, context: Context) {
  const { error, client, user } = await getAuthedUser(request);
  if (error || !client || !user) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return jsonError("Invalid match id", 400);
  }
  const { matchId } = parsedParams.data;

  const isMember = await ensureMembership(client, matchId, user.id);
  if (!isMember) {
    return jsonError("You are not part of this match", 403);
  }

  const body = await parseBody(request, postBodySchema);
  if (!body.success) return body.response;

  const { data, error: insertError } = await client
    .from("match_chat_messages")
    .insert({
      match_id: matchId,
      user_id: user.id,
      message: body.data.message
    })
    .select("id,match_id,user_id,message,created_at")
    .single();

  if (insertError || !data) {
    return jsonError(insertError?.message ?? "Failed to send message", 400);
  }

  const { data: profile } = await client
    .from("user_profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json(
    {
      ...data,
      nickname: profile?.nickname ?? null
    },
    { status: 201 }
  );
}
