# ARARE AI 100店舗前提 電話AI設計

## 目的

ARARE AIをまず100店舗まで営業・導入できる前提で、電話AI受付を安全に運用する。店舗の既存電話番号は変更させず、既存番号からAI受付番号へ転送する方式を基本とする。

## 基本方針

- 店舗の既存番号は変えない。
- 店舗ごとにAI受付用Twilio番号を1つ割り当てる。
- 店舗は既存番号からAI受付用Twilio番号へ転送する。
- ARARE AIはTwilioの `To` 番号から店舗を判定する。
- 店舗ごとの予約、顧客、セラピスト、部屋、通話ログは必ず `storeId` で分離する。
- MVPではTwilio親アカウント1つで開始し、subaccountは必須にしない。
- 100店舗を超えて請求分離、停止管理、監査、番号在庫管理が重くなった段階でTwilio subaccount化を検討する。

## 通話フロー

```text
顧客
↓
店舗の既存電話番号
↓
店舗側の電話転送
↓
店舗専用のTwilio番号
↓
/api/twilio/voice
↓
To番号からStorePhoneSettingを検索
↓
対象storeIdを決定
↓
ConversationRelay
↓
Voice Relay WebSocket
↓
OpenAI Realtime
↓
ARARE AI予約API
↓
仮予約/通話ログ/エスカレーション保存
```

## 100店舗時点のTwilio構成

### 採用する構成

```text
Twilio親アカウント
├ 店舗001 Twilio番号
├ 店舗002 Twilio番号
├ 店舗003 Twilio番号
...
└ 店舗100 Twilio番号
```

### まだ採用しない構成

```text
Twilio親アカウント
├ 店舗001 subaccount
├ 店舗002 subaccount
...
└ 店舗100 subaccount
```

100店舗ではsubaccount必須ではない。番号、利用量、停止処理、請求管理が複雑になった段階で移行する。

## DBモデル追加案

### StorePhoneSetting

店舗ごとの電話AI設定。

```text
id
storeId
currentStorePhoneNumber
aiReceptionPhoneNumber
twilioPhoneNumberSid
twilioAccountSid
twilioSubaccountSid
voiceWebhookUrl
voiceRelayWsUrl
fallbackPhoneNumber
voiceAiEnabled
routingMode
recordingEnabled
businessHoursOnly
createdAt
updatedAt
```

`routingMode`:

```text
ALWAYS_AI
AFTER_HOURS_AI
BUSY_OR_NO_ANSWER_AI
MANUAL_ONLY
```

### StorePhoneEvent

電話番号設定の変更履歴。

```text
id
storeId
storePhoneSettingId
eventType
before
after
createdAt
```

### StoreUsageMeter

店舗ごとの通話利用量。

```text
id
storeId
period
voiceCallCount
voiceCallSeconds
aiSessionCount
estimatedCost
createdAt
updatedAt
```

## 着信時の店舗判定

Twilioの着信Webhookには `To` と `From` が含まれる。

```text
To   = AI受付用Twilio番号
From = 顧客の電話番号
```

ARARE AIは `To` を正規化して、`StorePhoneSetting.aiReceptionPhoneNumber` と照合する。

見つかった場合:

```text
storeId確定
↓
対象店舗のAI設定・予約ルールを読み込む
↓
通話ログを対象店舗に保存
```

見つからない場合:

```text
通話は受ける
↓
「設定確認が必要です」と案内
↓
system escalationsへ保存
↓
予約作成しない
```

## 管理画面

店舗設定に「電話AI設定」を追加する。

表示項目:

- 現在の店舗番号
- AI受付用番号
- 転送設定ステータス
- 電話AI ON/OFF
- 転送モード
- スタッフ転送先番号
- ConversationRelay接続状態
- OpenAI接続状態
- Twilio webhook設定状態
- テスト発信/テスト着信結果
- 当月通話数
- 当月通話時間
- 通話ログ一覧

## 100店舗でのインフラ方針

### Vercel

担当:

- 管理画面
- 通常HTTP API
- Twilio着信Webhook
- LINE webhook
- Webチャット

注意:

- 長時間WebSocketは担当させない。
- ConversationRelayのWebSocketは別ホストへ逃がす。

### Voice Relay

担当:

- Twilio ConversationRelay WebSocket
- OpenAI Realtime接続
- 通話セッション状態
- AI応答
- 通話ログ更新

推奨:

- Railway
- Render
- Fly.io
- Cloud Run

100店舗MVPでは、まず1つのRelayサービスで開始する。負荷が増えたら水平スケールする。

### Supabase/PostgreSQL

方針:

- 全テーブルで `storeId` indexを必須にする。
- APIでは必ずstoreスコープを適用する。
- 管理画面はログインユーザーのstoreIdだけ取得する。
- 電話着信は `To` 番号からstoreIdを解決する。

## Twilioスケール方針

100店舗では、まず親アカウント1つに店舗ごとのTwilio番号を持たせる。

理由:

- 運用が簡単
- 番号管理がしやすい
- 100店舗規模ならsubaccountなしでも開始しやすい
- 後からsubaccount化できる

1000店舗を見据える場合:

- Twilio Business Primary Customer Profileを承認済みにする
- Twilio Support/Salesへ同時通話、番号在庫、subaccount上限を事前相談する
- 店舗ごとのsubaccount分離を検討する
- subaccount上限はデフォルト1000なので、1000店舗超は上限引き上げ相談が必要

## OpenAIスケール方針

100店舗で同時通話が増えるとOpenAI Realtimeのレート制限が先に問題になりやすい。

対策:

- OpenAI usage tierを上げる
- 必要ならOpenAIへ上限申請する
- 通話が混雑したらスタッフ折り返しへフォールバックする
- 予約確定前のDB確認は短いAPI呼び出しに分離する
- 通話ごとの最大時間を店舗設定で制限する

## 実装順序

1. `StorePhoneSetting` モデル追加
2. `StorePhoneEvent` モデル追加
3. `StoreUsageMeter` モデル追加
4. `To` 番号からstoreIdを解決するサービス追加
5. `/api/twilio/voice` を `DEMO_STORE_ID` 固定から脱却
6. `/api/twilio/voice/gather` と `/connect-status` もstore解決対応
7. Voice Relayに `to` / `storeId` を渡す
8. 管理画面に電話AI設定を追加
9. 管理APIをstoreスコープ対応
10. 検証スクリプトにマルチ店舗電話ルーティングテストを追加

## 成功条件

実装は、以下を満たすまで成功扱いにしない。

- TypeScriptチェックが通る
- Next.js buildが通る
- Prisma migrationが生成/適用できる
- 既存の管理画面APIが壊れていない
- Twilio着信Webhookが正常なTwiMLを返す
- `To` 番号ごとに別storeIdへルーティングできる
- 不明な `To` 番号では予約作成しない
- 通話ログが正しいstoreIdに保存される
- 本番またはローカルの検証APIで成功を確認する

## 失敗扱いにする条件

- `DEMO_STORE_ID` 固定が本番電話経路に残っている
- 店舗Aの電話で店舗Bの予約データを参照できる
- Twilio番号未登録でも予約が作成される
- ビルドまたは型チェックが失敗している
- 通話ログがstoreIdなし、または誤storeIdで保存される
- 既存の予約、顧客、セラピスト、コースAPIが壊れる
