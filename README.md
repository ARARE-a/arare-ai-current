# ARARE AI

AI Reception & Reservation Operating System

メンズエステ、リラクゼーションサロン、出張エステ向けのAI受付・予約自動化MVPです。電話、LINE、Webチャットからの予約受付、予約変更、キャンセル、顧客管理、セラピスト管理、通知、売上管理を統合します。

## 実装済み

- Next.js / React / TypeScript / TailwindCSS 管理画面
- Prisma / PostgreSQL スキーマ
- 予約、顧客、セラピスト、シフト、部屋、コース、売上、通知、会話ログAPI
- ダブルブッキング防止
- ブラックリスト、ブロック枠、監査ログ、エスカレーション、通話ログ
- LINE webhookデモ
- WebチャットAI受付デモAPI
- OpenAI予約情報抽出API
- Twilio Voice着信Webhook
- Twilio ConversationRelay対応
- OpenAI Realtime向け電話AIリレーサーバー
- 店舗初期設定チェックリストAPI
- 本番環境ヘルスチェックAPI

## ローカル起動

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 本番URL

現在の本番URL:

```text
https://arare-ai-three.vercel.app
```

Vercelに管理画面とHTTP API、SupabaseにPostgreSQLを配置します。ConversationRelayのWebSocketは長時間接続が必要なため、Railway、Render、Fly.io、Cloud RunなどWebSocket対応環境で別プロセスとして起動します。

## 環境変数

```env
DATABASE_URL="postgresql://..."
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5.2"
OPENAI_REALTIME_MODEL="gpt-realtime-2"
LINE_CHANNEL_SECRET=""
LINE_CHANNEL_ACCESS_TOKEN=""
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_PHONE_NUMBER=""
TWILIO_SMS_FROM=""
TWILIO_VALIDATE_CALLBACK_SIGNATURE="false"
PUBLIC_APP_URL="https://arare-ai-three.vercel.app"
VOICE_RELAY_WS_URL="wss://<voice-relay-host>/conversation-relay?token=<secret>"
VOICE_RELAY_SHARED_SECRET=""
VOICE_RELAY_PORT="8787"
CLERK_SECRET_KEY=""
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARARE_PLATFORM_ADMIN_EMAILS=""
CRON_SECRET=""
```

## 主要API

| API | 内容 |
| --- | --- |
| `GET /api/admin/state` | 管理画面用の統合データ |
| `GET /api/reservations` | 予約一覧 |
| `POST /api/reservations` | 予約作成 |
| `PUT /api/reservations` | 空き枠検索 |
| `PATCH /api/reservations/:id` | 予約更新 |
| `DELETE /api/reservations/:id` | 予約キャンセル |
| `GET /api/customers` | 顧客一覧 |
| `POST /api/customers` | 顧客作成 |
| `GET /api/therapists` | セラピスト一覧 |
| `POST /api/shifts` | シフト作成 |
| `POST /api/ai/reception` | LINE/Web/電話共通AI受付デモ |
| `POST /api/ai/extract` | OpenAI予約情報抽出 |
| `GET /api/health` | 本番環境設定チェック |
| `GET /api/setup/checklist` | 店舗初期設定チェック |
| `POST /api/line/webhook` | LINE webhook |
| `POST /api/twilio/voice` | Twilio Voice着信。ConversationRelay設定済みならリアルタイム電話AIへ接続 |
| `POST /api/twilio/voice/gather` | ConversationRelay未設定時の音声入力フォールバック |
| `POST /api/twilio/voice/connect-status` | ConversationRelay終了・引き継ぎログ |
| `POST /api/twilio/voice/recording` | Twilio録音URL保存 |
| `POST /api/twilio/sms/status` | Twilio SMS到達callback。delivered/failed/undeliveredを通知DBへ反映 |
| `GET /api/permissions/users` | Clerkログインメールと店舗権限マッピング |
| `POST /api/permissions/users` | 店舗権限ユーザーの追加・更新 |
| `POST /api/reminders/run` | リマインド実行 |
| `GET /api/sales` | 売上集計 |

## AI受付ルール

AIは予約時に必ず以下を確認します。

- 名前
- 電話番号
- 希望日時
- コース
- 指名有無
- 来店経験
- 注意事項確認
- 最終予約内容の復唱

不明点がある場合は予約確定しません。YES取得後のみ確定予約に進みます。

## 電話AIの本番方針

電話AIは `Twilio Voice + ConversationRelay + OpenAI Realtime` を本命構成にします。Twilioが電話回線、着信、STT/TTS、低遅延WebSocketを担い、ARARE AIのリレーサーバーがOpenAI Realtimeと予約APIを制御します。

100店舗前提のマルチ店舗設計は [docs/100-store-voice-ai-architecture.md](docs/100-store-voice-ai-architecture.md) にまとめています。実装時は、この設計書の成功条件を満たすまで完了扱いにしません。

基本フロー:

1. 電話着信
2. Twilioが `/api/twilio/voice` に着信Webhookを送信
3. `VOICE_RELAY_WS_URL` が設定済みなら `<ConversationRelay>` でWebSocketへ接続
4. Twilioが顧客音声を文字起こししてリレーサーバーへ送信
5. リレーサーバーがOpenAI Realtimeへ会話文脈を送信
6. AIが必須項目を順番に確認
7. 空き枠、部屋、セラピスト、NG客は予約API/DBで確認
8. AIが予約内容を復唱
9. 顧客がOK
10. 仮予約またはReservationHoldを作成
11. 通話ログ、文字起こし、AI要約を保存
12. 必要に応じてスタッフ確認後に予約確定通知を送信

以下は電話AIでは確定せず、人間対応へエスカレーションします。

- 聞き取り不確実
- クレーム
- 値引き交渉
- 返金
- 個人的な連絡先の要求
- NGワード
- ブラックリスト疑い
- 予約ルール例外

## Twilio設定

Twilio Voiceの着信Webhook:

```text
https://arare-ai-three.vercel.app/api/twilio/voice
```

Methodは `POST` にします。

Twilio SMSのStatus Callback:

```text
https://arare-ai-three.vercel.app/api/twilio/sms/status
```

通常の予約確定SMSはアプリ側が送信時に `StatusCallback` を付与します。Twilio ConsoleでMessaging Serviceを使う場合も、同じURLをStatus Callbackに設定します。`TWILIO_VALIDATE_CALLBACK_SIGNATURE=true` にする場合は、`PUBLIC_APP_URL` が本番URLと完全一致している必要があります。

ConversationRelayを有効にするには、WebSocket対応ホストで以下を起動します。

```bash
npm run voice:relay
```

公開URL例:

```text
wss://<voice-relay-host>/conversation-relay?token=<VOICE_RELAY_SHARED_SECRET>
```

このURLをVercelの `VOICE_RELAY_WS_URL` に設定します。未設定の場合、`/api/twilio/voice` は旧来の `<Gather>` デモ受付にフォールバックします。

## 本番連携の確認

```bash
npm run verify:production -- https://arare-ai-three.vercel.app
```

`features` がすべて `true` になれば、Supabase/PostgreSQL、OpenAI、LINE、Twilio、Clerkのキーが読み込まれています。
## 運用デモ・本番準備チェック

営業デモ前は運用画面とAPIで未接続項目を確認します。

```text
https://arare-ai-three.vercel.app/ops
https://arare-ai-three.vercel.app/api/health
https://arare-ai-three.vercel.app/api/setup/checklist
```

デモ必須:

- DB / PostgreSQL: `DATABASE_URL`
- OpenAI: `OPENAI_API_KEY`
- Twilio電話AI/SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- 電話AIルート: 店舗電話設定でAI受付を有効化し、Voice Webhookを `/api/twilio/voice` に向ける
- SMS: Twilio接続後、通知の送信済み、到達callback、失敗件数を `/platform` と店舗画面で確認する
- 本番URL: `PUBLIC_APP_URL=https://arare-ai-three.vercel.app`
- 実運用テスト: 予約作成、電話AI着信、SMS通知、キャンセル、エスカレーションを本番URLで1周確認する

後続タスクとして明示:

- LINE: `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` は未設定でも営業デモ可。本番LINE連携前に設定する
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` と `CLERK_SECRET_KEY` は未設定でも営業デモ可。本番で管理画面を認証保護する前に設定する。全店舗のPlatform画面を開ける管理者は `ARARE_PLATFORM_ADMIN_EMAILS` へカンマ区切りで設定する
