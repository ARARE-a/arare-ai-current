# ARARE AI Architecture Overview

This document explains the source code repository, production runtime, and major external services for collaborators.
Do not write API keys, database URLs, auth tokens, or passwords in this document.

## Source Repository

- Repository: https://github.com/ARARE-a/arare-ai-current
- Main branch: `main`
- Main app: Next.js application deployed to Vercel
- Voice service: Node.js voice relay deployed to Render
- Database ORM: Prisma
- Database: PostgreSQL on Supabase

## Production Runtime

| Area | Service | Production URL / role |
| --- | --- | --- |
| Web app | Vercel | https://arare-ai-three.vercel.app |
| Voice relay | Render | https://arare-ai-voice-relay.onrender.com |
| Database | Supabase PostgreSQL | Stores reservations, stores, call logs, SMS logs, permissions |
| Phone/SMS | Twilio | Receives phone calls and sends SMS |
| Realtime AI | OpenAI Realtime API | Handles voice AI conversation |
| Auth | Clerk | Protects management screens and role-based access |

## High-Level Architecture

```text
Customer phone call
  -> Twilio phone number
  -> Render voice relay /api/twilio/voice
  -> OpenAI Realtime voice agent
  -> Reservation tools / PostgreSQL
  -> SMS send through Twilio
  -> Store dashboard on Vercel
```

```text
Store/admin browser
  -> Vercel Next.js app
  -> Clerk auth
  -> Next.js API routes
  -> Prisma
  -> Supabase PostgreSQL
```

## Main Application Areas

| Area | Purpose |
| --- | --- |
| Store dashboard | Shows today's bookings, room status, therapists, AI call/chat logs |
| Reservation management | Creates, edits, confirms, and cancels bookings |
| Phone AI | Accepts phone reservations and writes call logs/reservation data |
| Web chat | Accepts reservation requests through a browser chat UI |
| Notification/SMS | Sends reservation notifications and tracks delivery status |
| Customer management | Shows customer reservation and conversation history |
| Therapist management | Manages therapist availability and assignments |
| Room management | Tracks available rooms and booking conflicts |
| Knowledge base / FAQ | Controls information used by AI responses |
| Permission management | Maps Clerk users to owner/manager/staff roles |
| Operations monitor | Shows readiness checks, logs, and integration status |

## Important Production Endpoints

| Endpoint | Purpose |
| --- | --- |
| `https://arare-ai-three.vercel.app` | Main production web app |
| `https://arare-ai-voice-relay.onrender.com/health?deep=1` | Voice relay health check |
| `https://arare-ai-voice-relay.onrender.com/api/twilio/voice` | Twilio voice webhook |
| `https://arare-ai-three.vercel.app/api/twilio/sms/status` | Twilio SMS status callback |

## Key Configuration Areas

Environment variables are managed separately in Vercel and Render.
The names are listed in `docs/collaboration-env-checklist.md`, but values must be shared through a secure secret channel.

Important groups:

- Database: `DATABASE_URL`
- OpenAI: `OPENAI_API_KEY`, Realtime model/voice settings
- Twilio: account SID, auth token, phone number, SMS sender
- Clerk: publishable key, secret key, admin emails
- Voice relay: public app URL, webhook validation, relay behavior settings

## Local Development

```bash
npm install
npm run prisma:generate
npm run build
```

Run the web app locally:

```bash
npm run dev
```

Run the voice relay locally:

```bash
npm run voice:relay
```

Database work:

```bash
npm run prisma:migrate
npm run db:seed
```

## Verification Commands

Use these after changing voice AI, booking logic, SMS, or dashboard behavior:

```bash
npm run verify:realtime-agent
npm run verify:realtime-agent-safety
npm run verify:realtime-agent-turn-control
npm run verify:voice-usage-meter
npm run verify:phone-call-recovery
npm run verify:phone-ai-regression
npm run build
```

Production checks require valid external service credentials and OpenAI API credit:

```bash
npm run verify:realtime-production-agent
npm run verify:japanese-production-voice
```

## Current Known Risk

Production Realtime phone verification depends on OpenAI API billing/credit.
If OpenAI returns insufficient quota, the code may be deployed correctly but real phone AI verification cannot complete until billing is fixed.

## Related Handoff Docs

- `docs/collaboration-handoff.md`
- `docs/collaboration-env-checklist.md`

