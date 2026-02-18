export type MatchStatus = "waiting" | "active" | "finished";
export type MatchType = "friend" | "random";

export type MatchResponse = {
  id: string;
  type: MatchType;
  status: MatchStatus;
  room_code: string | null;
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
  planning_ends_at: string | null;
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
