# OpenAI Realtime電話AI 並行検証手順

## 目的

現行のTwilio ConversationRelayを残したまま、Twilio Media StreamsとOpenAI Realtimeを使う高品質音声経路を別URLで検証する。

## 経路

- 現行: `POST /api/twilio/voice` -> ConversationRelay
- 新規検証: `POST /api/twilio/voice/realtime` -> bidirectional Media Stream -> OpenAI Realtime
- 新規WebSocket: `WSS /openai-realtime-media`
- SMS、予約DB、CallLog、Conversation、通知履歴は既存処理を共通利用する。

新規経路は `OPENAI_REALTIME_MEDIA_ENABLED=true` のときだけ接続する。既定値は `false`。

## Render環境変数

```env
OPENAI_REALTIME_MEDIA_ENABLED=true
OPENAI_REALTIME_MEDIA_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_MEDIA_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-transcribe
VOICE_RELAY_USD_TO_JPY=150
```

既存の `DATABASE_URL`、`OPENAI_API_KEY`、`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_PHONE_NUMBER`、`PUBLIC_APP_URL`、`VOICE_RELAY_SHARED_SECRET` も必要。

## Twilio側の並行確認

本番番号を即時に切り替えず、可能なら検証番号またはTwilioのテスト用TwiML Appで次をVoice Webhookに設定する。

```text
https://arare-ai-voice-relay.onrender.com/api/twilio/voice/realtime
```

HTTP methodは `POST`。現行Webhook URLは記録して、いつでも戻せる状態にする。

## 自動確認

```powershell
npm run verify:realtime-media
npm run verify:voice-usage-meter
npm run verify:voice-relay
npm run verify:final
```

## 原価記録

- OpenAIの `response.done.usage` と文字起こし完了イベントの `usage` を通話中に集計する。
- 通話終了時、`StorePhoneEvent` に `VOICE_AI_USAGE_RECORDED` としてトークン数、通話秒数、適用単価、推定USD/円を保存する。
- `StoreUsageMeter` には通話件数、秒数、AIセッション数、円換算推定額を1通話につき1回だけ加算する。
- `CallLog.usageMeterRecordedAt` を使い、WebSocket closeとTwilio callbackが重なっても二重計上しない。
- OpenAI/Twilioの単価は2026-07-11時点の公式掲載値を初期値にしている。為替は `VOICE_RELAY_USD_TO_JPY` で運用時の会計レートに更新する。
- 記録額は実使用量に基づく推定であり、カード会社の為替、税、Twilioの課金丸め等を含む請求確定額ではない。請求確定額はOpenAI/Twilioの請求明細と照合する。

## 実電話の確認項目

1. 呼び出し後に無音にならず、最初の日本語案内が流れる。
2. 話し終わる前にAIが割り込まない。
3. AI発話中に話すと、古い発話が停止して新しい内容へ応答する。
4. 日時、コース、指名、氏名、電話番号、初回利用、注意事項を一項目ずつ確認する。
5. 空きがない場合は個人情報を先に取得しない。
6. 最終確認後に仮予約がDBへ1件だけ作成される。
7. SMSが実端末へ届き、TwilioのMessage statusが `delivered` または少なくとも `sent` になる。
8. 電話ログ、予約一覧、通知履歴、店舗ダッシュボードの日時・コース・担当・部屋・顧客名が一致する。
9. Renderログに `openai_realtime_media_setup`、`phone_ai_prompt`、`phone_ai_prompt_processed` が出る。
10. Twilio Media Streamに `stream-error` がなく、通話が意図せず切断されない。
11. `CallLog.usageMeterRecordedAt`、月次 `StoreUsageMeter`、`VOICE_AI_USAGE_RECORDED` が1件ずつ記録され、通話秒数と使用トークンが確認できる。

## 判定

- コードと自動テストだけ: 実装済み / ローカル確認済み
- Renderへ反映してhealthを確認: 本番構成反映済み
- 実電話、SMS、DB、各画面を照合: 本番確認済み

実電話と実SMSの照合が終わるまでは、完成または提出可能とは判定しない。
