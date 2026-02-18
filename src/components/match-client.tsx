"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchResponse } from "@/types/api";

type Props = {
  matchId: string;
};

export function MatchClient({ matchId }: Props) {
  const supabase = getBrowserSupabaseClient();
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [actionText, setActionText] = useState('{"type":"END_TURN"}');
  const [message, setMessage] = useState<string | null>(null);

  const mySlot = useMemo(() => {
    if (!match || !me) {
      return null;
    }
    return match.players.find((p) => p.user_id === me)?.slot ?? null;
  }, [match, me]);

  const loadMatch = async () => {
    try {
      const data = await apiGet<MatchResponse>(`/api/matches/${matchId}`);
      setMatch(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "매치 조회 실패");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMe(data.user?.id ?? null);
    });
    loadMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const channel = supabase
      .channel(`turn-stream-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "turns",
          filter: `match_id=eq.${matchId}`
        },
        () => {
          loadMatch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const submitTurn = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    let action: Record<string, unknown>;
    try {
      action = JSON.parse(actionText);
    } catch {
      setMessage("JSON 형식이 잘못되었습니다.");
      return;
    }

    try {
      await apiPost(`/api/matches/${matchId}/turns`, { action });
      setActionText('{"type":"END_TURN"}');
      await loadMatch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "턴 제출 실패");
    }
  };

  if (!match) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl p-6">
        <p>매치 정보를 불러오는 중...</p>
        {message && <p className="mt-3 text-red-700">{message}</p>}
      </main>
    );
  }

  const isMyTurn = mySlot !== null && mySlot === match.current_player_slot;

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <h1 className="text-3xl font-bold">Match {match.id}</h1>
      <p className="mt-2 text-sm text-slate-600">
        상태: {match.status} | 현재 턴: {match.current_turn} | 현재 플레이어 슬롯:{" "}
        {match.current_player_slot}
      </p>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">플레이어</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {match.players.map((player) => (
            <li key={player.user_id} className="rounded bg-slate-100 px-2 py-1">
              슬롯 {player.slot}: {player.user_id}
              {player.user_id === me ? " (나)" : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">행동 제출</h2>
        <p className="mt-1 text-sm text-slate-600">
          {isMyTurn ? "내 턴입니다." : "상대 턴입니다."}
        </p>
        <form className="mt-3" onSubmit={submitTurn}>
          <textarea
            className="h-28 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
            value={actionText}
            onChange={(e) => setActionText(e.target.value)}
          />
          <button
            type="submit"
            disabled={!isMyTurn || match.status !== "active"}
            className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            턴 제출
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">턴 로그</h2>
        <ul className="mt-2 max-h-[360px] space-y-2 overflow-auto">
          {match.turns.map((turn) => (
            <li key={turn.id} className="rounded-lg bg-slate-100 p-2 font-mono text-xs">
              <div>
                turn={turn.turn_number}, slot={turn.player_slot}, created_by={turn.created_by}
              </div>
              <pre className="mt-1 whitespace-pre-wrap">
                {JSON.stringify(turn.action_payload, null, 2)}
              </pre>
            </li>
          ))}
          {match.turns.length === 0 && <li className="text-sm text-slate-500">아직 제출된 턴이 없습니다.</li>}
        </ul>
      </section>

      {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
    </main>
  );
}
