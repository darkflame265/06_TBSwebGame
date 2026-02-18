# 1v1 Turn-Based Strategy Web MVP

Next.js (App Router) + TypeScript + Tailwind + Supabase (Postgres/Auth/Realtime) + Vercel.

## MVP Features
- Anonymous guest login (Supabase Anonymous Auth)
- Friend match: create room -> join by code -> start 1v1
- Random matchmaking queue (ticket-based, stale-safe)
- Turn-based actions saved as JSON
- Server-side turn validation via RPC
- Realtime updates for turns and match state changes
- Match leave button: leaving player exits, opponent sees leave notice

## Tech Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth / Postgres / Realtime
- Vercel

## Project Structure
- `src/app`: pages and API route handlers
- `src/components`: lobby and match UI
- `src/lib`: Supabase clients and API helpers
- `supabase/migrations`: schema, RLS, RPC SQL
- `docs/api.md`: API docs

## Environment Variables
Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

Notes:
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Enable Anonymous auth in Supabase provider settings.

## Supabase Setup
Run these in Supabase SQL Editor, in order:
1. `supabase/migrations/202602180001_init_mvp.sql`
2. `supabase/migrations/202602180002_matchmaking_ticket.sql`
3. `supabase/migrations/202602180003_match_leave.sql`

Then enable:
- `Authentication > Providers > Anonymous`

## Local Run
```bash
npm install
npm run dev
```

## Deploy (Vercel)
1. Import GitHub repo
2. Set env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy

## Realtime Behavior
- Subscribe to `public.turns` INSERT for new turns.
- Subscribe to `public.matches` UPDATE for immediate match-end sync (e.g. opponent leaves).

## Security
If any key was exposed, rotate keys in Supabase and update both Vercel env and `.env.local`.
