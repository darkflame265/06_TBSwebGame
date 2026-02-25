"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchChatMessage, MatchResponse } from "@/types/api";

type Props = {
  matchId: string;
};

type Coord = [number, number];
type DisplayBoard = { p1: Coord; p2: Coord };
type CollisionMeta = {
  collision: boolean;
  hitSlot: 1 | 2 | null;
  collisionAt: Coord | null;
  collisionStep: number | null;
  collisionT: number | null;
};
type LocalChatMessage = MatchChatMessage & { optimistic?: boolean };
type ChatRealtimeRow = {
  id: number;
  match_id: string;
  user_id: string;
  message: string;
  created_at: string;
};

const BOARD_SIZE = 5;
const STEP_ANIMATION_MS = 320;
const PREVIEW_PATH_MS = 250;
const RED_PATH_STROKE = 8;
const BLUE_PATH_STROKE = 5;
const SUBMIT_BUFFER_MS = 3000;
const PLANNING_TOTAL_MS = 10000;
const PLANNING_UI_MS = PLANNING_TOTAL_MS - SUBMIT_BUFFER_MS;
const MAX_CELL_SIZE = 86;
const MIN_CELL_SIZE = 24;
const MAX_CELL_SIZE_BELOW = 72;
const MAX_CELL_SIZE_NARROW = 68;
const CELL_GAP = 8;
const DEFAULT_BOARD: DisplayBoard = { p1: [0, 2], p2: [4, 2] };
const BOARD_CLUSTER_GAP = 32;
const CHAT_MATCH_WINDOW_MS = 15000;
const CHAT_KEEP_MISSING_REALTIME_MS = 5000;

const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
const isOrthogonalStep = (from: Coord, to: Coord) =>
  Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
const coordToPx = ([row, col]: Coord, cellSize: number, gap: number) => ({
  left: col * (cellSize + gap) + cellSize / 2,
  top: row * (cellSize + gap) + cellSize / 2,
});
const heartsForHp = (hp: number) => [0, 1, 2].map((i) => i < hp);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pathEquals = (a: Coord[], b: Coord[]) =>
  a.length === b.length && a.every((coord, idx) => sameCoord(coord, b[idx]));
const parsePath = (value: unknown): Coord[] => {
  if (!Array.isArray(value)) return [];
  const out: Coord[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return out;
    const row = item[0];
    const col = item[1];
    if (typeof row !== "number" || typeof col !== "number") return out;
    out.push([row, col]);
  }
  return out;
};
const toMs = (iso: string) => {
  const v = Date.parse(iso);
  return Number.isNaN(v) ? 0 : v;
};
const isLikelySameChat = (
  a: Pick<MatchChatMessage, "user_id" | "message" | "created_at">,
  b: Pick<MatchChatMessage, "user_id" | "message" | "created_at">,
) =>
  a.user_id === b.user_id &&
  a.message === b.message &&
  Math.abs(toMs(a.created_at) - toMs(b.created_at)) <= CHAT_MATCH_WINDOW_MS;
const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
};
const buildRenderablePathPoints = (start: Coord, path: Coord[]) => {
  if (path.length === 0) return [start];
  // Defensive rendering guard:
  // if start and first point are momentarily inconsistent, skip the bad first segment
  // so a diagonal "snap" line is never drawn.
  if (!isOrthogonalStep(start, path[0])) return [...path];
  return [start, ...path];
};

const SwordIcon = () => (
  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M50 10L28 32" />
      <path d="M54 6L46 14" />
      <path d="M28 32L20 40" />
      <path d="M20 40L12 34L6 40L12 46L6 52L12 58L18 52L24 58L30 52L24 46L30 40L24 34L20 40" />
    </g>
  </svg>
);

const RunIcon = () => (
  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="42" cy="10" r="5" />
      <path d="M36 20L28 30L40 34L34 46" />
      <path d="M28 30L18 24" />
      <path d="M24 44L14 54" />
      <path d="M40 34L50 42" />
      <path d="M6 58H58" />
    </g>
  </svg>
);

const deriveCollisionAt = (
  start: DisplayBoard,
  p1Path: Coord[],
  p2Path: Coord[],
): Coord | null => {
  const steps = Math.max(p1Path.length, p2Path.length);
  let p1 = start.p1;
  let p2 = start.p2;
  for (let i = 0; i < steps; i += 1) {
    if (i < p1Path.length) p1 = p1Path[i];
    if (i < p2Path.length) p2 = p2Path[i];
    if (sameCoord(p1, p2)) return p1;
  }
  return null;
};
const progressOnSegment = (
  from: Coord,
  to: Coord,
  point: Coord,
): number | null => {
  const eps = 0.0001;
  if (sameCoord(from, to)) return null;
  if (Math.abs(from[0] - to[0]) < eps) {
    if (Math.abs(point[0] - from[0]) > eps) return null;
    const den = to[1] - from[1];
    if (Math.abs(den) < eps) return null;
    const t = (point[1] - from[1]) / den;
    return t >= -eps && t <= 1 + eps ? clamp01(t) : null;
  }
  if (Math.abs(from[1] - to[1]) < eps) {
    if (Math.abs(point[1] - from[1]) > eps) return null;
    const den = to[0] - from[0];
    if (Math.abs(den) < eps) return null;
    const t = (point[0] - from[0]) / den;
    return t >= -eps && t <= 1 + eps ? clamp01(t) : null;
  }
  return null;
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
  const [planningLocked, setPlanningLocked] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [frozenTimerMs, setFrozenTimerMs] = useState<number | null>(null);
  const [resolvedOverlay, setResolvedOverlay] = useState<{
    start: DisplayBoard;
    p1: Coord[];
    p2: Coord[];
  } | null>(null);
  const [muted, setMuted] = useState(false);
  const [impactCoord, setImpactCoord] = useState<Coord | null>(null);
  const [hitFlashSlot, setHitFlashSlot] = useState<1 | 2 | null>(null);
  const [shakingHeart, setShakingHeart] = useState<{
    slot: 1 | 2;
    index: number;
    nonce: number;
  } | null>(null);
  const [displayHp, setDisplayHp] = useState<{ p1: number; p2: number }>({
    p1: 3,
    p2: 3,
  });
  const [explodedSlot, setExplodedSlot] = useState<1 | 2 | null>(null);
  const [requestingRematch, setRequestingRematch] = useState(false);
  const [openProfileSlot, setOpenProfileSlot] = useState<1 | 2 | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [presenceReady, setPresenceReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<LocalChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const prevMatchRef = useRef<MatchResponse | null>(null);
  const animatingRef = useRef(false);
  const animatedTurnRef = useRef<number | null>(null);
  const autoSubmittedRoundRef = useRef<number | null>(null);
  const ackedResolveTurnRef = useRef<number | null>(null);
  const latestMillisLeftRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const plannedPathRef = useRef<Coord[]>([]);
  const lockedPathRef = useRef<Coord[] | null>(null);
  const lastSyncTryAtRef = useRef(0);
  const requestRematchRef = useRef<() => void>(() => {});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const matchRef = useRef<MatchResponse | null>(null);
  const boardClusterHostRef = useRef<HTMLDivElement | null>(null);
  const [boardHostWidth, setBoardHostWidth] = useState(0);

  const mySlot = useMemo(() => {
    if (!match || !me) return null;
    return match.players.find((p) => p.user_id === me)?.slot ?? null;
  }, [match, me]);

  const mySubmitted = useMemo(() => {
    if (!match || mySlot === null) return false;
    return match.turns.some(
      (t) => t.turn_number === match.current_turn && t.player_slot === mySlot,
    );
  }, [match, mySlot]);
  const canPlan =
    !!match &&
    match.status === "active" &&
    match.phase === "planning" &&
    mySlot !== null &&
    !mySubmitted &&
    !animating &&
    !planningLocked;
  const obstacleKeys = useMemo(
    () => new Set((match?.obstacles ?? []).map(([x, y]) => `${x},${y}`)),
    [match?.obstacles],
  );
  const attackerSlot = match?.attacker_slot ?? 1;
  const myRole = mySlot ? (attackerSlot === mySlot ? "ATTACK" : "EVADE") : "-";
  const myRematchRequested =
    mySlot === 1
      ? !!match?.rematch_p1_requested
      : mySlot === 2
        ? !!match?.rematch_p2_requested
        : false;
  const opponentRematchRequested =
    mySlot === 1
      ? !!match?.rematch_p2_requested
      : mySlot === 2
        ? !!match?.rematch_p1_requested
        : false;
  const opponentUserId = useMemo(() => {
    if (!match || !me) return null;
    return match.players.find((p) => p.user_id !== me)?.user_id ?? null;
  }, [match, me]);
  const isAiMatch = match?.type === "ai";
  const aiSubmittedThisRound = useMemo(() => {
    if (!match) return false;
    return match.turns.some(
      (t) => t.turn_number === match.current_turn && t.player_slot === 2,
    );
  }, [match]);
  const showAiThinking =
    match?.type === "ai" &&
    match.phase === "planning" &&
    match.status === "active" &&
    !aiSubmittedThisRound;
  const opponentOnline =
    isAiMatch || (!!opponentUserId && onlineUserIds.includes(opponentUserId));

  const playHitSfx = () => {
    if (muted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new window.AudioContext();
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // ignore audio init errors
    }
  };

  const triggerImpactFx = (meta: CollisionMeta) => {
    if (!meta.collision || !meta.hitSlot || !meta.collisionAt) return;
    setImpactCoord(meta.collisionAt);
    setHitFlashSlot(meta.hitSlot);
    playHitSfx();
    setTimeout(() => setImpactCoord(null), 450);
    setTimeout(() => setHitFlashSlot(null), 700);
  };

  const ackResolve = async (turn: number) => {
    try {
      await apiPost(`/api/matches/${matchId}/resolve-ack`, { turn });
    } catch {
      // best effort; timeout fallback on server still guarantees progress
    }
  };

  const animateResolvedRound = async (
    start: DisplayBoard,
    p1Path: Coord[],
    p2Path: Coord[],
    meta: CollisionMeta,
    turn: number,
    revealResultOnImpact: boolean,
  ) => {
    const steps = Math.max(p1Path.length, p2Path.length);
    const immediateCollision =
      !!meta.collision && meta.hitSlot !== null && meta.collisionStep === null;
    setResolvedOverlay({ start, p1: p1Path, p2: p2Path });
    setDisplayBoard(start);
    setFrozenTimerMs(Math.max(0, latestMillisLeftRef.current));
    animatingRef.current = true;
    setAnimating(true);
    let didTriggerHit = false;

    let p1 = start.p1;
    let p2 = start.p2;
    if (immediateCollision) {
      didTriggerHit = true;
      triggerImpactFx(meta);
      if (revealResultOnImpact) setResultReady(true);
      if (meta.hitSlot === 1) {
        setDisplayHp((hp) => {
          const next = Math.max(hp.p1 - 1, 0);
          setShakingHeart({ slot: 1, index: next, nonce: Date.now() });
          if (next === 0) setExplodedSlot(1);
          return { ...hp, p1: next };
        });
      } else if (meta.hitSlot === 2) {
        setDisplayHp((hp) => {
          const next = Math.max(hp.p2 - 1, 0);
          setShakingHeart({ slot: 2, index: next, nonce: Date.now() });
          if (next === 0) setExplodedSlot(2);
          return { ...hp, p2: next };
        });
      }
      await sleep(220);
    }

    if (steps <= 0) {
      await sleep(200);
      setDisplayBoard({ p1, p2 });
      setAnimating(false);
      animatingRef.current = false;
      setFrozenTimerMs(null);
      return;
    }

    // Ensure path overlay is painted on screen before movement begins.
    await waitForPaint();
    await sleep(PREVIEW_PATH_MS);

    for (let i = 0; i < steps; i += 1) {
      const prevP1 = p1;
      const prevP2 = p2;
      if (i < p1Path.length) p1 = p1Path[i];
      if (i < p2Path.length) p2 = p2Path[i];
      setDisplayBoard({ p1, p2 });
      if (
        !didTriggerHit &&
        meta.collision &&
        meta.collisionAt &&
        meta.collisionStep === i
      ) {
        didTriggerHit = true;
        let collisionT = meta.collisionT ?? null;
        if (collisionT === null) {
          const t1 = progressOnSegment(prevP1, p1, meta.collisionAt);
          const t2 = progressOnSegment(prevP2, p2, meta.collisionAt);
          if (t1 !== null && t2 !== null) {
            collisionT = clamp01((t1 + t2) / 2);
          } else if (
            sameCoord(p1, meta.collisionAt) &&
            sameCoord(p2, meta.collisionAt)
          ) {
            collisionT = 1;
          } else {
            collisionT = 1;
          }
        }
        const delay = Math.round(STEP_ANIMATION_MS * clamp01(collisionT));
        if (delay > 0) await sleep(delay);
        triggerImpactFx(meta);
        if (revealResultOnImpact) setResultReady(true);
        if (meta.hitSlot === 1) {
          setDisplayHp((hp) => {
            const next = Math.max(hp.p1 - 1, 0);
            setShakingHeart({ slot: 1, index: next, nonce: Date.now() });
            if (next === 0) setExplodedSlot(1);
            return { ...hp, p1: next };
          });
        } else if (meta.hitSlot === 2) {
          setDisplayHp((hp) => {
            const next = Math.max(hp.p2 - 1, 0);
            setShakingHeart({ slot: 2, index: next, nonce: Date.now() });
            if (next === 0) setExplodedSlot(2);
            return { ...hp, p2: next };
          });
        }
        if (delay < STEP_ANIMATION_MS) await sleep(STEP_ANIMATION_MS - delay);
      } else {
        await sleep(STEP_ANIMATION_MS);
      }
    }

    if (revealResultOnImpact && !didTriggerHit) {
      setResultReady(true);
    }

    setAnimating(false);
    animatingRef.current = false;
    setFrozenTimerMs(null);
    if (ackedResolveTurnRef.current !== turn) {
      ackedResolveTurnRef.current = turn;
      void ackResolve(turn);
    }
  };

  const loadMatch = async () => {
    try {
      const data = await apiGet<MatchResponse>(`/api/matches/${matchId}`);
      const nextBoard = data.board_state ?? DEFAULT_BOARD;
      const prev = prevMatchRef.current;

      if (data.status !== "finished" && resultReady) {
        setResultReady(false);
      }

      if (!prev) {
        setDisplayBoard(nextBoard);
        setDisplayHp({ p1: data.p1_hp, p2: data.p2_hp });
        setExplodedSlot(null);
      } else if (
        data.phase === "resolving" &&
        data.resolved_paths &&
        animatedTurnRef.current !== data.resolved_paths.turn &&
        !animatingRef.current
      ) {
        const start = data.resolved_paths.start;
        const collisionAt =
          data.resolved_paths.collision_at ??
          deriveCollisionAt(
            { p1: start.p1, p2: start.p2 },
            data.resolved_paths.p1,
            data.resolved_paths.p2,
          );
        await animateResolvedRound(
          { p1: start.p1, p2: start.p2 },
          data.resolved_paths.p1,
          data.resolved_paths.p2,
          {
            collision: !!data.resolved_paths.collision,
            hitSlot: data.resolved_paths.hit_slot ?? null,
            collisionAt,
            collisionStep: data.resolved_paths.collision_step ?? null,
            collisionT: data.resolved_paths.collision_t ?? null,
          },
          data.resolved_paths.turn,
          data.status === "finished",
        );
        animatedTurnRef.current = data.resolved_paths.turn;
      } else if (!animatingRef.current) {
        setDisplayBoard(nextBoard);
        setDisplayHp({ p1: data.p1_hp, p2: data.p2_hp });
      }

      const hasPendingResolveAnimation =
        data.phase === "resolving" &&
        !!data.resolved_paths &&
        animatedTurnRef.current !== data.resolved_paths.turn;

      if (
        data.status === "finished" &&
        !hasPendingResolveAnimation &&
        !animatingRef.current
      ) {
        setResultReady(true);
      }

      if (prev && prev.phase === "resolving" && data.phase === "planning") {
        if (!animatingRef.current) {
          setResolvedOverlay(null);
        }
        setPlannedPath([]);
        plannedPathRef.current = [];
        lockedPathRef.current = null;
        setPlanningLocked(false);
        setDraggingPath(false);
        autoSubmittedRoundRef.current = null;
        ackedResolveTurnRef.current = null;
      }
      if (prev && data.current_turn !== prev.current_turn) {
        if (!animatingRef.current) {
          setResolvedOverlay(null);
        }
        setPlannedPath([]);
        plannedPathRef.current = [];
        lockedPathRef.current = null;
        setPlanningLocked(false);
        setDraggingPath(false);
        autoSubmittedRoundRef.current = null;
        ackedResolveTurnRef.current = null;
        setExplodedSlot(null);
      }

      prevMatchRef.current = data;
      matchRef.current = data;
      setMatch(data);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load match",
      );
    }
  };

  const pushIncomingChat = (row: ChatRealtimeRow) => {
    const nickname =
      matchRef.current?.players.find((p) => p.user_id === row.user_id)
        ?.nickname ?? null;
    const message: LocalChatMessage = {
      ...row,
      nickname,
    };
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;

      const optimisticIdx = prev.findIndex(
        (m) => !!m.optimistic && isLikelySameChat(m, message),
      );
      if (optimisticIdx >= 0) {
        const next = [...prev];
        next[optimisticIdx] = message;
        return next.sort((a, b) => {
          const t = toMs(a.created_at) - toMs(b.created_at);
          return t !== 0 ? t : a.id - b.id;
        });
      }

      return [...prev, message].sort((a, b) => {
        const t = toMs(a.created_at) - toMs(b.created_at);
        return t !== 0 ? t : a.id - b.id;
      });
    });
  };

  const loadChat = async () => {
    try {
      const data = await apiGet<MatchChatMessage[]>(
        `/api/matches/${matchId}/chat`,
      );
      setChatMessages((prev) => {
        const now = Date.now();
        const merged: LocalChatMessage[] = [...data];

        for (const pending of prev) {
          if (!pending.optimistic) continue;
          const hasRealMatch = data.some((real) =>
            isLikelySameChat(real, pending),
          );
          if (hasRealMatch) continue;
          if (now - toMs(pending.created_at) <= CHAT_MATCH_WINDOW_MS) {
            merged.push(pending);
          }
        }

        for (const local of prev) {
          if (local.optimistic) continue;
          const existsInFetched = data.some((real) => real.id === local.id);
          if (existsInFetched) continue;
          if (now - toMs(local.created_at) <= CHAT_KEEP_MISSING_REALTIME_MS) {
            merged.push(local);
          }
        }

        const byId = new Map<number, LocalChatMessage>();
        for (const msg of merged) {
          const prevMsg = byId.get(msg.id);
          if (!prevMsg || (prevMsg.optimistic && !msg.optimistic)) {
            byId.set(msg.id, msg);
          }
        }

        return Array.from(byId.values()).sort((a, b) => {
          const t = toMs(a.created_at) - toMs(b.created_at);
          return t !== 0 ? t : a.id - b.id;
        });
      });
    } catch {
      // keep gameplay stable even when chat fails
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("tbs-muted");
    if (saved) setMuted(saved === "1");
    const savedDark = localStorage.getItem("tbs-dark");
    if (savedDark) setDarkMode(savedDark === "1");
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadMatch();
    loadChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    localStorage.setItem("tbs-muted", muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    localStorage.setItem("tbs-dark", darkMode ? "1" : "0");
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", darkMode);
    }
  }, [darkMode]);

  useEffect(() => {
    if (!shakingHeart) return;
    const t = setTimeout(() => setShakingHeart(null), 550);
    return () => clearTimeout(t);
  }, [shakingHeart]);

  useEffect(() => {
    plannedPathRef.current = plannedPath;
  }, [plannedPath]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 33);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = setInterval(() => loadMatch(), 1000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const poll = setInterval(() => loadChat(), 500);
    return () => clearInterval(poll);
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
        {
          event: "INSERT",
          schema: "public",
          table: "turns",
          filter: `match_id=eq.${matchId}`,
        },
        () => loadMatch(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "turns",
          filter: `match_id=eq.${matchId}`,
        },
        () => loadMatch(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        () => loadMatch(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_chat_messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as Partial<ChatRealtimeRow>;
          if (
            typeof row.id !== "number" ||
            typeof row.match_id !== "string" ||
            typeof row.user_id !== "string" ||
            typeof row.message !== "string" ||
            typeof row.created_at !== "string"
          ) {
            void loadChat();
            return;
          }
          pushIncomingChat({
            id: row.id,
            match_id: row.match_id,
            user_id: row.user_id,
            message: row.message,
            created_at: row.created_at,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    const host = boardClusterHostRef.current;
    if (!host) return;

    const resize = () => {
      const hostRect = host.getBoundingClientRect().width;
      const parentClient = host.parentElement?.clientWidth ?? 0;
      const parentRect = host.parentElement?.getBoundingClientRect().width ?? 0;
      const viewportFallback =
        typeof window !== "undefined" ? window.innerWidth - 80 : 0;
      // Use the actual container width first. hostRect can be inflated by overflowed children.
      const measured =
        parentClient > 0
          ? parentClient
          : parentRect > 0
            ? parentRect
            : hostRect > 0
              ? hostRect
              : viewportFallback;
      if (measured > 0) setBoardHostWidth(measured);
    };

    resize();
    requestAnimationFrame(resize);
    const t1 = setTimeout(resize, 0);
    const t2 = setTimeout(resize, 120);

    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    if (host.parentElement) observer.observe(host.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    const presenceChannel = supabase.channel(`match-presence-${matchId}`, {
      config: { presence: { key: me } },
    });

    const syncPresence = () => {
      const state = presenceChannel.presenceState<{ userId: string }>();
      const ids = new Set<string>();
      Object.values(state).forEach((entries) => {
        entries.forEach((entry) => {
          if (entry.userId) ids.add(entry.userId);
        });
      });
      setOnlineUserIds(Array.from(ids));
      setPresenceReady(true);
    };

    presenceChannel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ userId: me });
        }
      });

    return () => {
      void presenceChannel.untrack();
      supabase.removeChannel(presenceChannel);
      setPresenceReady(false);
      setOnlineUserIds([]);
    };
  }, [matchId, me, supabase]);

  const submitPath = async (
    pathToSubmit: Coord[],
    options?: { force?: boolean },
  ) => {
    if (!match) return;
    if (!options?.force && !canPlan) return;
    try {
      await apiPost(`/api/matches/${matchId}/turns`, {
        round: match.current_turn,
        action: { path: pathToSubmit },
      });
      await loadMatch();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to submit path";
      const lowerMsg = msg.toLowerCase();
      const benignPhaseTransition =
        lowerMsg.includes("planning window closed") ||
        lowerMsg.includes("round is resolving") ||
        lowerMsg.includes("stale round") ||
        lowerMsg.includes("match is not active") ||
        lowerMsg.includes("resolving");
      if (benignPhaseTransition) {
        setMessage(null);
        await loadMatch();
        return;
      }
      setMessage(msg);
    }
  };

  const deadlineMs =
    match?.phase === "planning"
      ? match.planning_ends_at
        ? new Date(match.planning_ends_at).getTime()
        : nowMs
      : match?.resolution_ends_at
        ? new Date(match.resolution_ends_at).getTime()
        : nowMs;
  const millisLeft = Math.max(0, deadlineMs - nowMs);
  const rawShownMillisLeft = frozenTimerMs ?? millisLeft;
  const shownMillisLeft =
    match?.phase === "planning"
      ? Math.max(0, rawShownMillisLeft - SUBMIT_BUFFER_MS)
      : rawShownMillisLeft;
  const isMovingUi =
    animating || planningLocked || match?.phase === "resolving";

  useEffect(() => {
    latestMillisLeftRef.current = millisLeft;
  }, [millisLeft]);

  useEffect(() => {
    if (!match || match.phase !== "planning" || match.status !== "active")
      return;
    if (mySlot === null || mySubmitted || animating) return;
    if (millisLeft > SUBMIT_BUFFER_MS) return;
    if (autoSubmittedRoundRef.current === match.current_turn) return;
    // Lock at the start of buffer window and snapshot the final client path.
    setPlanningLocked(true);
    setDraggingPath(false);
    autoSubmittedRoundRef.current = match.current_turn;
    lockedPathRef.current = [...plannedPathRef.current];
    lastSyncTryAtRef.current = Date.now();
    void submitPath(lockedPathRef.current, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    millisLeft,
    match?.phase,
    match?.status,
    mySlot,
    mySubmitted,
    animating,
    match?.current_turn,
  ]);

  useEffect(() => {
    if (
      !match ||
      !planningLocked ||
      match.phase !== "planning" ||
      match.status !== "active"
    )
      return;
    if (mySlot === null || millisLeft <= 0) return;
    const locked = lockedPathRef.current;
    if (!locked) return;

    const myTurn = match.turns.find(
      (t) => t.turn_number === match.current_turn && t.player_slot === mySlot,
    );
    const serverPath = parsePath(
      (myTurn?.action_payload as { path?: unknown } | undefined)?.path,
    );
    if (pathEquals(serverPath, locked)) return;

    const now = Date.now();
    if (now - lastSyncTryAtRef.current < 250) return;
    lastSyncTryAtRef.current = now;
    void submitPath(locked, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, planningLocked, millisLeft, mySlot]);

  useEffect(() => {
    if (!match) return;
    if (animating) return;
    if (match.phase !== "planning") return;
    if (!resolvedOverlay) return;
    setResolvedOverlay(null);
  }, [animating, match, resolvedOverlay]);

  useEffect(() => {
    if (!match?.rematch_match_id) return;
    if (match.rematch_match_id === match.id) return;
    router.push(`/match/${match.rematch_match_id}`);
  }, [match?.id, match?.rematch_match_id, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!match || !canPlan || mySlot === null) return;

      let dRow = 0;
      let dCol = 0;
      if (event.key === "ArrowLeft") dCol = -1;
      else if (event.key === "ArrowRight") dCol = 1;
      else if (event.key === "ArrowUp") dRow = -1;
      else if (event.key === "ArrowDown") dRow = 1;
      else return;

      event.preventDefault();

      const myPosLocal: Coord =
        mySlot === 1 ? displayBoard.p1 : (displayBoard.p2 as Coord);
      const maxPointsLocal = Math.min(match.current_turn + 4, 10);

      setPlannedPath((prev) => {
        const end = prev.length > 0 ? prev[prev.length - 1] : myPosLocal;
        const target: Coord = [end[0] + dRow, end[1] + dCol];
        const targetKey = `${target[0]},${target[1]}`;

        if (
          target[0] < 0 ||
          target[0] >= BOARD_SIZE ||
          target[1] < 0 ||
          target[1] >= BOARD_SIZE
        ) {
          return prev;
        }
        if (obstacleKeys.has(targetKey)) return prev;

        const back: Coord | null =
          prev.length > 0
            ? prev.length > 1
              ? prev[prev.length - 2]
              : myPosLocal
            : null;
        if (back && sameCoord(back, target)) {
          return prev.slice(0, -1);
        }

        if (prev.length >= maxPointsLocal) return prev;
        if (!isOrthogonalStep(end, target)) return prev;
        return [...prev, target];
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPlan, displayBoard.p1, displayBoard.p2, match, mySlot, obstacleKeys]);

  const requestRematch = async () => {
    if (!match || match.status !== "finished" || requestingRematch) return;
    if (match.type !== "ai" && presenceReady && !opponentOnline) {
      setMessage("The opponent is offline. Rematch is unavailable.");
      return;
    }
    setRequestingRematch(true);
    try {
      if (match.type === "ai") {
        const data = await apiPost<{ match_id: string }>("/api/ai-match/create");
        router.push(`/match/${data.match_id}`);
        return;
      }

      const res = await apiPost<{
        status: "waiting" | "started";
        match_id?: string;
      }>(`/api/matches/${matchId}/rematch`);
      if (res.status === "started" && res.match_id) {
        router.push(`/match/${res.match_id}`);
        return;
      }
      await loadMatch();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to request rematch",
      );
    } finally {
      setRequestingRematch(false);
    }
  };
  requestRematchRef.current = () => {
    void requestRematch();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key.toLowerCase() !== "r") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (match?.status !== "finished") return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      requestRematchRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [match?.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const input = chatInputRef.current;
      if (!input) return;

      event.preventDefault();
      if (document.activeElement === input) {
        input.blur();
      } else {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const leaveMatch = async () => {
    setMessage(null);
    setLeaving(true);
    try {
      await apiPost(`/api/matches/${matchId}/leave`);
      router.push("/");
    } catch (error) {
      setLeaving(false);
      setMessage(
        error instanceof Error ? error.message : "Failed to leave match",
      );
    }
  };

  const sendChat = async () => {
    const next = chatInput.trim();
    if (!next) return;
    if (next.length > 300) {
      setMessage("Chat message must be 300 characters or less");
      return;
    }
    const nowIso = new Date().toISOString();
    const myNickname =
      me && match
        ? (match.players.find((p) => p.user_id === me)?.nickname ?? null)
        : null;
    const optimisticId = -Date.now() - Math.floor(Math.random() * 1000);
    const optimisticMessage: LocalChatMessage = {
      id: optimisticId,
      match_id: matchId,
      user_id: me ?? "me",
      nickname: myNickname,
      message: next,
      created_at: nowIso,
      optimistic: true,
    };

    setChatMessages((prev) =>
      [...prev, optimisticMessage].sort(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
      ),
    );
    setChatInput("");
    setSendingChat(true);

    try {
      await apiPost(`/api/matches/${matchId}/chat`, { message: next });
      void loadChat();
    } catch (error) {
      setChatMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
      setMessage(
        error instanceof Error ? error.message : "Failed to send chat",
      );
    } finally {
      setSendingChat(false);
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

  const myPos: Coord | null =
    mySlot === 1 ? displayBoard.p1 : mySlot === 2 ? displayBoard.p2 : null;
  const currentEnd: Coord | null = myPos
    ? plannedPath.length > 0
      ? plannedPath[plannedPath.length - 1]
      : myPos
    : null;
  const maxPoints = Math.min(match.current_turn + 4, 10);
  const usedPathPoints = plannedPath.length;
  const remainingPathPoints = Math.max(0, maxPoints - usedPathPoints);
  const myColor = mySlot === 1 ? "Red" : mySlot === 2 ? "Blue" : "-";
  const p1IsAttacker = attackerSlot === 1;
  const p2IsAttacker = attackerSlot === 2;
  const secondsLeft = ((isMovingUi ? 0 : shownMillisLeft) / 1000).toFixed(1);
  const timerBarBase =
    match.phase === "planning" ? PLANNING_UI_MS : PLANNING_TOTAL_MS;
  const isFinished = match.status === "finished";
  const showResult = isFinished && resultReady;
  const iWon = isFinished && mySlot !== null && match.winner_slot === mySlot;
  const iLost =
    isFinished &&
    mySlot !== null &&
    match.winner_slot !== null &&
    match.winner_slot !== mySlot;
  const opponentLeft = Boolean(
    (match.ended_reason === "player_left" &&
      match.left_by &&
      me &&
      match.left_by !== me) ||
      (!isAiMatch && presenceReady && !!opponentUserId && !opponentOnline),
  );

  const beginPathDrag = (row: number, col: number) => {
    if (!canPlan || !currentEnd) return;
    if (currentEnd[0] !== row || currentEnd[1] !== col) return;
    setDraggingPath(true);
  };

  const tapPathStep = (row: number, col: number) => {
    if (!canPlan || !myPos) return;
    setPlannedPath((prev) => {
      const end = prev.length > 0 ? prev[prev.length - 1] : myPos;
      const target: Coord = [row, col];
      const targetKey = `${row},${col}`;
      if (sameCoord(end, target)) return prev;

      const back =
        prev.length > 0
          ? prev.length > 1
            ? prev[prev.length - 2]
            : myPos
          : null;
      if (back && sameCoord(back, target)) return prev.slice(0, -1);
      if (!isOrthogonalStep(end, target)) return prev;
      if (obstacleKeys.has(targetKey)) return prev;
      if (prev.length >= maxPoints) return prev;
      return [...prev, target];
    });
  };

  const extendOrRewindPath = (row: number, col: number) => {
    if (!draggingPath || !canPlan || !myPos) return;
    setPlannedPath((prev) => {
      const end = prev.length > 0 ? prev[prev.length - 1] : myPos;
      const target: Coord = [row, col];
      const targetKey = `${row},${col}`;
      if (sameCoord(end, target)) return prev;

      const back =
        prev.length > 0
          ? prev.length > 1
            ? prev[prev.length - 2]
            : myPos
          : null;
      if (back && sameCoord(back, target)) return prev.slice(0, -1);
      if (!isOrthogonalStep(end, target)) return prev;
      if (obstacleKeys.has(targetKey)) return prev;
      if (prev.length >= maxPoints) return prev;
      return [...prev, target];
    });
  };

  const layoutHostWidth = boardHostWidth > 0 ? boardHostWidth : 860;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const isChatBelow = viewportWidth < 1024;
  const clusterGap = isChatBelow ? 16 : BOARD_CLUSTER_GAP;
  const viewportBudget =
    viewportWidth >= 1280
      ? viewportWidth - 430
      : viewportWidth >= 1024
        ? viewportWidth - 430
        : viewportWidth - 80;
  const effectiveHostWidth = Math.max(
    320,
    Math.min(layoutHostWidth, viewportBudget > 0 ? viewportBudget : layoutHostWidth),
  );
  const sidePanelWidth = isChatBelow
    ? Math.max(96, Math.min(170, Math.floor(effectiveHostWidth * 0.2)))
    : Math.max(100, Math.min(190, Math.floor(effectiveHostWidth * 0.24)));
  const boardAvailable = Math.max(
    120,
    effectiveHostWidth - sidePanelWidth - clusterGap - 8,
  );
  const boardCellSize = Math.max(
    MIN_CELL_SIZE,
    Math.min(
      viewportWidth <= 650
        ? MAX_CELL_SIZE_NARROW
        : isChatBelow
          ? MAX_CELL_SIZE_BELOW
          : MAX_CELL_SIZE,
      Math.floor((boardAvailable - (BOARD_SIZE - 1) * CELL_GAP) / BOARD_SIZE),
    ),
  );
  const boardPx = BOARD_SIZE * boardCellSize + (BOARD_SIZE - 1) * CELL_GAP;
  const roleIconSize = Math.max(
    44,
    Math.min(80, Math.round((boardCellSize / MAX_CELL_SIZE) * 80)),
  );
  const roleOuterSize = Math.max(
    64,
    Math.min(96, Math.round((boardCellSize / MAX_CELL_SIZE) * 96)),
  );
  const roleTitleFontSize = Math.max(
    10,
    Math.min(12, Math.round((boardCellSize / MAX_CELL_SIZE) * 12)),
  );
  const roleLabelFontSize = Math.max(
    14,
    Math.min(24, Math.round((boardCellSize / MAX_CELL_SIZE) * 24)),
  );

  const pathToLine = (points: Coord[]) =>
    points
      .map((coord) => {
        const p = coordToPx(coord, boardCellSize, CELL_GAP);
        return `${p.left},${p.top}`;
      })
      .join(" ");

  const planningLine = myPos
    ? pathToLine(buildRenderablePathPoints(myPos, plannedPath))
    : "";
  const resolvingP1Line = resolvedOverlay
    ? pathToLine(
        buildRenderablePathPoints(resolvedOverlay.start.p1, resolvedOverlay.p1),
      )
    : "";
  const resolvingP2Line = resolvedOverlay
    ? pathToLine(
        buildRenderablePathPoints(resolvedOverlay.start.p2, resolvedOverlay.p2),
      )
    : "";
  const showResolvedPaths =
    !!resolvedOverlay && (match.phase === "resolving" || animating);

  const p1Px = coordToPx(displayBoard.p1, boardCellSize, CELL_GAP);
  const p2Px = coordToPx(displayBoard.p2, boardCellSize, CELL_GAP);
  const impactPx = impactCoord
    ? coordToPx(impactCoord, boardCellSize, CELL_GAP)
    : null;
  const p1Player = match.players.find((p) => p.slot === 1);
  const p2Player = match.players.find((p) => p.slot === 2);
  const p1UserId = p1Player?.user_id ?? "-";
  const p2UserId = p2Player?.user_id ?? "-";
  const p1Name = p1Player?.nickname?.trim() || p1UserId;
  const p2Name = p2Player?.nickname?.trim() || p2UserId;
  const p1Record =
    p1Player &&
    `${p1Player.wins}W ${p1Player.losses}L · ${p1Player.win_rate}%`;
  const p2Record =
    p2Player &&
    `${p2Player.wins}W ${p2Player.losses}L · ${p2Player.win_rate}%`;
  const pathGaugeSegments = Array.from({ length: maxPoints }).map(
    (_, idx) => idx < remainingPathPoints,
  );

  return (
    <main
      className={`min-h-screen ${darkMode ? "bg-[#12181B] text-slate-100" : "bg-[#F2E8CF] text-slate-800"}`}
    >
      <header className="mx-auto max-w-7xl px-6 pb-2 pt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1
              className={`flex items-center gap-2 text-3xl font-bold tracking-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}
            >
              <span className="text-[#386641]">🕹️</span>
              Match{" "}
              <span
                className={`font-mono text-xl font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}
              >
                {match.id}
              </span>
            </h1>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Status: {match.status} | Phase: {match.phase} | Round:{" "}
              {match.current_turn} | Piece: {myColor} | Role: {myRole} | Max
              path points: {maxPoints}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted((v) => !v)}
              className={`rounded-lg border px-3 py-2 text-sm shadow-sm ${
                darkMode
                  ? "border-[#3A444D] bg-[#1E252B] text-slate-100"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {muted ? "SFX Off" : "SFX On"}
            </button>
            <button
              onClick={leaveMatch}
              disabled={leaving}
              className="rounded-lg bg-[#bc4749] px-4 py-2 text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {leaving
                ? "Leaving..."
                : match.status === "finished"
                  ? "Back to lobby"
                  : "Leave match"}
            </button>
          </div>
        </div>
        <div
          className={`rounded-xl border p-4 shadow-sm ${
            darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/70 bg-white"
          }`}
        >
          <div
            className={`mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider ${
              darkMode ? "text-slate-300" : "text-slate-500"
            }`}
          >
            <span>{match.phase} phase</span>
            <span className="text-[#386641]">
              {isMovingUi ? "moving..." : `timer: ${secondsLeft}s`}
            </span>
          </div>
          <div className={`h-1.5 w-full overflow-hidden rounded ${darkMode ? "bg-[#2A3137]" : "bg-slate-200"}`}>
            <div
              className="h-full bg-[#386641]"
              style={{
                width: `${Math.max(0, Math.min(100, ((isMovingUi ? 0 : shownMillisLeft) / timerBarBase) * 100))}%`,
              }}
            />
          </div>
        </div>
      </header>

      {showResult && (
        <div
          className={`mx-auto mt-3 max-w-7xl rounded-xl p-4 text-center text-2xl font-extrabold ${iWon ? "bg-emerald-100 text-emerald-700" : iLost ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}
        >
          {iWon ? "YOU WIN" : iLost ? "YOU LOSE" : "MATCH FINISHED"}
        </div>
      )}

      {showResult && (
        <div
          className={`mx-auto mt-3 max-w-7xl rounded-xl p-4 shadow-sm ${
            darkMode ? "bg-[#1E252B]" : "bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={requestRematch}
              disabled={
                match.type === "ai"
                  ? requestingRematch
                  : requestingRematch ||
                    myRematchRequested ||
                    !!match.rematch_match_id ||
                    (presenceReady && !opponentOnline)
              }
              className="rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {match.type === "ai"
                ? requestingRematch
                  ? "Starting..."
                  : "REMATCH"
                : match.rematch_match_id
                  ? "Starting rematch..."
                  : myRematchRequested
                    ? "Rematch requested"
                    : requestingRematch
                      ? "Requesting..."
                      : "REMATCH"}
            </button>
            {match.type === "ai" && (
              <p
                className={`ml-auto text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}
              >
                AI match finished.
              </p>
            )}
            {opponentRematchRequested &&
              !myRematchRequested &&
              !match.rematch_match_id &&
              !opponentLeft && (
                <p className="text-sm font-semibold text-indigo-700">
                  The opponent has requested a rematch.
                </p>
              )}
            {myRematchRequested &&
              !opponentRematchRequested &&
              !match.rematch_match_id &&
              !opponentLeft && (
                <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Rematch request sent. Waiting for opponent...
                </p>
              )}
            {opponentLeft && (
              <p className="text-sm font-semibold text-rose-700">
                The opponent has left the game.
              </p>
            )}
          </div>
        </div>
      )}

      <main className="mx-auto mt-4 grid max-w-7xl grid-cols-1 gap-8 px-6 pb-10 lg:grid-cols-12">
        <section
          className={`rounded-2xl border p-6 shadow-sm lg:col-span-8 ${
            darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/60 bg-white"
          }`}
        >
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-xl font-bold">Board 5x5</h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p
                    className="max-w-[140px] truncate text-[10px] font-bold uppercase text-red-600"
                    title={p1Name}
                  >
                    {p1Name}
                  </p>
                  <div className="mt-0.5 flex justify-end gap-0.5">
                    {heartsForHp(displayHp.p1).map((filled, idx) => (
                      <span
                        key={`p1-heart-header-${idx}-${shakingHeart?.nonce ?? 0}`}
                        className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                          shakingHeart?.slot === 1 && shakingHeart.index === idx
                            ? "heart-shake"
                            : ""
                        }`}
                      >
                        {"\u2665"}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenProfileSlot((prev) => (prev === 1 ? null : 1))
                    }
                    className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-500 bg-red-50 text-red-500"
                    title={p1Name}
                  >
                    <span>◎</span>
                  </button>
                  {openProfileSlot === 1 && (
                    <div
                      className={`absolute -bottom-[90px] left-1/2 z-20 w-[320px] -translate-x-1/2 rounded border p-3 text-xs shadow ${
                        darkMode
                          ? "border-[#3A444D] bg-[#2A3137] text-slate-200"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <p className="select-text font-semibold">
                        {p1Name}
                        {p1Record ? ` (${p1Record})` : ""}
                      </p>
                      <p className="mt-1 select-text break-all font-mono text-[11px]">
                        Guest: {p1UserId}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenProfileSlot((prev) => (prev === 2 ? null : 2))
                    }
                    className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-50 text-blue-500"
                    title={p2Name}
                  >
                    <span>◎</span>
                  </button>
                  {openProfileSlot === 2 && (
                    <div
                      className={`absolute -bottom-[90px] left-1/2 z-20 w-[320px] -translate-x-1/2 rounded border p-3 text-xs shadow ${
                        darkMode
                          ? "border-[#3A444D] bg-[#2A3137] text-slate-200"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <p className="select-text font-semibold">
                        {p2Name}
                        {p2Record ? ` (${p2Record})` : ""}
                      </p>
                      <p className="mt-1 select-text break-all font-mono text-[11px]">
                        Guest: {p2UserId}
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <p
                    className="max-w-[140px] truncate text-[10px] font-bold uppercase text-blue-500"
                    title={p2Name}
                  >
                    {p2Name}
                  </p>
                  {showAiThinking && (
                    <p className="text-[10px] font-semibold text-emerald-600">
                      AI is thinking...
                    </p>
                  )}
                  <div className="mt-0.5 flex gap-0.5">
                    {heartsForHp(displayHp.p2).map((filled, idx) => (
                      <span
                        key={`p2-heart-header-${idx}-${shakingHeart?.nonce ?? 0}`}
                        className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                          shakingHeart?.slot === 2 && shakingHeart.index === idx
                            ? "heart-shake"
                            : ""
                        }`}
                      >
                        {"\u2665"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div ref={boardClusterHostRef} className="mt-5 w-full">
            <div
              className="flex items-start gap-4"
              style={{ gap: clusterGap }}
            >
          <div
            className="relative flex-none"
            style={{ width: boardPx, height: boardPx, touchAction: "none" }}
          >
                <div
                  className="grid"
                  style={{
                    width: boardPx,
                    height: boardPx,
                    gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
                    gap: `${CELL_GAP}px`,
                  }}
                >
                  {Array.from({ length: BOARD_SIZE }).map((_, row) =>
                    Array.from({ length: BOARD_SIZE }).map((__, col) =>
                      (() => {
                        const isObstacle = obstacleKeys.has(`${row},${col}`);
                        return (
                          <button
                            key={`${row}-${col}`}
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              beginPathDrag(row, col);
                            }}
                            onPointerEnter={() => extendOrRewindPath(row, col)}
                            onPointerUp={() => setDraggingPath(false)}
                            onClick={() => tapPathStep(row, col)}
                            className={`relative rounded-lg border text-[10px] ${
                              isObstacle
                                ? darkMode
                                  ? "cursor-not-allowed border-[#3A444D] bg-slate-900/80 text-slate-300"
                                  : "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-300"
                                : darkMode
                                  ? `border-[#3A444D] bg-[#2A3137] text-[#9AA4AE] ${canPlan ? "hover:bg-[#333C44]" : "cursor-default"}`
                                  : `border-slate-200 bg-slate-50 text-slate-500 ${canPlan ? "hover:bg-slate-100" : "cursor-default"}`
                            }`}
                            style={{
                              width: boardCellSize,
                              height: boardCellSize,
                              touchAction: "none",
                              userSelect: "none",
                            }}
                          >
                            ({row},{col})
                          </button>
                        );
                      })(),
                    ),
                  )}
                </div>

                <svg
                  className="pointer-events-none absolute inset-0"
                  width={boardPx}
                  height={boardPx}
                  viewBox={`0 0 ${boardPx} ${boardPx}`}
                >
                  {match.phase === "planning" &&
                    planningLine.split(" ").length >= 2 && (
                      <polyline
                        points={planningLine}
                        fill="none"
                        stroke={mySlot === 1 ? "#dc2626" : "#2563eb"}
                        strokeWidth={
                          mySlot === 1 ? RED_PATH_STROKE : BLUE_PATH_STROKE
                        }
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.75"
                      />
                    )}
                  {showResolvedPaths &&
                    resolvingP1Line.split(" ").length >= 2 && (
                      <polyline
                        points={resolvingP1Line}
                        fill="none"
                        stroke="#dc2626"
                        strokeWidth={RED_PATH_STROKE}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.75"
                      />
                    )}
                  {showResolvedPaths &&
                    resolvingP2Line.split(" ").length >= 2 && (
                      <polyline
                        points={resolvingP2Line}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={BLUE_PATH_STROKE}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.85"
                      />
                    )}
                </svg>

                {impactPx && (
                  <div
                    className="pointer-events-none absolute impact-burst -translate-x-1/2 -translate-y-1/2"
                    style={{ left: impactPx.left, top: impactPx.top }}
                  />
                )}

                <div
                  className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ${
                    hitFlashSlot === 1 ? "hit-blink" : ""
                  } ${explodedSlot === 1 ? "piece-explode" : ""}`}
                  style={{
                    left: p1Px.left,
                    top: p1Px.top,
                    transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
                    boxShadow:
                      (mySlot === 1
                        ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                        : "0 2px 6px rgba(15,23,42,0.25)") +
                      (p1IsAttacker
                        ? ", 0 0 14px 5px rgba(249,115,22,0.65)"
                        : ""),
                  }}
                />
                {p1IsAttacker && (
                  <div
                    className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: p1Px.left,
                      top: p1Px.top,
                      transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
                    }}
                  />
                )}

                <div
                  className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ${
                    hitFlashSlot === 2 ? "hit-blink" : ""
                  } ${explodedSlot === 2 ? "piece-explode" : ""}`}
                  style={{
                    left: p2Px.left,
                    top: p2Px.top,
                    transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
                    boxShadow:
                      (mySlot === 2
                        ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                        : "0 2px 6px rgba(15,23,42,0.25)") +
                      (p2IsAttacker
                        ? ", 0 0 14px 5px rgba(249,115,22,0.65)"
                        : ""),
                  }}
                />
                {p2IsAttacker && (
                  <div
                    className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: p2Px.left,
                      top: p2Px.top,
                      transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
                    }}
                  />
                )}
              </div>
          <div
            className="space-y-4 flex-none"
            style={{
              width: sidePanelWidth,
              minWidth: sidePanelWidth,
            }}
          >
            <div
              className={`rounded-xl border p-4 text-center ${
                darkMode
                  ? "border-[#3A444D] bg-[#2A3137] text-slate-100"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              <p
                className={`font-bold uppercase tracking-widest ${darkMode ? "text-[#9AA4AE]" : "text-slate-500"}`}
                style={{ fontSize: roleTitleFontSize }}
              >
                YOUR ROLE
              </p>
            <div
              className={`mx-auto mt-3 flex items-center justify-center rounded-full border-4 ${
                myRole === "ATTACK"
                  ? darkMode
                    ? "border-red-400/40 bg-red-500/10 text-red-400"
                    : "border-red-200 bg-red-50 text-red-600"
                  : darkMode
                    ? "border-blue-400/40 bg-blue-500/10 text-blue-400"
                    : "border-blue-200 bg-blue-50 text-blue-600"
              }`}
              style={{ width: roleOuterSize, height: roleOuterSize }}
            >
              <div style={{ width: roleIconSize, height: roleIconSize }}>
                {myRole === "ATTACK" ? <SwordIcon /> : <RunIcon />}
              </div>
            </div>
            <p
              className={`mt-2 font-bold ${myRole === "ATTACK" ? "text-red-600" : "text-blue-600"}`}
              style={{ fontSize: roleLabelFontSize }}
            >
              {myRole}
            </p>
                </div>
                <div
                  className={`rounded-xl border p-3 ${
                    darkMode
                      ? "border-emerald-900/40 bg-emerald-950/20"
                      : "border-green-200 bg-green-50"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`text-xs font-semibold ${darkMode ? "text-emerald-400/90" : "text-[#386641]"}`}>
                      Path Points
                    </span>
                    <span className={`text-xs font-bold ${darkMode ? "text-emerald-400" : "text-[#386641]"}`}>
                      {remainingPathPoints} / {maxPoints}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {pathGaugeSegments.map((filled, idx) => (
                      <div
                        key={`path-seg-${idx}`}
                        className={`h-1.5 flex-1 rounded-full ${
                          filled
                            ? darkMode
                              ? "bg-emerald-500/70"
                              : "bg-[#386641]"
                            : darkMode
                              ? "bg-slate-800"
                              : "bg-[#b9c7bd]"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside
          className={`flex h-[620px] flex-col overflow-hidden rounded-2xl border shadow-sm lg:col-span-4 ${
            darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/60 bg-white"
          }`}
        >
          <div
            className={`flex items-center justify-between border-b p-4 ${
              darkMode ? "border-slate-700" : "border-slate-100"
            }`}
          >
            <h2 className="font-semibold text-lg">Match Chat</h2>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
              Live
            </span>
          </div>
          <div
            ref={chatScrollRef}
            className={`flex-1 overflow-y-auto p-3 ${darkMode ? "bg-[#2A3137]" : "bg-slate-50"}`}
          >
            {chatMessages.length === 0 ? (
              <div className={`py-12 text-center text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                No messages yet. Say hi to your opponent!
              </div>
            ) : (
              <ul className="space-y-1">
                {chatMessages.map((msg) => {
                  const displayName =
                    msg.nickname?.trim() || msg.user_id.slice(0, 8);
                  return (
                    <li
                      key={msg.id}
                      className={`break-words text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}
                    >
                      <span className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {displayName}
                      </span>
                      {" : "}
                      <span>{msg.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div
              className={`border-t p-3 ${
              darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-100 bg-slate-50"
            }`}
          >
            <div className="flex gap-2">
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                maxLength={300}
                placeholder="Type a message..."
                className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#386641] ${
                  darkMode
                    ? "border-[#3A444D] bg-[#2A3137] text-slate-100"
                    : "border-slate-300 bg-white text-slate-800"
                }`}
              />
              <button
                type="button"
                onClick={() => void sendChat()}
                disabled={chatInput.trim().length === 0}
                className="rounded-lg bg-[#386641] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                ➤
              </button>
            </div>
          </div>
        </aside>
      </main>

      {message && (
        <p className="mx-auto mt-4 max-w-7xl rounded-lg bg-red-100 p-3 text-sm text-red-700">
          {message}
        </p>
      )}

      <footer
        className={`mx-auto max-w-7xl px-6 pb-12 pt-6 text-center text-sm ${
          darkMode ? "text-slate-500" : "text-slate-400"
        }`}
      >
        <p>© 2024 TBS Arena</p>
      </footer>

      <style jsx global>{`
        .hit-blink {
          animation: hit-blink 0.18s steps(2, end) 4;
        }
        .impact-burst {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          border: 3px solid rgba(251, 146, 60, 0.95);
          box-shadow: 0 0 18px rgba(251, 146, 60, 0.9);
          animation: impact-burst 0.42s ease-out forwards;
        }
        .heart-shake {
          animation: heart-shake 0.45s ease-in-out;
        }
        .flame-aura {
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: radial-gradient(
            circle at 50% 65%,
            rgba(251, 146, 60, 0.9),
            rgba(251, 146, 60, 0.35) 55%,
            rgba(251, 146, 60, 0) 75%
          );
          filter: blur(0.4px);
          animation: flame-flicker 0.28s ease-in-out infinite alternate;
        }
        .piece-explode {
          animation: piece-explode 0.45s ease-out forwards;
        }
        @keyframes hit-blink {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.2;
          }
          100% {
            opacity: 1;
          }
        }
        @keyframes impact-burst {
          0% {
            transform: translate(-50%, -50%) scale(0.4);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.1);
            opacity: 0;
          }
        }
        @keyframes heart-shake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-2px);
          }
          40% {
            transform: translateX(2px);
          }
          60% {
            transform: translateX(-2px);
          }
          80% {
            transform: translateX(2px);
          }
          100% {
            transform: translateX(0);
          }
        }
        @keyframes flame-flicker {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.12);
            opacity: 1;
          }
        }
        @keyframes piece-explode {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          70% {
            transform: translate(-50%, -50%) scale(1.8);
            opacity: 0.9;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.1);
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}
