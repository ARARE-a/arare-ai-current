# Genspark追加投入用プロンプト: 省クレジット実装モード

ここからは設計壁打ちではなく、開発着手を優先してください。

クレジット消費を抑えるため、長い説明、追加の設計ドキュメント、仕様の再要約、不要な選択肢提示はしないでください。

既存のPRD、実行用プロンプト、実装前設計書、P0スケルトンを前提に、P0実装を小さなスプリントで進めてください。

## 1. 最重要方針

- 追加の壁打ちは不要
- 追加の長文設計書は不要
- 仕様外機能は追加しない
- 本番キーは使わない
- 外部連携はmock / stub / webhook skeletonまで
- 実装結果だけを簡潔に報告
- 1回の作業で広げすぎず、動く土台を厚くする
- 実装済み / 未実装 / 未検証だけ短く報告

## 2. まずやること

`arare-ai-p0-skeleton-v2` を土台にして、以下の順で実装してください。

### Sprint 1: プロジェクト整備と検証

1. `pnpm install` が通る状態にする
2. `pnpm -r typecheck` が通る状態にする
3. `npx prisma validate` が通る状態にする
4. package.json / tsconfig / workspace 設定の不足を直す
5. READMEに起動手順を書く

この段階では新機能を増やさず、まず土台が壊れていないことを優先してください。

### Sprint 2: Prisma schemaをP0実装可能レベルにする

最低限以下を整えてください。

- Store
- StoreGroup
- StoreOnboardingStatus
- User
- UserStoreRole
- Customer
- Therapist
- Shift
- Room
- Course
- CourseOption
- Reservation
- ReservationHold
- ReservationChangeHistory
- Conversation
- Message
- KnowledgeBase
- FAQ
- TalkScript
- NgRule
- NgRuleMatch
- Notification
- NotificationLog
- AuditLog
- Escalation
- AiSetting
- VoiceAiSetting
- PhoneRoutingSetting
- ExternalIntegrationStatus
- CallLog
- LineShiftParseJob
- BackgroundJob
- SystemHealthEvent

必須:

- 店舗スコープデータには必ず `storeId`
- `aiIngressPhoneNumber` は店舗判定用にユニーク
- `NotificationLog` は `storeId + dedupeKey` で重複防止
- `ReservationHoldStatus` は `ACTIVE / PENDING_APPROVAL / APPROVED / REJECTED / EXPIRED / CANCELLED`
- `ReservationStatus` は `TENTATIVE / CONFIRMED / VISITED / CANCELLED / NO_SHOW`

### Sprint 3: P0 APIスケルトン

以下のAPIを、DB接続または明確なstubで実装してください。

- `GET /health`
- `GET /stores/:storeId/dashboard`
- `POST /stores/:storeId/reservation-holds`
- `POST /stores/:storeId/reservation-holds/:id/approve`
- `POST /stores/:storeId/reservation-holds/:id/reject`
- `POST /stores/:storeId/reservations`
- `GET /stores/:storeId/reservations`
- `POST /stores/:storeId/ai/mock-message`
- `POST /webhooks/voice/mock`
- `POST /webhooks/line/mock`
- `POST /webhooks/sms/status/mock`
- `POST /stores/:storeId/line-shift-parse-jobs`
- `POST /stores/:storeId/line-shift-parse-jobs/:id/approve`

必須:

- 保護APIは `storeId` 必須
- AIは独断で予約確定しない
- 承認API以外で `CONFIRMED` を作らない
- 未登録ナレッジは「確認が必要です。店舗に確認して折り返します。」

### Sprint 4: PC / スマホ UIの最小実装

見た目の完成度より、業務導線を優先してください。

PC:

- ダッシュボード
- 仮予約承認キュー
- 予約管理
- ナレッジ管理
- 電話/LINE/Webモック受付ログ
- Platform Adminの100店舗監視ページ

スマホ:

- ホーム
- 今すぐ対応
- 仮予約承認
- 会話詳細

必須:

- AIが作った仮予約をスタッフが承認する流れが画面で追える
- 未対応 / 仮予約 / 通知失敗が見える
- 「AIは独断で確定しない」ことがUI上でも分かる

## 3. 省クレジット報告ルール

各作業後の報告は以下だけでよいです。

```text
実装済み:
- ...

確認済み:
- ...

未実装:
- ...

未検証:
- ...

次にやること:
- ...
```

長い解説、PRD再要約、背景説明は不要です。

## 4. 禁止

- 新しい仕様提案
- 仕様外機能追加
- SNS / Reddit / 広告 / 自動投稿 / 外部コミュニティ連携
- 本番Supabase / Twilio / LINE / Clerk / OpenAIキー前提の実装
- 実接続していないのに「動作確認済み」と報告
- 予約確定をAIが直接行えるAPI
- `storeId` なしの店舗データAPI
- Providerに予約DBや顧客DBの主導権を渡す設計

## 5. 今すぐ開始する作業

まずは Sprint 1 を実行してください。

完了したら、以下だけ報告してください。

- install結果
- typecheck結果
- prisma validate結果
- 修正したファイル
- 次にSprint 2へ進めるか

長文説明は不要です。
