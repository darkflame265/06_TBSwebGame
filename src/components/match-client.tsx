"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchResponse } from "@/types/api";

type Props = {
  matchId: string;
};

type Coord = [number, number]; // [row, col]
type DisplayBoard = {
  p1: Coord;
  p2: Coord;
};

const BOARD_SIZE = 7;
const STEP_ANIMATION_MS = 300;

const DEFAULT_BOARD: DisplayBoard = {
  p1: [0, 3],
  p2: [6, 3]
};

const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
const isOrthogonalStep = (from: Coord, to: Coord) =>
  Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toPath = (payload: Record<string, unknown>): Coord[] => {
  const raw = payload.path;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Coord[] = [];
  for (const point of raw) {
    if (Array.isArray(point) && point.length === 2) {
      const row = Number(point[0]);
      const col = Number(point[1]);
      if (Number.isInteger(row) && Number.isInteger(col)) {
        out.push([row, col]);
      }
    }
  }
  return out;
};

export function MatchClient({ matchId }: Props) {
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [plannedPath, setPlannedPath] = useState<Coord[]>([]);
  const [displayBoard, setDisplayBoard] = useState<DisplayBoard>(DEFAULT_BOARD);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [draggingPath, setDraggingPath] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const prevMatchRef = useRef<MatchResponse | null>(null);
  const animatingRef = useRef(false);

  const mySlot = useMemo(() => {
    if (!match || !me) {
      return null;
    }
    return match.players.find((p) => p.user_id === me)?.slot ?? null;
  }, [match, me]);

  const animateRound = async (from: DisplayBoard, path1: Coord[], path2: Coord[]) => {
    const steps = Math.max(path1.length, path2.length);
    if (steps <= 0) {
      setDisplayBoard(from);
      return;
    }

    let p1 = from.p1;
    let p2 = from.p2;
    setAnimating(true);
    animatingRef.current = true;

    for (let i = 0; i < steps; i += 1) {
      if (i < path1.length) p1 = path1[i];
      if (i < path2.length) p2 = path2[i];
      setDisplayBoard({ p1, p2 });
      await sleep(STEP_ANIMATION_MS);
    }

    animatingRef.current = false;
    setAnimating(false);
  };

  const loadMatch = async () => {
    try {
      const data = await apiGet<MatchResponse>(`/api/matches/${matchId}`);
      const nextBoard = data.board_state ?? DEFAULT_BOARD;
      const prev = prevMatchRef.current;

      if (!prev) {
        setDisplayBoard(nextBoard);
      } else if (data.current_turn === prev.current_turn + 1 && prev.board_state && !animatingRef.current) {
        const resolvedRound = prev.current_turn;
        const p1Turn = data.turns.find((t) => t.turn_number === resolvedRound && t.player_slot === 1);
        const p2Turn = data.turns.find((t) => t.turn_number === resolvedRound && t.player_slot === 2);
        await animateRound(
          { p1: prev.board_state.p1, p2: prev.board_state.p2 },
          p1Turn ? toPath(p1Turn.action_payload) : [],
          p2Turn ? toPath(p2Turn.action_payload) : []
        );
      } else if (!animatingRef.current) {
        setDisplayBoard(nextBoard);
      }

      prevMatchRef.current = data;
      setMatch(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load match");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const p = setInterval(() => {
      loadMatch();
    }, 1500);
    return () => clearInterval(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const stopDragging = () => setDraggingPath(false);
    window.addEventListener("pointerup", stopDragging);
    return () => window.removeEventListener("pointerup", stopDragging);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`match-stream-${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "turns", filter: `match_id=eq.${matchId}` },
        () => loadMatch()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => loadMatch()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    setPlannedPath([]);
    setDraggingPath(false);
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

  const myPos: Coord | null = mySlot === 1 ? displayBoard.p1 : mySlot === 2 ? displayBoard.p2 : null;
  const currentEnd: Coord | null = myPos ? (plannedPath.length > 0 ? plannedPath[plannedPath.length - 1] : myPos) : null;
  const maxPoints = Math.min(match.current_turn, 10);
  const mySubmitted =
    mySlot !== null &&
    match.turns.some((t) => t.turn_number === match.current_turn && t.player_slot === mySlot);
  const canPlan = match.status === "active" && mySlot !== null && !mySubmitted && !animating;

  const deadlineMs = match.planning_ends_at ? new Date(match.planning_ends_at).getTime() : nowMs;
  const millisLeft = Math.max(0, deadlineMs - nowMs);
  const secondsLeft = (millisLeft / 1000).toFixed(1);
  const opponentLeft =
    match.status === "finished" &&
    match.ended_reason === "player_left" &&
    match.left_by !== null &&
    match.left_by !== me;
  const myColor = mySlot === 1 ? "Red" : mySlot === 2 ? "Blue" : "-";

  const beginPathDrag = (row: number, col: number) => {
    if (!canPlan || !currentEnd) {
      return;
    }
    if (currentEnd[0] !== row || currentEnd[1] !== col) {
      return;
    }
    setDraggingPath(true);
  };

  const extendOrRewindPath = (row: number, col: number) => {
    if (!draggingPath || !canPlan || !myPos) {
      return;
    }

    setPlannedPath((prev) => {
      const end = prev.length > 0 ? prev[prev.length - 1] : myPos;
      const target: Coord = [row, col];
      if (sameCoord(end, target)) {
        return prev;
      }

      const back = prev.length > 0 ? (prev.length > 1 ? prev[prev.length - 2] : myPos) : null;
      if (back && sameCoord(back, target)) {
        return prev.slice(0, -1);
      }

      if (!isOrthogonalStep(end, target)) {
        return prev;
      }
      if (prev.length >= maxPoints) {
        return prev;
      }
      return [...prev, target];
    });
  };

  const undoPath = () => setPlannedPath((prev) => prev.slice(0, -1));
  const clearPath = () => setPlannedPath([]);

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
  plannedPath.forEach((c, idx) => pathIndexByCell.set(`${c[0]},${c[1]}`, idx + 1));

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

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            Status: {match.status} | Round: {match.current_turn} | Piece: {myColor} | Max path points: {maxPoints}
          </p>
          <p className="font-mono text-sm font-semibold text-slate-900">Planning timer: {secondsLeft}s / 10.0s</p>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, (millisLeft / 10000) * 100))}%` }}
          />
        </div>
      </div>

      {opponentLeft && (
        <p className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-800">상대방이 게임에서 나갔습니다.</p>
      )}

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Board 7x7</h2>
        <p className="mt-1 text-sm text-slate-600">
          Coordinates are (row, col). Start points are Red(P1)=(0,3), Blue(P2)=(6,3).
        </p>
        <div className="mt-3 grid grid-cols-7 gap-1 rounded-lg bg-slate-200 p-2">
          {Array.from({ length: BOARD_SIZE }).map((_, row) =>
            Array.from({ length: BOARD_SIZE }).map((__, col) => {
              const here: Coord = [row, col];
              const isP1 = sameCoord(displayBoard.p1, here);
              const isP2 = sameCoord(displayBoard.p2, here);
              const isMyPos = myPos ? sameCoord(myPos, here) : false;
              const pathOrder = pathIndexByCell.get(`${row},${col}`);
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  onPointerDown={() => beginPathDrag(row, col)}
                  onPointerEnter={() => extendOrRewindPath(row, col)}
                  onPointerUp={() => setDraggingPath(false)}
                  className={`relative h-14 rounded border text-xs ${
                    isMyPos ? "border-blue-600 bg-blue-100" : "border-slate-300 bg-white"
                  } ${canPlan ? "hover:bg-slate-100" : "cursor-default"}`}
                >
                  <div className="absolute left-1 top-1 font-mono text-[10px] text-slate-500">
                    ({row},{col})
                  </div>
                  {pathOrder && !isP1 && !isP2 && (
                    <div className="absolute right-1 top-1 rounded bg-slate-800 px-1 text-[10px] text-white">
                      {pathOrder}
                    </div>
                  )}
                  <div className="flex h-full items-center justify-center gap-1">
                    {isP1 && <span className="h-4 w-4 rounded-full bg-red-500" title="Red (P1)" />}
                    {isP2 && <span className="h-4 w-4 rounded-full bg-blue-500" title="Blue (P2)" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Path Planning</h2>
        <p className="mt-1 text-sm text-slate-600">
          {animating
            ? "Pieces are moving..."
            : match.status !== "active"
              ? "Match ended."
              : mySubmitted
                ? "Path submitted. Waiting for opponent or timer..."
                : "Hold and drag from your piece (or current path end) to set route."}
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
        <pre className="mt-3 rounded bg-slate-100 p-2 text-xs">{JSON.stringify({ path: plannedPath }, null, 2)}</pre>
      </section>

      {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
    </main>
  );
}
