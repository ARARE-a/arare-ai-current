# Genspark追加投入用プロンプト: 電話AI基盤のProvider抽象化

ARARE AIの電話AI基盤は、Twilio固定ではなく、Provider差し替え可能な設計にしてください。

ただし、MVPの第一候補はTwilioです。

## 1. 基本方針

ARARE AIでは、電話AIプロバイダに業務ロジックを持たせすぎないでください。

予約DB、顧客DB、店舗設定、承認SLA、監査ログ、ReservationHold、NGルール、ナレッジ管理はARARE AI側に持たせてください。

電話AIプロバイダは、通話の入出力、音声処理、会話イベントの入口として扱います。

## 2. MVPの推奨構成

```text
MVP電話基盤: Twilio
MVP音声方式: Twilio Conversation Relay
品質検証: OpenAI Realtime SIP / Twilio Media Streams + OpenAI Realtime
高速デモ比較: Vapi / Retell AI
代替電話基盤: Telnyx / Plivo
設計方針: VoiceProviderAdapterで差し替え可能にする
```

## 3. VoiceProvider

以下のProvider種別を持たせてください。

```ts
type VoiceProvider =
  | "mock"
  | "twilio_conversation_relay"
  | "twilio_media_streams_openai_realtime"
  | "openai_realtime_sip"
  | "vapi"
  | "retell"
  | "telnyx"
  | "plivo";
```

MVPで実装必須:

- mock
- twilio_conversation_relay

MVPでは設定項目だけ用意し、実装はTODOでよいもの:

- twilio_media_streams_openai_realtime
- openai_realtime_sip
- vapi
- retell
- telnyx
- plivo

## 4. VoiceProviderAdapterの責務

`VoiceProviderAdapter` または同等のサービス層を作ってください。

責務:

- 着信開始イベントを受ける
- 店舗を特定する
- CallLogを作る
- Conversationを作る
- 音声/テキスト入力をMessageへ保存する
- AI応答を生成する
- 予約候補を抽出する
- ReservationHoldを作る
- Escalationを作る
- 通話終了イベントを保存する
- エラーをSystemHealthEventへ送る

## 5. VoiceAiSetting

店舗ごとの音声AI設定として、`VoiceAiSetting` または `AiSetting` に以下を持たせてください。

- storeId
- voiceProvider
- voiceProviderStatus
- voiceStyle
- voiceId
- sttProvider
- ttsProvider
- llmProvider
- fallbackProvider
- maxLatencyMs
- interruptionEnabled
- fillerEnabled
- humanHandoffEnabled
- emergencyFallbackPhoneNumber
- providerConfigJson

## 6. なぜTwilioをMVPにするか

ARARE AIは100店舗導入、既存番号維持、店舗ごとの電話番号転送、CallLog、Webhook、管理画面統合が必要です。

この条件では、MVPの電話基盤はTwilioが最も現実的です。

理由:

- 日本の番号料金と通話料金が明示されている
- National番号、0ABJ番号、Toll-free番号を選べる
- Conversation RelayでSTT/TTS/音声合成を扱える
- Media StreamsでOpenAI Realtimeへ拡張できる
- SIP/BYOCへ拡張できる
- 100店舗分の番号管理、Webhook、CallLog設計と相性がよい

## 7. ただしTwilioロックインは避ける

電話AIの品質は今後変わりやすいので、Twilioだけに依存しない設計にしてください。

特に「男性のイケボ」「自然な割り込み」「低遅延」を本気で詰める段階では、以下を比較できるようにしてください。

- OpenAI Realtime SIP
- Twilio Media Streams + OpenAI Realtime
- Vapi
- Retell AI
- Telnyx
- Plivo

## 8. 管理画面要件

Platform Adminまたは店舗設定画面に以下を作ってください。

- 店舗ごとのVoice Provider設定
- Providerステータス
- Mock / Twilio / OpenAI / Vapi / Retell等の選択欄
- 実装済み / TODO / 未検証の表示
- 最終テスト日時
- 最終テスト結果
- 通話件数
- 失敗件数
- 平均応答時間
- 平均会話時間
- エスカレーション率

## 9. 実装時の禁止事項

- 電話AIプロバイダ内に予約確定ロジックを閉じ込めない
- Vapi/Retell等に顧客DBや予約DBの主導権を渡さない
- Providerを変えると予約フローが壊れる設計にしない
- 実通話確認していないProviderを「本番確認済み」と表示しない
- MVPで全Providerを完全実装しようとしない

この内容をARARE AIのPRDと設計に追加反映してください。
