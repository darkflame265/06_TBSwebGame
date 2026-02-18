# API Endpoints (MVP)

모든 요청은 `Authorization: Bearer <supabase_access_token>` 헤더가 필요합니다.

## `POST /api/rooms/create`
- 설명: 친구 대전 방 생성
- 응답:
```json
{
  "match_id": "uuid",
  "room_code": "AB12CD34"
}
```

## `POST /api/rooms/join`
- 설명: 초대 코드로 친구 방 참가
- 요청:
```json
{
  "roomCode": "AB12CD34"
}
```
- 응답:
```json
{
  "match_id": "uuid"
}
```

## `POST /api/matchmaking/join`
- 설명: 랜덤 매칭 큐 참가 또는 즉시 매칭
- 요청(선택): 동일 큐 세션 유지용 ticket
```json
{
  "ticketId": "uuid"
}
```
- 응답(대기):
```json
{
  "status": "queued",
  "ticket_id": "uuid"
}
```
- 응답(성공 매칭):
```json
{
  "status": "matched",
  "match_id": "uuid",
  "ticket_id": "uuid"
}
```

## `GET /api/matches/:matchId`
- 설명: 매치 상태, 플레이어 목록, 턴 로그 조회
- 응답:
```json
{
  "id": "uuid",
  "type": "friend",
  "status": "active",
  "room_code": "AB12CD34",
  "current_turn": 3,
  "current_player_slot": 1,
  "created_at": "2026-02-18T00:00:00.000Z",
  "players": [],
  "turns": []
}
```

## `POST /api/matches/:matchId/turns`
- 설명: 현재 턴 행동(JSON payload) 제출
- 요청:
```json
{
  "action": {
    "type": "MOVE",
    "unitId": "u1",
    "to": [2, 3]
  }
}
```
- 검증:
  - 매치 참여자인지
  - 매치 상태가 `active`인지
  - 내 턴인지
  - 이미 제출된 턴 번호 중복 여부
