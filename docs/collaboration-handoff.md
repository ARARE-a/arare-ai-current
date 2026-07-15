# ARARE AI Collaboration Handoff

This document is for sharing the project structure with collaborators.
Do not paste API keys, database URLs, auth tokens, or passwords into GitHub issues, chat, or this file.

## Repository

- GitHub: https://github.com/ARARE-a/arare-ai-current
- Main branch: `main`
- Runtime: Next.js / Node.js / Prisma / PostgreSQL
- Voice relay service: Node.js WebSocket service deployed separately from Vercel

## Production URLs

- Web app: https://arare-ai-three.vercel.app
- Voice relay: https://arare-ai-voice-relay.onrender.com
- Voice relay health: https://arare-ai-voice-relay.onrender.com/health?deep=1
- Twilio voice webhook: https://arare-ai-voice-relay.onrender.com/api/twilio/voice
- Twilio SMS status callback: https://arare-ai-three.vercel.app/api/twilio/sms/status

## Main Services

| Service | Purpose | Collaborator access needed |
| --- | --- | --- |
| GitHub | Source code and deploy source | Required for development |
| Vercel | Web app and Next.js API hosting | Required for frontend/API deploy checks |
| Render | Voice relay WebSocket/API hosting | Required for phone AI deploy and logs |
| Supabase | PostgreSQL database | Required for DB inspection/migration |
| Twilio | Phone number, calls, SMS, webhook logs | Required for phone/SMS verification |
| OpenAI Platform | API key, Realtime usage, billing/usage | Required for phone AI operation |
| Clerk | Login/auth for protected screens | Required for auth/permission work |

## Current Voice AI Architecture

The current production direction is:

```text
Twilio phone number
 -> Render /api/twilio/voice
 -> Twilio Media Stream / Realtime agent route
 -> OpenAI Realtime
 -> Reservation DB / SMS / call logs
 -> Store dashboard
```

Important current settings:

- Realtime model target: `gpt-realtime-2.1-mini`
- Voice: `cedar`
- Transcription model: `gpt-4o-transcribe`
- VAD mode: `server_vad`
- Conversation flow version: `16`
- Goal: concise phone booking with minimum speech and minimum repeated confirmation

## Required Local Setup

```bash
npm install
npm run prisma:generate
npm run build
```

For local DB work:

```bash
npm run prisma:migrate
npm run db:seed
```

For local app:

```bash
npm run dev
```

For local voice relay:

```bash
npm run voice:relay
```

## Verification Commands

Use these after changing phone AI, reservation logic, or deployment config:

```bash
npm run verify:realtime-agent
npm run verify:realtime-agent-safety
npm run verify:realtime-agent-turn-control
npm run verify:voice-usage-meter
npm run verify:phone-call-recovery
npm run verify:phone-ai-regression
npm run build
```

Production phone AI checks require OpenAI API credit and valid Twilio credentials:

```bash
npm run verify:realtime-production-agent
npm run verify:japanese-production-voice
```

## Current Known Blocker

As of the latest verification, production voice relay code was deployed and health reflected `flow=16` and `gpt-realtime-2.1-mini`.

However, the production Realtime WebSocket smoke test failed with:

```text
OPENAI_INSUFFICIENT_QUOTA
```

This means the code is deployed, but OpenAI API billing/credit must be fixed before production real-call verification can pass.

## What Must Not Be Shared in GitHub

Do not commit or paste:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `TWILIO_AUTH_TOKEN`
- `VOICE_RELAY_SHARED_SECRET`
- `CLERK_SECRET_KEY`
- Supabase database passwords
- Personal/customer phone numbers beyond test-safe examples

Use the checklist in `docs/collaboration-env-checklist.md` for secure transfer.

## Recommended Access Method

Prefer adding collaborators as members to each service instead of sending raw secrets.

If raw secrets must be shared, use a password manager or expiring secret share link.
Rotate any secret that was pasted into chat or screenshots.

