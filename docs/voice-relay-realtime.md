# Voice Relay / OpenAI Realtime 本番化手順

## 目的

Twilio ConversationRelay から ARARE AI のWebSocketサーバーへ接続し、OpenAI Realtimeで電話中に自然な会話応答を返します。

現在のVercelはHTTP API向けです。長時間WebSocketは別ホストで動かします。

## 実装済み

- `scripts/voice-relay-server.mjs`
  - `/health`
  - `/conversation-relay`
  - Twilio `setup` / `prompt` / `interrupt` / `dtmf` / `error` 対応
  - OpenAI Realtime WebSocket接続
  - `CallLog` の `storeId` / `toNumber` / `twilioCallSid` 更新
- `npm run voice:relay`
- `npm run verify:voice-relay`
- `railway.json`
- `render.yaml`
- `Procfile`

## 必要な環境変数

Relayホスト側に設定します。

```env
DATABASE_URL="SupabaseのPostgreSQL URL"
OPENAI_API_KEY="OpenAI APIキー"
OPENAI_REALTIME_MODEL="gpt-realtime-2"
VOICE_RELAY_SHARED_SECRET="任意の長いランダム文字列"
VOICE_RELAY_PORT="8787"
TWILIO_AUTH_TOKEN="Twilio Auth Token"
VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE="false"
```

最初の疎通では `VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE=false` で進めます。安定後に署名検証を有効化します。

## Railwayで動かす場合

1. Railwayで新規プロジェクトを作成
2. GitHubまたはローカルからこのリポジトリを接続
3. Start Command は `npm run voice:relay`
4. 環境変数を設定
5. デプロイ
6. `/health` が200になることを確認

公開URLが以下のように出ます。

```text
https://arare-ai-voice-relay-production.up.railway.app
```

ConversationRelay用URLは `https://` を `wss://` にして、パスとtokenを付けます。

```text
wss://arare-ai-voice-relay-production.up.railway.app/conversation-relay?token=<VOICE_RELAY_SHARED_SECRET>
```

## Renderで動かす場合

1. RenderでNew Web Service
2. RuntimeはNode
3. Build Command:

```bash
npm install && npm run prisma:generate
```

4. Start Command:

```bash
npm run voice:relay
```

5. 環境変数を設定
6. `/health` を確認

## ARARE AI側の設定

電話AI設定画面:

```text
https://arare-ai-three.vercel.app/phone-ai
```

`ConversationRelay WebSocket URL` に以下を入れます。

```text
wss://<relay-host>/conversation-relay?token=<VOICE_RELAY_SHARED_SECRET>
```

保存後、Twilio番号に電話すると、Vercelの `/api/twilio/voice` が `<ConversationRelay>` TwiMLを返します。

## 検証

ローカルでRelayを起動:

```bash
npm run voice:relay
```

別ターミナルで:

```bash
npm run verify:voice-relay
```

本番Relay URLを直接確認:

```bash
npm run verify:voice-relay -- wss://<relay-host>/conversation-relay?token=<secret>
```

## 成功条件

- `/health` が `ok: true`
- `openaiConfigured: true`
- `databaseConfigured: true`
- `verify:voice-relay` が成功
- Twilio着信後のTwiMLに `<ConversationRelay>` が含まれる
- 実電話でAIが追加質問を返す
- `CallLog.transcript` に「お客様」と「AI」の両方が保存される

## 注意

- WebSocketホストはPCを閉じても動く場所に置きます。
- ローカルPCや一時トンネルは検証用で、本番運用には使いません。
- 100店舗前提では最初は1つのRelayで開始し、同時通話が増えたら水平スケールします。
