"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import type { MatchResponse } from "@/types/api";
import {
  AI_PREVIEW_PATH_MS,
  AI_STEP_ANIMATION_MS,
  BOARD_SIZE,
  BOARD_CLUSTER_GAP,
  CELL_GAP,
  CHAT_KEEP_MISSING_REALTIME_MS,
  CHAT_MATCH_WINDOW_MS,
  DEFAULT_BOARD,
  MAX_CELL_SIZE,
  MAX_CELL_SIZE_BELOW,
  MAX_CELL_SIZE_NARROW,
  MIN_CELL_SIZE,
  PLANNING_TOTAL_MS,
  PLANNING_UI_MS,
  PREVIEW_PATH_MS,
  STEP_ANIMATION_MS,
  SUBMIT_BUFFER_MS,
} from "@/components/match/constants";
import { MatchBoardSection } from "@/components/match/match-board-section";
import { MatchChatPanel } from "@/components/match/match-chat-panel";
import { MatchGlobalStyles } from "@/components/match/match-global-styles";
import { MatchHeader } from "@/components/match/match-header";
import { MatchResultPanel } from "@/components/match/match-result-panel";
import {
  ackMatchResolve,
  createAiMatch,
  fetchMatch,
  fetchMatchChat,
  leaveMatch as leaveMatchApi,
  requestMatchRematch,
  sendMatchChat as sendMatchChatApi,
  submitMatchPath,
  tickMatch as tickMatchApi,
} from "@/components/match/api";
import { useMatchPreferences } from "@/components/match/hooks/use-match-preferences";
import type {
  ChatRealtimeRow,
  CollisionMeta,
  Coord,
  DisplayBoard,
  LocalChatMessage,
} from "@/components/match/types";
import {
  buildRenderablePathPoints,
  clamp01,
  coordToPx,
  deriveCollisionAt,
  isLikelySameChat,
  isOrthogonalStep,
  isTypingTarget,
  parsePath,
  pathEquals,
  progressOnSegment,
  sameCoord,
  sleep,
  toMs,
  waitForPaint,
} from "@/components/match/utils";

type Props = {
  matchId: string;
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
  const { muted, setMuted, darkMode } = useMatchPreferences();
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
  const [resultReady, setResultReady] = useState(false);

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
  const submitInFlightRef = useRef(false);
  const requestRematchRef = useRef<() => void>(() => {});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const matchRef = useRef<MatchResponse | null>(null);
  const loadMatchPromiseRef = useRef<Promise<void> | null>(null);
  const loadMatchQueuedRef = useRef(false);
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
  const obstaclesReadyForTurn =
    !match ||
    match.phase !== "planning" ||
    match.obstacles_turn === match.current_turn;
  const canPlan =
    !!match &&
    match.status === "active" &&
    match.phase === "planning" &&
    obstaclesReadyForTurn &&
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
      await ackMatchResolve(matchId, turn);
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
    aiFastMode: boolean,
  ) => {
    const stepMs = aiFastMode ? AI_STEP_ANIMATION_MS : STEP_ANIMATION_MS;
    const previewMs = aiFastMode ? AI_PREVIEW_PATH_MS : PREVIEW_PATH_MS;
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
    if (previewMs > 0) await sleep(previewMs);

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
        const delay = Math.round(stepMs * clamp01(collisionT));
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
        if (delay < stepMs) await sleep(stepMs - delay);
      } else {
        await sleep(stepMs);
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

  const applyMatchData = async (data: MatchResponse) => {
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
        data.type === "ai",
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
  };

  const loadMatch = async () => {
    if (loadMatchPromiseRef.current) {
      loadMatchQueuedRef.current = true;
      await loadMatchPromiseRef.current;
      return;
    }

    const task = (async () => {
    try {
      const data = await fetchMatch(matchId);
      await applyMatchData(data);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load match",
      );
    }
    })();

    loadMatchPromiseRef.current = task;
    try {
      await task;
    } finally {
      loadMatchPromiseRef.current = null;
      if (loadMatchQueuedRef.current) {
        loadMatchQueuedRef.current = false;
        void loadMatch();
      }
    }
  };

  const tickMatch = async () => {
    try {
      const data = await tickMatchApi(matchId);
      await applyMatchData(data);
    } catch {
      // tick is best-effort; realtime/read refresh keeps state fresh
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
      const data = await fetchMatchChat(matchId);
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
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadMatch();
    loadChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    if (!shakingHeart) return;
    const t = setTimeout(() => setShakingHeart(null), 550);
    return () => clearTimeout(t);
  }, [shakingHeart]);

  useEffect(() => {
    plannedPathRef.current = plannedPath;
  }, [plannedPath]);

  useEffect(() => {
    if (!match) return;
    if (match.phase !== "planning") return;
    if (match.obstacles_turn === match.current_turn) return;
    setPlannedPath([]);
    plannedPathRef.current = [];
    lockedPathRef.current = null;
    setDraggingPath(false);
  }, [match?.phase, match?.current_turn, match?.obstacles_turn, match]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 33);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!match || match.status !== "active") return;
    const deadlineIso =
      match.phase === "planning"
        ? match.planning_ends_at
        : match.resolution_ends_at;
    if (!deadlineIso) return;
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isFinite(deadlineMs)) return;

    // Trigger exactly around phase deadline instead of polling.
    const delayMs = Math.max(0, deadlineMs - Date.now() + 25);
    const timer = window.setTimeout(() => {
      void tickMatch();
    }, delayMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    matchId,
    match?.status,
    match?.phase,
    match?.planning_ends_at,
    match?.resolution_ends_at,
  ]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      void loadMatch();
    };

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const stopDragging = () => setDraggingPath(false);
    window.addEventListener("pointerup", stopDragging);
    return () => window.removeEventListener("pointerup", stopDragging);
  }, []);

  useEffect(() => {
    let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;
    const scheduleLoadMatch = () => {
      if (scheduledRefresh) clearTimeout(scheduledRefresh);
      scheduledRefresh = setTimeout(() => {
        scheduledRefresh = null;
        void loadMatch();
      }, 150);
    };

    type TurnRow = {
      id: number;
      turn_number: number;
      player_slot: number;
      action_payload: Record<string, unknown>;
      created_by: string;
      created_at: string;
    };

    const patchTurnRow = (row: TurnRow) => {
      const current = matchRef.current;
      if (!current) return;
      const without = current.turns.filter((t) => t.id !== row.id);
      const turns = [...without, row].sort((a, b) => {
        if (a.turn_number !== b.turn_number) return a.turn_number - b.turn_number;
        return a.player_slot - b.player_slot;
      });
      const next: MatchResponse = { ...current, turns };
      matchRef.current = next;
      prevMatchRef.current = next;
      setMatch(next);
    };

    const patchMatchRow = (row: Partial<MatchResponse>) => {
      const current = matchRef.current;
      if (!current) {
        scheduleLoadMatch();
        return;
      }
      const next: MatchResponse = {
        ...current,
        ...row,
        players: current.players,
        turns: current.turns,
      };
      void applyMatchData(next);
    };

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
        (payload) => {
          const row = payload.new as Partial<TurnRow>;
          if (
            typeof row.id !== "number" ||
            typeof row.turn_number !== "number" ||
            typeof row.player_slot !== "number" ||
            typeof row.created_by !== "string" ||
            typeof row.created_at !== "string" ||
            typeof row.action_payload !== "object" ||
            row.action_payload === null
          ) {
            scheduleLoadMatch();
            return;
          }
          patchTurnRow({
            id: row.id,
            turn_number: row.turn_number,
            player_slot: row.player_slot,
            action_payload: row.action_payload as Record<string, unknown>,
            created_by: row.created_by,
            created_at: row.created_at,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "turns",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as Partial<TurnRow>;
          if (
            typeof row.id !== "number" ||
            typeof row.turn_number !== "number" ||
            typeof row.player_slot !== "number" ||
            typeof row.created_by !== "string" ||
            typeof row.created_at !== "string" ||
            typeof row.action_payload !== "object" ||
            row.action_payload === null
          ) {
            scheduleLoadMatch();
            return;
          }
          patchTurnRow({
            id: row.id,
            turn_number: row.turn_number,
            player_slot: row.player_slot,
            action_payload: row.action_payload as Record<string, unknown>,
            created_by: row.created_by,
            created_at: row.created_at,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as Partial<MatchResponse>;
          if (
            typeof row.id !== "string" ||
            typeof row.phase !== "string" ||
            typeof row.current_turn !== "number" ||
            typeof row.status !== "string"
          ) {
            scheduleLoadMatch();
            return;
          }
          patchMatchRow(row);
        },
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
      if (scheduledRefresh) clearTimeout(scheduledRefresh);
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
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      await submitMatchPath(matchId, match.current_turn, pathToSubmit);
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
        setPlanningLocked(false);
        lockedPathRef.current = null;
        lastSyncTryAtRef.current = 0;
        setMessage(null);
        await loadMatch();
        return;
      }
      setMessage(msg);
    } finally {
      submitInFlightRef.current = false;
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
        const data = await createAiMatch();
        router.push(`/match/${data.match_id}`);
        return;
      }

      const res = await requestMatchRematch(matchId);
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
      await leaveMatchApi(matchId);
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

    try {
      await sendMatchChatApi(matchId, next);
      void loadChat();
    } catch (error) {
      setChatMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
      setMessage(
        error instanceof Error ? error.message : "Failed to send chat",
      );
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
  const pieceTransitionMs = isAiMatch ? AI_STEP_ANIMATION_MS : STEP_ANIMATION_MS;
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
  const displayPhase: "planning" | "resolving" =
    animating || resolvedOverlay ? "resolving" : match.phase;

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
    <MatchHeader
      darkMode={darkMode}
      matchId={match.id}
      status={match.status}
      phase={displayPhase}
      currentTurn={match.current_turn}
      myColor={myColor}
      myRole={myRole}
      muted={muted}
      leaving={leaving}
      obstaclesReadyForTurn={obstaclesReadyForTurn}
      isMovingUi={isMovingUi}
      secondsLeft={secondsLeft}
      shownMillisLeft={shownMillisLeft}
      timerBarBase={timerBarBase}
      onToggleMuted={() => setMuted((v) => !v)}
      onLeaveMatch={() => void leaveMatch()}
      isFinished={isFinished}
    />

    <MatchResultPanel
      darkMode={darkMode}
      showResult={showResult}
      iWon={iWon}
      iLost={iLost}
      matchType={match.type}
      requestingRematch={requestingRematch}
      myRematchRequested={myRematchRequested}
      opponentRematchRequested={opponentRematchRequested}
      rematchMatchId={match.rematch_match_id}
      presenceReady={presenceReady}
      opponentOnline={opponentOnline}
      opponentLeft={opponentLeft}
      onRequestRematch={() => void requestRematch()}
    />

    <main className="mx-auto mt-4 grid max-w-7xl grid-cols-1 gap-8 px-6 pb-10 lg:grid-cols-12">
      <MatchBoardSection
        darkMode={darkMode}
        boardClusterHostRef={boardClusterHostRef}
        clusterGap={clusterGap}
        boardPx={boardPx}
        boardCellSize={boardCellSize}
        obstacleKeys={obstacleKeys}
        canPlan={canPlan}
        beginPathDrag={beginPathDrag}
        extendOrRewindPath={extendOrRewindPath}
        tapPathStep={tapPathStep}
        setDraggingPath={setDraggingPath}
        matchPhase={match.phase}
        planningLine={planningLine}
        mySlot={mySlot}
        showResolvedPaths={showResolvedPaths}
        resolvingP1Line={resolvingP1Line}
        resolvingP2Line={resolvingP2Line}
        impactPx={impactPx}
        hitFlashSlot={hitFlashSlot}
        explodedSlot={explodedSlot}
        p1Px={p1Px}
        p2Px={p2Px}
        pieceTransitionMs={pieceTransitionMs}
        p1IsAttacker={p1IsAttacker}
        p2IsAttacker={p2IsAttacker}
        roleTitleFontSize={roleTitleFontSize}
        roleOuterSize={roleOuterSize}
        roleIconSize={roleIconSize}
        myRole={myRole}
        roleLabelFontSize={roleLabelFontSize}
        remainingPathPoints={remainingPathPoints}
        maxPoints={maxPoints}
        pathGaugeSegments={pathGaugeSegments}
        sidePanelWidth={sidePanelWidth}
        p1Name={p1Name}
        p2Name={p2Name}
        p1Record={p1Record}
        p2Record={p2Record}
        p1UserId={p1UserId}
        p2UserId={p2UserId}
        openProfileSlot={openProfileSlot}
        setOpenProfileSlot={setOpenProfileSlot}
        displayHp={displayHp}
        shakingHeart={shakingHeart}
        showAiThinking={showAiThinking}
      />
      <MatchChatPanel
        darkMode={darkMode}
        chatScrollRef={chatScrollRef}
        chatInputRef={chatInputRef}
        chatMessages={chatMessages}
        chatInput={chatInput}
        onChangeChatInput={setChatInput}
        onSendChat={() => void sendChat()}
      />
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
      <p>(c) 2024 TBS Arena</p>
    </footer>

    <MatchGlobalStyles />
  </main>
);
}


