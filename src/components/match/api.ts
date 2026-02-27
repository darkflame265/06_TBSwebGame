import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchChatMessage, MatchResponse } from "@/types/api";
import type { Coord } from "@/components/match/types";

type CreateAiMatchResponse = {
  match_id: string;
};

type RequestRematchResponse = {
  status: "waiting" | "started";
  match_id?: string;
};

export async function fetchMatch(matchId: string) {
  return apiGet<MatchResponse>(`/api/matches/${matchId}?view=live`);
}

export async function ackMatchResolve(matchId: string, turn: number) {
  return apiPost(`/api/matches/${matchId}/resolve-ack`, { turn });
}

export async function tickMatch(matchId: string) {
  return apiPost<MatchResponse>(`/api/matches/${matchId}?view=live`);
}

export async function fetchMatchChat(matchId: string) {
  return apiGet<MatchChatMessage[]>(`/api/matches/${matchId}/chat`);
}

export async function submitMatchPath(
  matchId: string,
  round: number,
  path: Coord[],
) {
  return apiPost(`/api/matches/${matchId}/turns`, {
    round,
    action: { path },
  });
}

export async function createAiMatch() {
  return apiPost<CreateAiMatchResponse>("/api/ai-match/create");
}

export async function requestMatchRematch(matchId: string) {
  return apiPost<RequestRematchResponse>(`/api/matches/${matchId}/rematch`);
}

export async function leaveMatch(matchId: string) {
  return apiPost(`/api/matches/${matchId}/leave`);
}

export async function sendMatchChat(matchId: string, message: string) {
  return apiPost(`/api/matches/${matchId}/chat`, { message });
}
