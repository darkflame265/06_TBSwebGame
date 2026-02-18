"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchResponse } from "@/types/api";

type Props = {
  matchId: string;
};

type Coord = [number, number];

const BOARD_SIZE = 7;

const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];

const isOrthogonalStep = (from: Coord, to: Coord) =>
  Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1;

export function MatchClient({ matchId }: Props) {
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [plannedPath, setPlannedPath] = useState<Coord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

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
      setMessage(error instanceof Error ? error.message : "Failed to load match");
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
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      loadMatch();
    }, 2000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const channel = supabase
      .channel(`match-stream-${matchId}`)
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`
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

  useEffect(() => {
    setPlannedPath([]);
  }, [match?.current_turn]);

  const leaveMatch = async () => {
    setMessage(null);
    if (match?.status === "finished") {
      router.push("/");
      return;
    }

    setLeaving(true);
    try {
      await apiPost(`/api/matches/${matchId}/leave`);
      router.push("/");
    } catch (error) {
      setLeaving(false);
      setMessage(error instanceof Error ? error.message : "Failed to leave match");
    }
  };

  if (!match) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <p>Loading match data...</p>
        {message && <p className="mt-3 text-red-700">{message}</p>}
      </main>
    );
  }

  const boardState = match.board_state ?? { p1: [0, 3] as Coord, p2: [6, 3] as Coord };
  const myPos: Coord | null = mySlot === 1 ? boardState.p1 : mySlot === 2 ? boardState.p2 : null;
  const maxPoints = Math.min(match.current_turn, 10);
  const mySubmitted =
    mySlot !== null &&
    match.turns.some((t) => t.turn_number === match.current_turn && t.player_slot === mySlot);
  const canPlan = match.status === "active" && mySlot !== null && !mySubmitted;
  const deadlineMs = match.planning_ends_at ? new Date(match.planning_ends_at).getTime() : nowMs;
  const secondsLeft = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const opponentLeft =
    match.status === "finished" &&
    match.ended_reason === "player_left" &&
    match.left_by !== null &&
    match.left_by !== me;

  const onCellClick = (x: number, y: number) => {
    if (!canPlan || !myPos) {
      return;
    }
    if (plannedPath.length >= maxPoints) {
      return;
    }
    const next: Coord = [x, y];
    const from = plannedPath.length > 0 ? plannedPath[plannedPath.length - 1] : myPos;
    if (!isOrthogonalStep(from, next)) {
      return;
    }
    setPlannedPath((prev) => [...prev, next]);
  };

  const undoPath = () => {
    setPlannedPath((prev) => prev.slice(0, -1));
  };

  const clearPath = () => {
    setPlannedPath([]);
  };

  const submitPath = async () => {
    if (!canPlan) {
      return;
    }
    try {
      setMessage(null);
      await apiPost(`/api/matches/${matchId}/turns`, { action: { path: plannedPath } });
      setPlannedPath([]);
      await loadMatch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to submit path");
    }
  };

  const pathIndexByCell = new Map<string, number>();
  plannedPath.forEach((c, idx) => {
    pathIndexByCell.set(`${c[0]},${c[1]}`, idx + 1);
  });

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Match {match.id}</h1>
        <button
          onClick={leaveMatch}
          disabled={leaving}
          className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {leaving ? "Leaving..." : match.status === "finished" ? "Back to lobby" : "Leave match"}
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-600">
        Status: {match.status} | Round: {match.current_turn} | Max path points: {maxPoints} | Planning time left:{" "}
        {secondsLeft}s
      </p>

      {opponentLeft && (
        <p className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-800">상대방이 게임에서 나갔습니다.</p>
      )}

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Board 7x7</h2>
        <p className="mt-1 text-sm text-slate-600">
          시작점: Slot1 (0,3), Slot2 (6,3). 대각선 이동 불가. 이번 라운드 최대 경로 길이: {maxPoints}
        </p>

        <div className="mt-3 grid grid-cols-7 gap-1 rounded-lg bg-slate-200 p-2">
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }).map((_, idx) => {
            const x = idx % BOARD_SIZE;
            const y = Math.floor(idx / BOARD_SIZE);
            const here: Coord = [x, y];
            const isP1 = sameCoord(boardState.p1, here);
            const isP2 = sameCoord(boardState.p2, here);
            const isMyPos = myPos ? sameCoord(myPos, here) : false;
            const pathOrder = pathIndexByCell.get(`${x},${y}`);

            return (
              <button
                key={`${x}-${y}`}
                onClick={() => onCellClick(x, y)}
                className={`h-14 rounded border text-xs ${
                  isMyPos ? "border-blue-600 bg-blue-100" : "border-slate-300 bg-white"
                } ${canPlan ? "hover:bg-slate-100" : "cursor-default"}`}
                type="button"
              >
                <div className="font-mono text-[10px] text-slate-500">
                  ({x},{y})
                </div>
                <div className="font-semibold">
                  {isP1 && isP2 ? "P1/P2" : isP1 ? "P1" : isP2 ? "P2" : pathOrder ? `#${pathOrder}` : ""}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Path Planning</h2>
        <p className="mt-1 text-sm text-slate-600">
          {match.status !== "active"
            ? "Match ended."
            : mySubmitted
              ? "Path submitted. Waiting for opponent or timer."
              : "Click adjacent cells to build your path."}
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitPath}
            disabled={!canPlan}
            className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Submit path
          </button>
          <button
            type="button"
            onClick={undoPath}
            disabled={!canPlan || plannedPath.length === 0}
            className="rounded-lg bg-slate-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clearPath}
            disabled={!canPlan || plannedPath.length === 0}
            className="rounded-lg bg-slate-500 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Clear
          </button>
        </div>

        <pre className="mt-3 rounded bg-slate-100 p-2 text-xs">
          {JSON.stringify({ path: plannedPath }, null, 2)}
        </pre>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Round Logs</h2>
        <ul className="mt-2 max-h-[300px] space-y-2 overflow-auto">
          {match.turns.map((turn) => (
            <li key={turn.id} className="rounded-lg bg-slate-100 p-2 font-mono text-xs">
              <div>
                round={turn.turn_number}, slot={turn.player_slot}, created_by={turn.created_by}
              </div>
              <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(turn.action_payload, null, 2)}</pre>
            </li>
          ))}
          {match.turns.length === 0 && <li className="text-sm text-slate-500">No paths submitted yet.</li>}
        </ul>
      </section>

      {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
    </main>
  );
}
