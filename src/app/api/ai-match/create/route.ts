import { NextResponse } from "next/server";
import { getAuthedUser, jsonError } from "@/lib/api";

export async function POST(request: Request) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const { data, error: rpcError } = await client.rpc("create_ai_match");
  if (rpcError || !Array.isArray(data) || !data[0]?.match_id) {
    return jsonError(rpcError?.message ?? "Failed to create AI match", 400);
  }

  return NextResponse.json({ match_id: data[0].match_id }, { status: 201 });
}

