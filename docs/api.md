# API Endpoints (MVP)

All requests require:
- `Authorization: Bearer <supabase_access_token>`

## `POST /api/rooms/create`
Create a friend room.

Response:
```json
{
  "match_id": "uuid",
  "room_code": "AB12CD34"
}
```

## `POST /api/rooms/join`
Join friend room by invite code.

Request:
```json
{
  "roomCode": "AB12CD34"
}
```

Response:
```json
{
  "match_id": "uuid"
}
```

## `POST /api/matchmaking/join`
Join random queue or get matched instantly.

Request (optional):
```json
{
  "ticketId": "uuid"
}
```

Response (queued):
```json
{
  "status": "queued",
  "ticket_id": "uuid"
}
```

Response (matched):
```json
{
  "status": "matched",
  "match_id": "uuid",
  "ticket_id": "uuid"
}
```

## `GET /api/matches/:matchId`
Get match state, board state, players, and submitted paths.
This endpoint also runs a server-side round tick (`tick_match_round`) to resolve expired planning rounds.

## `POST /api/matches/:matchId/turns`
Submit current round path.

Request:
```json
{
  "action": {
    "path": [[0, 4], [1, 4]]
  }
}
```

Validation:
- Match participant only
- Match must be `active`
- One submission per player per round
- `path.length <= min(current_turn, 10)`
- Orthogonal move only (no diagonal)
- In-bounds coordinates on 7x7 board (`0..6`)

Round resolution:
- If both players submitted, resolve immediately
- If timer expires, resolve with missing path as stay-in-place

## `POST /api/matches/:matchId/leave`
Leave and finish the match.

Effects:
- `matches.status = 'finished'`
- `matches.ended_reason = 'player_left'`
- `matches.left_by = current_user`
