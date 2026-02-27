import type { MatchChatMessage } from "@/types/api";
import { CHAT_MATCH_WINDOW_MS } from "./constants";
import type { Coord, DisplayBoard } from "./types";

export const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];

export const isOrthogonalStep = (from: Coord, to: Coord) =>
  Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export const coordToPx = ([row, col]: Coord, cellSize: number, gap: number) => ({
  left: col * (cellSize + gap) + cellSize / 2,
  top: row * (cellSize + gap) + cellSize / 2,
});

export const heartsForHp = (hp: number) => [0, 1, 2].map((i) => i < hp);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const pathEquals = (a: Coord[], b: Coord[]) =>
  a.length === b.length && a.every((coord, idx) => sameCoord(coord, b[idx]));

export const parsePath = (value: unknown): Coord[] => {
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

export const toMs = (iso: string) => {
  const v = Date.parse(iso);
  return Number.isNaN(v) ? 0 : v;
};

export const isLikelySameChat = (
  a: Pick<MatchChatMessage, "user_id" | "message" | "created_at">,
  b: Pick<MatchChatMessage, "user_id" | "message" | "created_at">,
) =>
  a.user_id === b.user_id &&
  a.message === b.message &&
  Math.abs(toMs(a.created_at) - toMs(b.created_at)) <= CHAT_MATCH_WINDOW_MS;

export const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
};

export const buildRenderablePathPoints = (start: Coord, path: Coord[]) => {
  if (path.length === 0) return [start];
  if (!isOrthogonalStep(start, path[0])) return [...path];
  return [start, ...path];
};

export const deriveCollisionAt = (
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

export const progressOnSegment = (
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
