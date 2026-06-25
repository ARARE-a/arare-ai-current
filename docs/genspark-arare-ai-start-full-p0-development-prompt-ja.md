# Genspark投入用: ARARE AI P0本格開発開始

ここからは、ARARE AIのP0本格開発に入ってください。

前提として、P0a修正版ZIP `arare-ai-p0-skeleton-v2-p0a.zip` を土台にしてください。

設計壁打ち、長文説明、追加資料作成は不要です。  
実装を進め、各スプリント完了時に短く報告してください。

## 1. 最重要制約

- PRD完全版に記載されたP0範囲のみ実装する
- 仕様外機能は追加しない
- 本番のSupabase / Twilio / LINE / Clerk / OpenAIキーは使わない
- 外部連携はmock / stub / webhook skeletonまで
- Reddit / SNS / 広告 / 自動投稿 / 外部コミュニティ連携は使わない
- AIは独断で予約確定しない
- `ReservationHold -> スタッフ承認 -> Reservation(CONFIRMED)` を必ず守る
- 全店舗スコープデータに `storeId` を持たせる
- 1つのAI受付番号を複数店舗で共有しない設計を維持する
- `VoiceProviderAdapter` は維持し、電話AI基盤をTwilio固定にしない

## 2. 本格開発の進め方

以下の順番で進めてください。

### Sprint 1: P0bデータモデル補完

まずDBの穴を塞いでください。

追加・修正するモデル:

- `Message` に冗長 `storeId` を追加
- `StoreGroup`
- `CourseOption`
- `NgRuleMatch`
- `ReservationChangeHistory`
- `AiSetting`
- `BlacklistEntry`
- `Role`
- `Permission`
- `RolePermission`
- `SalesRecord`
- `Notification`

必須:

- 店舗スコープモデルには必ず `storeId`
- `@@index([storeId])` を基本付与
- 顧客電話番号は `@@unique([storeId, phoneNumber])`
- 通知重複は `@@unique([storeId, dedupeKey])`
- `npx prisma validate` を通す
- `pnpm -r typecheck` を通す

### Sprint 2: DB接続前提のP0 API実装

stubだけでなく、Prismaを使う前提のAPI層に進めてください。

実装するAPI:

- `GET /health`
- `GET /stores/:storeId/dashboard`
- `GET /stores/:storeId/onboarding-status`
- `POST /stores/:storeId/onboarding-status/check`
- `GET /stores/:storeId/customers`
- `POST /stores/:storeId/customers`
- `GET /stores/:storeId/therapists`
- `POST /stores/:storeId/therapists`
- `GET /stores/:storeId/shifts`
- `POST /stores/:storeId/shifts`
- `GET /stores/:storeId/rooms`
- `POST /stores/:storeId/rooms`
- `GET /stores/:storeId/courses`
- `POST /stores/:storeId/courses`
- `GET /stores/:storeId/reservations`
- `POST /stores/:storeId/reservations`
- `POST /stores/:storeId/reservation-holds`
- `POST /stores/:storeId/reservation-holds/:id/approve`
- `POST /stores/:storeId/reservation-holds/:id/reject`
- `GET /stores/:storeId/knowledge`
- `POST /stores/:storeId/knowledge`
- `GET /stores/:storeId/ng-rules`
- `POST /stores/:storeId/ng-rules`
- `POST /stores/:storeId/ai/mock-message`
- `POST /webhooks/voice/mock`
- `POST /webhooks/line/mock`
- `POST /webhooks/sms/status/mock`
- `POST /stores/:storeId/line-shift-parse-jobs`
- `POST /stores/:storeId/line-shift-parse-jobs/:id/approve`

必須ロジック:

- `storeId` なしの店舗データアクセスを拒否
- ダブルブッキング防止
- シフト外予約防止
- 部屋不足防止
- `BlockedSlot` 尊重
- NGルール一致時のエスカレーション
- 未登録ナレッジは「確認が必要です。店舗に確認して折り返します。」
- AIは `Reservation(CONFIRMED)` を直接作らない
- 承認APIのみが `CONFIRMED` を作れる
- 承認時に最新の空き状況を再確認する
- `AuditLog` を残す
- `NotificationLog` のdedupeを使う

### Sprint 3: PC管理画面P0実装

PC画面を、実データまたはseed/mock APIを使って動く状態にしてください。

実装する画面:

- ダッシュボード
- 店舗オンボーディング
- 初回設定チェックリスト
- 仮予約承認キュー
- 予約一覧
- 予約作成/編集
- 顧客管理
- セラピスト管理
- シフト管理
- 部屋管理
- コース/料金管理
- ナレッジ管理
- FAQ管理
- NG回答管理
- AI受付ログ
- 通知履歴
- Platform Admin 100店舗監視

必須:

- 仮予約が承認待ちとして見える
- 承認すると `CONFIRMED` になる
- 通知失敗が見える
- 未対応Escalationが見える
- 店舗別の導入状態が見える
- 100店舗監視ページで店舗別ステータスを一覧できる

### Sprint 4: スマホ運用画面P0実装

390x844基準で、現場用画面を実装してください。

実装する画面:

- ホーム
- 今すぐ対応
- 仮予約承認
- 会話詳細
- 本日の予約
- 通知失敗

必須:

- スマホで未対応キューが見える
- 仮予約の詳細を確認できる
- 承認/却下できる
- AI会話ログを確認できる
- 長い表を詰め込まない
- 入力欄が下部ナビに隠れない

### Sprint 5: モック受付とWebhook疎通

本番外部APIは使わず、mockで主要ユースケースを再現してください。

実装すること:

- 電話AIモック受付
- LINE受付モック
- Webチャット受付モック
- SMS status callbackモック
- VoiceProviderAdapter mock
- Twilio Conversation Relay用のstub
- OpenAI mock responder
- LINEシフト解析mock

必須:

- mock会話からReservationHoldを作れる
- 低信頼度/NG/不明点はEscalationになる
- LINEシフト解析は即時反映せず `LineShiftParseJob` 承認制
- 未検証の外部連携は未検証と表示する

## 3. 検証

各Sprint完了時に必ず実行してください。

- `pnpm -r typecheck`
- `npx prisma validate --schema=prisma/schema.prisma`

可能なら以下も実行してください。

- `pnpm -r build`
- seed実行
- 主要APIのmock疎通

## 4. 報告形式

長文説明は禁止です。

各Sprint後は以下だけ報告してください。

```text
実装済み:
- ...

確認済み:
- pnpm -r typecheck: pass / fail
- npx prisma validate: pass / fail
- その他: ...

修正ファイル:
- ...

未実装:
- ...

未検証:
- ...

納品:
- ダウンロードURL: ...

次にやること:
- ...
```

## 5. 今すぐやること

まず Sprint 1 を実行してください。

完了したら、typecheckとprisma validateを通し、ZIP化してダウンロードURLを提示してください。

P0b完了後、確認待ちせずSprint 2に進むかどうかだけ短く聞いてください。
