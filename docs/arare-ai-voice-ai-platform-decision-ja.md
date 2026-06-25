# ARARE AI 電話AI基盤の選定判断

作成日: 2026-06-12

## 1. 結論

ARARE AIのMVPでは、Twilioを電話基盤の第一候補にする。

ただし、Twilioだけにロックインする設計にはしない。

最善の構成は以下。

```text
電話番号/転送/着信/通話制御: Twilio
音声AI実行: Provider差し替え可能
MVP標準: Twilio Conversation Relay
高品質検証: OpenAI Realtime SIP または Twilio Media Streams + OpenAI Realtime
高速プロトタイプ検証: Vapi / Retell AI
バックアップ候補: Telnyx / Plivo
```

つまり、ARARE AIでは「電話会社をTwilioにする」のではなく、`VoiceProviderAdapter` を設計し、以下を差し替えられるようにする。

- Twilio Conversation Relay
- Twilio Media Streams + OpenAI Realtime
- OpenAI Realtime SIP
- Vapi
- Retell AI
- Telnyx
- Plivo

MVPで最初に作るのはTwilio。

本番品質を上げる段階で、OpenAI Realtime / Vapi / Retell / Telnyx / Plivoと比較テストする。

---

## 2. なぜTwilioをMVP第一候補にするか

ARARE AIの要件:

- 100店舗導入
- 既存店舗番号を変えない
- 店舗ごとにAI受付番号を持つ
- 転送導入したい
- CallLog、録音、通話ステータス、Webhookを管理したい
- 将来的にポートインやBYOC/SIPも検討したい
- LINE/SMS/通知/管理画面と統合したい
- AIが勝手に予約確定しない安全設計にしたい

この条件では、Twilioが最も堅い。

理由:

- 日本向けProgrammable Voice料金と番号種別が明示されている
- National番号、0ABJ番号、Toll-free番号の選択肢がある
- Conversation RelayでSTT/TTS/音声合成の重い部分をTwilio側に寄せられる
- Media StreamsでOpenAI Realtimeなどに接続できる
- SIP/BYOC構成に拡張できる
- 100店舗分の番号管理、Webhook、CallLog設計を作りやすい
- Gensparkで作る管理画面とAPIに組み込みやすい

Twilio公式料金上、日本のNational番号は月$4.75、Local 0ABJ番号は月$20、Toll-free番号は月$25。Local/national着信は$0.0100/分。Conversation Relayは$0.07/分。

---

## 3. Twilioの中でもどの方式がよいか

### 3.1 Twilio Conversation Relay

MVP第一候補。

特徴:

- TwilioがSTT、TTS、音声合成まわりを処理する
- アプリ側はWebSocketでテキストを受け取り、テキストを返す形に寄せられる
- 実装が比較的わかりやすい
- CallLog、Webhook、店舗ルーティングと相性がよい
- ElevenLabsなどの高品質TTSも選択肢になる

向いている用途:

- まず本番に近い電話AIを動かす
- 予約受付、復唱、仮予約作成、店舗承認通知を作る
- 100店舗に広げる土台を作る

弱点:

- 音声AIの自由度は、Raw audio方式より低い
- 最高品質の「人間っぽさ」を詰めるなら、OpenAI Realtimeや専用Voice AI基盤と比較が必要

### 3.2 Twilio Media Streams + OpenAI Realtime

高品質検証候補。

特徴:

- Twilioで電話を受ける
- Media Streamsで音声をWebSocketへ流す
- OpenAI Realtimeに接続して低遅延音声AIを作る

向いている用途:

- 「イケボ」「自然な割り込み」「低遅延」を本気で詰める
- 音声体験を差別化したい

弱点:

- 実装難度が上がる
- 音声ストリーム、状態管理、再接続、エラー処理を自前で持つ必要がある
- MVP初期には重い

### 3.3 OpenAI Realtime SIP

高品質検証候補。

OpenAI Realtime APIはSIPで着信を受けられる。公式ドキュメントでは、TwilioなどのSIP trunking providerを使い、SIPトラフィックをOpenAI SIP endpointへ向ける構成が説明されている。

向いている用途:

- OpenAI音声モデルを電話に直接つなぐ検証
- 音声AIの品質、遅延、割り込みを評価する

弱点:

- 電話番号、転送、店舗ごとの番号管理、SIP trunkの管理は別途必要
- 通話制御、店舗ルーティング、ログ統合はARARE側で設計が必要
- 100店舗運用では、Twilioなどの電話基盤と組み合わせる前提になる

---

## 4. 他の電話AIサービスはどう見るか

### 4.1 Vapi

強み:

- Voice AI Agentの構築が速い
- SIP trunking対応
- Twilio、Telnyx、Plivoなどとの連携ドキュメントがある
- 音声AIプロバイダ、TTS、LLM、ツール連携をまとめて扱いやすい

ARARE AIでの位置づけ:

- 高速プロトタイプ
- 音声品質の比較テスト
- 「この会話体験が理想」というベンチマーク作り

懸念:

- 100店舗分の電話番号、店舗ごとの運用、予約DB、安全な承認フローはARARE側で持つべき
- 中核業務ロジックをVapiに寄せすぎると、後で移行しにくくなる

### 4.2 Retell AI

強み:

- Voice Agent特化
- Twilio連携、SIP trunking、カスタム電話基盤との接続がある
- モニタリングや分析系が強い

ARARE AIでの位置づけ:

- Vapiと同じく音声品質比較
- 早いデモ
- 特定店舗でのA/Bテスト

懸念:

- 予約安全性、店舗ごとのマルチテナント、承認SLA、LineShiftParseJobなどはARARE側で持つべき
- 電話AIプラットフォームに業務DBを依存させすぎない

### 4.3 Telnyx

強み:

- 電話基盤として強い
- Media Streaming over WebSocketsに対応
- 低遅延・グローバル通信基盤をうたっている
- 日本番号も提供ページがある

ARARE AIでの位置づけ:

- Twilioの代替電話基盤候補
- 価格や品質の比較対象
- 将来的な冗長化候補

懸念:

- 日本での番号種別、規制、ポートイン、サポート運用は実アカウントで確認が必要
- Twilioほど日本導入資料を先に固めていない

### 4.4 Plivo

強み:

- Voice APIとAudio StreamingでVoice Agentを作れる
- SIP/音声ストリーミングの選択肢がある
- 番号・通話料が安い可能性がある

ARARE AIでの位置づけ:

- コスト比較候補
- バックアップ候補

懸念:

- 日本での実番号取得、転送、運用サポートは事前検証が必要
- ARAREの最初の本番基盤としてはTwilioより検証項目が多い

---

## 5. Gensparkとの関係

Gensparkは、電話基盤そのものではない。

Gensparkに作らせるべきもの:

- 管理画面
- スマホ運用画面
- 店舗オンボーディング
- 予約DB
- ReservationHold
- 承認SLA
- CallLog
- PhoneRoutingSetting
- VoiceProviderAdapter
- Twilio用Webhook
- Voice AIモック画面
- Provider比較用の設定画面

Gensparkに丸投げしないもの:

- 本番の電話番号購入判断
- 実Twilio通話確認
- 実OpenAI Realtime SIP接続確認
- 実Vapi/Retell品質比較
- 本番の番号ポートイン判断

---

## 6. 推奨アーキテクチャ

### 6.1 Provider抽象化

以下のインターフェースを設計する。

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

`VoiceProviderAdapter` の責務:

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

### 6.2 店舗ごとの設定

`AiSetting` または `VoiceAiSetting` に以下を持たせる。

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

### 6.3 MVPの順番

1. Mock Voice Provider
2. Twilio電話番号/転送/CallLog
3. Twilio Conversation Relay
4. VoiceProviderAdapter
5. 電話AIモック画面
6. Twilio本番テスト
7. OpenAI Realtime SIP or Media Streams検証
8. Vapi/Retell比較テスト
9. Telnyx/Plivoコスト比較

---

## 7. 最終判断

最初から「Twilioだけが正解」と決めるのは少し硬い。

ただし、100店舗、既存番号維持、日本番号、転送導入、予約安全性、管理画面統合まで考えると、MVPの電話基盤はTwilioが一番現実的。

最善はこれ。

```text
MVP電話基盤: Twilio
MVP音声方式: Conversation Relay
品質検証: OpenAI Realtime SIP / Media Streams
高速デモ比較: Vapi / Retell AI
代替電話基盤: Telnyx / Plivo
設計方針: VoiceProviderAdapterで差し替え可能にする
```

ARARE AIのコア価値は、電話AIサービスそのものではなく、店舗ごとのナレッジ、予約安全性、仮予約承認、100店舗運用、現場UIにある。

したがって、電話AIプロバイダに業務ロジックを持たせすぎない。

電話AI基盤は差し替えられるようにし、予約DB、顧客DB、店舗設定、承認SLA、監査ログはARARE AI側に持つ。

---

## 8. 参照

- Twilio Conversation Relay: https://www.twilio.com/docs/voice/conversationrelay
- Twilio Japan Voice Pricing: https://www.twilio.com/en-us/voice/pricing/jp
- Twilio Conversational AI Pricing: https://www.twilio.com/en-us/products/conversational-ai/pricing
- OpenAI Realtime API with SIP: https://developers.openai.com/api/docs/guides/realtime-sip
- OpenAI Voice Agents: https://developers.openai.com/api/docs/guides/voice-agents
- Vapi SIP Trunking: https://docs.vapi.ai/advanced/sip/sip-trunk
- Retell Custom Telephony: https://docs.retellai.com/deploy/custom-telephony
- Retell Twilio Integration: https://docs.retellai.com/deploy/twilio
- Telnyx Media Streaming: https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming
- Plivo Audio Streaming: https://www.plivo.com/docs/voice-agents/audio-streaming/overview
