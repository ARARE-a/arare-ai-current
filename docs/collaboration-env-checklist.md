# Collaboration Environment Checklist

Use this checklist when handing the project to another developer.
Values should be filled in a password manager or secure secret share, not committed to Git.

## GitHub

- [ ] Collaborator invited to `ARARE-a/arare-ai-current`
- [ ] Permission level decided: read / write / admin
- [ ] Branch to work from: `main`

## Vercel

- [ ] Collaborator added to the Vercel project/team
- [ ] Project confirmed: `arare-ai-three`
- [ ] Production URL confirmed: `https://arare-ai-three.vercel.app`
- [ ] Environment variables reviewed
- [ ] Deploy logs accessible

Required Vercel env vars:

```env
DATABASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_SMS_FROM=
TWILIO_VALIDATE_CALLBACK_SIGNATURE=
PUBLIC_APP_URL=
VOICE_RELAY_WS_URL=
VOICE_RELAY_SHARED_SECRET=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ARARE_PLATFORM_ADMIN_EMAILS=
CRON_SECRET=
```

## Render

- [ ] Collaborator added to Render workspace/project
- [ ] Service confirmed: `arare-ai-voice-relay`
- [ ] Service URL confirmed: `https://arare-ai-voice-relay.onrender.com`
- [ ] Logs accessible
- [ ] Manual deploy access confirmed

Required Render env vars:

```env
DATABASE_URL=
OPENAI_API_KEY=
OPENAI_REALTIME_MEDIA_ENABLED=true
OPENAI_REALTIME_MEDIA_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_MEDIA_VOICE=cedar
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_REALTIME_AGENT_ENABLED=true
OPENAI_REALTIME_AGENT_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_AGENT_VOICE=cedar
OPENAI_REALTIME_AGENT_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_REALTIME_AGENT_REASONING_EFFORT=low
OPENAI_REALTIME_AGENT_VAD_MODE=server_vad
OPENAI_REALTIME_AGENT_SERVER_VAD_THRESHOLD=0.5
OPENAI_REALTIME_AGENT_SERVER_VAD_PREFIX_PADDING_MS=300
OPENAI_REALTIME_AGENT_SERVER_VAD_SILENCE_DURATION_MS=900
OPENAI_REALTIME_AGENT_MAX_OUTPUT_TOKENS=512
OPENAI_REALTIME_AGENT_MANUAL_TURN_CONTROL=true
OPENAI_REALTIME_AGENT_BARGE_IN_DELAY_MS=450
OPENAI_REALTIME_AGENT_SHORT_BACKCHANNEL_MAX_MS=900
OPENAI_REALTIME_AGENT_LOW_CONFIDENCE_THRESHOLD=0.58
OPENAI_REALTIME_AGENT_TRANSCRIPTION_WATCHDOG_MS=2500
OPENAI_REALTIME_AGENT_DUPLICATE_TURN_WINDOW_MS=8000
OPENAI_REALTIME_AGENT_RESPONSE_WATCHDOG_MS=12000
OPENAI_REALTIME_REQUIRE_TWILIO_SIGNATURE=true
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
PUBLIC_APP_URL=https://arare-ai-three.vercel.app
VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE=true
VOICE_RELAY_TTS_PROVIDER=Amazon
VOICE_RELAY_TTS_VOICE=Takumi-Neural
VOICE_RELAY_TRANSCRIPTION_PROVIDER=Google
VOICE_RELAY_SPEECH_MODEL=telephony
VOICE_RELAY_SPEECH_TIMEOUT_MS=1200
VOICE_RELAY_USD_TO_JPY=150
```

## Supabase

- [ ] Collaborator added to Supabase organization/project
- [ ] Project confirmed
- [ ] Database password available through secure channel
- [ ] Connection string available through secure channel
- [ ] Migrations/backups access confirmed

Required value:

```env
DATABASE_URL=
```

## Twilio

- [ ] Collaborator added to Twilio account, or screensharing process agreed
- [ ] Active phone number confirmed
- [ ] Voice webhook confirmed
- [ ] SMS status callback confirmed
- [ ] Call logs accessible
- [ ] SMS logs accessible

Required values:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_SMS_FROM=
```

Production webhook values:

```text
Voice webhook:
https://arare-ai-voice-relay.onrender.com/api/twilio/voice

SMS status callback:
https://arare-ai-three.vercel.app/api/twilio/sms/status
```

## OpenAI Platform

- [ ] Collaborator added to OpenAI organization/project if possible
- [ ] API key access method decided
- [ ] Billing/credit status confirmed
- [ ] Usage page accessible
- [ ] Monthly spend limit/auto recharge reviewed

Required value:

```env
OPENAI_API_KEY=
```

Known current risk:

```text
Phone AI cannot complete production Realtime tests if OpenAI API credit is insufficient.
```

## Clerk

- [ ] Collaborator added to Clerk app/project
- [ ] Publishable key available
- [ ] Secret key available through secure channel
- [ ] Admin/user roles reviewed

Required values:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
ARARE_PLATFORM_ADMIN_EMAILS=
```

## Final Handoff Checks

- [ ] Collaborator can clone repo
- [ ] Collaborator can run `npm install`
- [ ] Collaborator can run `npm run build`
- [ ] Collaborator can access Vercel logs
- [ ] Collaborator can access Render logs
- [ ] Collaborator can inspect Supabase tables
- [ ] Collaborator can inspect Twilio call/SMS logs
- [ ] Collaborator can inspect OpenAI usage/billing
- [ ] Collaborator understands that real phone verification requires OpenAI credit

