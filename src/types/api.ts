export type MatchStatus = "waiting" | "active" | "finished";
export type MatchType = "friend" | "random";

export type MatchResponse = {
  id: string;
  type: MatchType;
  status: MatchStatus;
  room_code: string | null;
  phase: "planning" | "resolving";
  current_turn: number;
  current_player_slot: number;
  winner_slot: number | null;
  ended_reason: "player_left" | "normal" | null;
  left_by: string | null;
  ended_at: string | null;
  board_state: {
    p1: [number, number];
    p2: [number, number];
  } | null;
  p1_hp: number;
  p2_hp: number;
  attacker_slot: 1 | 2;
  planning_ends_at: string | null;
  resolution_ends_at: string | null;
  resolved_paths: {
    turn: number;
    start: {
      p1: [number, number];
      p2: [number, number];
    };
    p1: Array<[number, number]>;
    p2: Array<[number, number]>;
    collision?: boolean;
    hit_slot?: 1 | 2 | null;
  } | null;
  created_at: string;
  players: Array<{
    user_id: string;
    slot: number;
    joined_at: string;
  }>;
  turns: Array<{
    id: number;
    turn_number: number;
    player_slot: number;
    action_payload: Record<string, unknown>;
    created_by: string;
    created_at: string;
  }>;
};
