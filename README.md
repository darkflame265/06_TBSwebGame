# 1v1 Turn-Based Strategy Web MVP

Next.js(App Router) + TypeScript + Tailwind + Supabase(Postgres/Auth/Realtime) 기반 1:1 온라인 턴제 전략 게임 MVP입니다.

## MVP 범위

- 게스트 로그인(Supabase Anonymous Auth)
- 친구 대전: 방 생성 -> 코드로 참가 -> 1:1 시작
- 랜덤 매칭: 큐 참가 -> 2명 매칭 시 매치 생성
- 턴제 진행: 액션 JSON 저장 + 서버(RPC) 유효성 검증
- Realtime: `turns` insert 이벤트 구독으로 즉시 로그 갱신
- UI: 로비 + 매치 화면

## 기술 스택

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth / Postgres / Realtime
- Vercel 배포

## 디렉터리

- `src/app`: 페이지 및 API Route Handlers
- `src/components`: 로비/매치 클라이언트 컴포넌트
- `src/lib`: Supabase 클라이언트 및 API 유틸
- `supabase/migrations`: 스키마 + RLS + RPC SQL
- `docs/api.md`: 엔드포인트 문서

## SuperBase 비번 : Master2490!@

## 환경 변수

`.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

주의:

- `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용해야 하며 브라우저로 노출되면 안 됩니다.
- Supabase 프로젝트에서 Anonymous Auth를 활성화해야 게스트 로그인이 동작합니다.

## Supabase 설정

1. Supabase 프로젝트 생성
2. SQL Editor에서 아래 순서로 실행
   - `supabase/migrations/202602180001_init_mvp.sql`
   - `supabase/migrations/202602180002_matchmaking_ticket.sql`
3. Authentication > Providers에서 Anonymous 활성화
4. Project Settings > API에서 URL/Anon Key/Service Role Key 확인

## 로컬 실행

1. Node.js 20+ 설치
2. 의존성 설치

```bash
npm install
```

3. 실행

```bash
npm run dev
```

4. 브라우저에서 `http://localhost:3000` 접속

## Vercel 배포

1. Git 리포지토리를 Vercel에 연결
2. Environment Variables에 아래 3개 등록
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy 실행

## 턴 검증 방식

- 클라이언트는 `POST /api/matches/:matchId/turns`에 `action` JSON 전송
- 서버는 Supabase RPC `submit_turn` 호출
- RPC 내부에서 match row lock + 참여자 검증 + 턴 순서 검증 + 중복 턴 방지를 원자적으로 처리

## Realtime 갱신

- 클라이언트는 `public.turns` 테이블의 `INSERT` 이벤트를 `match_id` 필터로 구독
- 새 턴이 들어오면 매치 데이터를 다시 조회해 UI를 갱신

## API 문서

- `docs/api.md`
