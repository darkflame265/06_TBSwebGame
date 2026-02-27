import type { MatchChatMessage } from "@/types/api";

export type Coord = [number, number];

export type DisplayBoard = { p1: Coord; p2: Coord };

export type CollisionMeta = {
  collision: boolean;
  hitSlot: 1 | 2 | null;
  collisionAt: Coord | null;
  collisionStep: number | null;
  collisionT: number | null;
};

export type LocalChatMessage = MatchChatMessage & { optimistic?: boolean };

export type ChatRealtimeRow = {
  id: number;
  match_id: string;
  user_id: string;
  message: string;
  created_at: string;
};
