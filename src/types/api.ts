export type MatchStatus = "waiting" | "active" | "finished";
export type MatchType = "friend" | "random" | "ai";

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
  obstacles: Array<[number, number]> | null;
  obstacles_turn: number | null;
  p1_hp: number;
  p2_hp: number;
  attacker_slot: 1 | 2;
  rematch_p1_requested: boolean;
  rematch_p2_requested: boolean;
  rematch_match_id: string | null;
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
    collision_step?: number | null;
    collision_t?: number | null;
    collision_at?: [number, number] | null;
  } | null;
  created_at: string;
  players: Array<{
    user_id: string;
    nickname: string | null;
    wins: number;
    losses: number;
    win_rate: number;
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

export type MatchLiveResponse = Omit<MatchResponse, "players"> & {
  players?: MatchResponse["players"];
};

export type MatchChatMessage = {
  id: number;
  match_id: string;
  user_id: string;
  nickname: string | null;
  message: string;
  created_at: string;
};
