# Render Voice Relay Setup

この手順は、Railwayを使わずに電話AIの実通話デモを動かすためのRender設定です。

## 前提

- Renderは主要なクレジットカード/デビットカードに対応しています。
- 無料Web Serviceは15分アイドルで停止し、復帰に約1分かかるため、実通話デモでは有料インスタンスを使います。
- Twilio ConversationRelayは `wss://` のWebSocketサーバーが必要です。

## 1. RenderでWeb Serviceを作成

1. Renderにログインします。
2. New > Web Service を選びます。
3. このリポジトリを接続します。
4. 設定は `render.yaml` のBlueprintを使います。
5. Service名は `arare-ai-voice-relay` のままで構いません。

## 2. Render環境変数

RenderのService > Environment に以下を設定します。

```text
DATABASE_URL=Supabaseの本番DATABASE_URL
OPENAI_API_KEY=OpenAI APIキー
TWILIO_ACCOUNT_SID=Twilio Account SID
TWILIO_AUTH_TOKEN=Twilio Auth Token
TWILIO_PHONE_NUMBER=TwilioのAI受付番号
PUBLIC_APP_URL=https://arare-ai-three.vercel.app
VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE=false
VOICE_RELAY_TTS_PROVIDER=Amazon
VOICE_RELAY_TTS_VOICE=Takumi-Neural
VOICE_RELAY_TRANSCRIPTION_PROVIDER=Google
```

`VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE` は、まずデモ疎通を優先して `false` にします。本番運用前に署名検証を有効化します。

## 3. Render URL確認

デプロイ後、以下にアクセスして確認します。

```text
https://<render-service>.onrender.com/health
```

期待値:

```json
{
  "ok": true,
  "service": "arare-ai-voice-relay",
  "openaiConfigured": true,
  "databaseConfigured": true
}
```

## 4. Vercel側の接続先をRenderへ向ける

Render URLが確定したら、Vercel Production環境変数に設定します。

```text
VOICE_WEBHOOK_CANONICAL_URL=https://<render-service>.onrender.com/api/twilio/voice
NEXT_PUBLIC_VOICE_WEBHOOK_URL=https://<render-service>.onrender.com/api/twilio/voice
NEXT_PUBLIC_VOICE_RELAY_WS_URL=wss://<render-service>.onrender.com/conversation-relay
```

設定後、Vercelを再デプロイします。

## 5. Twilio番号のWebhook

Twilio番号の Voice webhook は次のどちらかにします。

推奨:

```text
https://<render-service>.onrender.com/api/twilio/voice
```

Vercel経由:

```text
https://arare-ai-three.vercel.app/api/twilio/voice
```

Vercel経由にする場合は、Vercelの `VOICE_WEBHOOK_CANONICAL_URL` がRender URLになっている必要があります。

## 6. DBの電話AI設定

管理画面 `/phone-ai` で、店舗の電話AI設定に以下を入れます。

```text
AI受付番号=TwilioのAI受付番号
Webhook URL=https://<render-service>.onrender.com/api/twilio/voice
Conversation Relay URL=wss://<render-service>.onrender.com/conversation-relay
電話AI有効=true
```

## 7. 最終確認

1. `https://<render-service>.onrender.com/health` が `ok: true`
2. Twilio番号に発信して、AIが「お電話ありがとうございます。ご希望をどうぞ。」と応答
3. 管理画面 `/ops` の電話AIルートが未登録から改善
4. `/api/call-logs` または管理画面に通話ログが残る

