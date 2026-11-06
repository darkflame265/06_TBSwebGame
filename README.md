# 1:1 턴제 전략 웹게임 — PathClash 초기 프로토타입

방을 만들고 상대와 연결해 턴제 대전을 진행하는 웹게임 프로토타입입니다. 이후 **08_PathClash**로 이어진 초기 개발 프로젝트로, 매칭·턴 검증·실시간 동기화 등 온라인 대전의 기반 기능을 실험했습니다.

**현재 공개 체험은 제공하지 않습니다.** 이 저장소는 초기 구현 내용과 개발 과정을 보관하기 위한 자료입니다. 아래 실행 방법은 개발 환경을 직접 구성할 때 참고하는 안내입니다.

## 어떤 프로젝트인가요?

로그인 절차를 간소화한 게스트 진입, 방 코드로 상대를 초대하는 친구 대전, 랜덤 매칭과 게임 상태 동기화를 구현한 초기 웹게임입니다. 게임 화면은 Next.js, 대전 데이터와 실시간 상태 전달은 Supabase를 사용합니다.

후속작인 PathClash의 현재 소스나 서비스와 동일한 버전은 아닙니다. 여기서는 후속작 이전의 대전 구조와 구현 방식을 확인할 수 있습니다.

## 구현한 주요 기능

| 기능 | 설명 |
|---|---|
| 게스트 진입 | Supabase 익명 인증을 이용해 계정 입력 없이 입장 |
| 친구 대전 | 방 생성 → 코드 공유 → 상대 입장 → 1:1 대전 시작 |
| 랜덤 매칭 | 대기열 티켓을 사용해 대전 상대 연결 |
| 턴제 진행 | 각 행동과 진행 상태를 JSON 데이터로 저장 |
| 서버 측 검증 | 데이터베이스 RPC에서 행동·차례 조건 확인 |
| 실시간 갱신 | Realtime 구독으로 턴과 경기 상태 변경 전달 |
| 대전 종료 | 퇴장한 사용자와 남은 상대에게 종료 상태 전달 |

## 기술 구성

- **화면·API:** Next.js App Router, TypeScript
- **스타일:** Tailwind CSS
- **인증·데이터:** Supabase Auth, Postgres
- **실시간 동기화:** Supabase Realtime
- **개발 당시 배포 환경:** Vercel

```text
src/app/              화면과 API 경로
src/components/       로비·대전 UI
src/lib/              Supabase 연결과 게임 보조 로직
supabase/migrations/  테이블·RLS·RPC 정의
docs/api.md           API 설명
```

## 로컬 개발 환경 구성

Node.js와 별도로 구성한 Supabase 프로젝트가 필요합니다. 저장소만 내려받아 HTML 파일을 여는 방식으로는 대전을 실행할 수 없습니다.

### 1. 패키지 설치

```sh
npm ci
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env.local`을 만듭니다. 아래 값은 입력 형식을 보여주는 예시입니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용하며 브라우저 코드나 공개 저장소에 넣지 않습니다.

### 3. Supabase 구성

1. `supabase/migrations/`의 SQL 파일을 파일명 순서대로 적용합니다.
2. 인증 설정에서 익명 로그인을 활성화합니다.
3. 턴·경기 상태 변경을 구독할 수 있도록 Realtime 설정을 확인합니다.

### 4. 개발 서버 실행

```sh
npm run dev
```

터미널에 표시된 로컬 주소로 접속합니다. 실제 매칭과 대전은 연결한 Supabase 설정·상태에 따라 별도 확인이 필요합니다.

## 개발 기록으로 남긴 내용

- 게스트 인증부터 방 생성·입장으로 이어지는 흐름
- 매칭 대기열과 오래된 티켓 처리
- 클라이언트 UI와 서버 측 턴 검증의 역할 분리
- 실시간 구독을 통한 대전 상태 전달
- 퇴장과 종료 상태의 처리

현재 서비스의 완성도를 소개하는 저장소보다는, 후속 PathClash 개발 이전의 구현 과정을 보여주는 프로토타입 기록입니다.
