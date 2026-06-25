# Manus 新アカウント用: ARARE AI P1b補修 + P1c通知基盤プロンプト

添付ZIPを展開し、ARARE AI の開発を引き継いでください。

このManusアカウントには過去の会話履歴がない前提です。過去チャットには依存せず、添付ZIP内のコードとドキュメントを唯一の正として作業してください。

## 0. 添付ZIPについて

添付ZIPは Codex で検収・クリーン化した P1b 引き継ぎ版です。

Codex確認済み:

- `pnpm install`
- `pnpm exec prisma generate --schema=prisma/schema.prisma`
- `pnpm exec prisma validate --schema=prisma/schema.prisma`
- `pnpm -r typecheck`
- `pnpm -r build`
- `CLERK_MOCK_MODE=true` / dummy key時の主要16ページ HTTP 200
- `node_modules` / `.next` / `dist` / `.env` はZIPから除外済み

ただし、P1bはまだ完全ではありません。P1c通知基盤に進む前に、必ず P1b補修を完了してください。

## 1. まず読むファイル

作業前に必ず以下を確認してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CREDIT_SAFE_HANDOFF.md`
- `apps/api/src/middleware/authClerk.ts`
- `apps/api/src/middleware/authz.ts`
- `apps/api/src/middleware/storeScope.ts`
- `apps/api/test/e2e.auth.ts`
- `apps/web/app/layout.tsx`
- `apps/web/middleware.ts`
- `apps/web/lib/auth.ts`
- `apps/web/lib/auth-clerk.ts`

## 2. プロジェクト概要

ARARE AI は、メンズエステ店舗向けの AI受付・予約自動化SaaSです。

将来的に100店舗運用を想定しています。

主要機能:

- 電話AI / LINE / Webチャットによる一次受付
- 店舗ナレッジに基づく回答
- 仮予約作成
- 店舗スタッフ承認による予約確定
- 顧客、セラピスト、シフト、コース、部屋、ナレッジ管理
- 予約カレンダー
- Platform管理
- AI受付ログ・エスカレーション管理
- マルチテナント `storeId` 分離

## 3. 絶対に守る制約

- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- 100店舗マルチテナント前提で、全DB/API/UIで `storeId` 分離を維持。
- 本番キーをコード・docs・ログ・ZIPに含めない。
- `.env` は納品ZIPに含めない。
- OpenAI本番接続、電話AI本番接続は今回禁止。
- Twilio / LINE はP1cでAdapter境界を作るが、本番送信キーは使わない。
- クレジットが少なくなったら、`docs/CREDIT_SAFE_HANDOFF.md` に従って即引き継ぎZIPを作る。

## 4. 最初にやる検証

まず以下を実行してください。

```bash
pnpm install
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm exec prisma validate --schema=prisma/schema.prisma
pnpm -r typecheck
pnpm -r build
```

可能ならNext.jsを起動し、`CLERK_MOCK_MODE=true` / dummy keyで主要ページHTTP 200を確認してください。

## 5. 今回の作業順序

今回の作業は2段階です。

1. **P1b補修: Clerk/RBACを本当に使える形へ修正**
2. **P1c: 通知基盤をMock/Adapter境界で実装**

P1b補修が終わる前にP1cへ進まないでください。

---

# Phase 1: P1b補修

## 5.1 role名を統一

現在、API側に `admin/staff/store_owner`、Web側に `platform_admin/store_owner/store_staff` が混在しています。

以下に統一してください。

- `platform_admin`
- `store_owner`
- `store_staff`

対象:

- `apps/api/src/middleware/authClerk.ts`
- `apps/api/src/middleware/authz.ts`
- `apps/api/src/middleware/storeScope.ts`
- `apps/api/src/middleware/authMock.ts`
- `apps/web/lib/auth.ts`
- `apps/web/lib/auth-clerk.ts`
- `apps/web/app/admin/layout.tsx`
- `apps/api/test/e2e.auth.ts`

## 5.2 Clerk実JWT検証

`apps/api/src/middleware/authClerk.ts` を修正してください。

必須:

- `@clerk/backend` を使って `Authorization: Bearer <token>` を検証
- Clerk未設定、dummy key、`CLERK_MOCK_MODE=true` の場合はmock fallback
- Clerk有効時はclaims/metadataから以下を取得
  - `userId`
  - `storeId`
  - `role`
- `storeId` または `role` が無い場合は 403
- JWT検証失敗は 401

注意:

- 本番キーは使わない。
- `.env.example` はdummy値だけ。
- 実キー前提のテストは書かない。

## 5.3 storeScope / RBAC

API側で以下を保証してください。

- `platform_admin` は全店舗アクセス可
- `store_owner` は自店舗のみアクセス可
- `store_staff` は自店舗のみアクセス可
- URLの `:storeId` と認証storeIdが違う場合、`store_owner/store_staff` は403
- UIで隠すだけでなくAPIでも拒否

権限:

- `platform_admin`
  - 全店舗読み書き
  - platform管理可
- `store_owner`
  - 自店舗の全CRUD可
  - 設定・ナレッジ・コース・部屋・スタッフ管理可
  - platform全体管理不可
- `store_staff`
  - 予約/仮予約/顧客/シフトの読み書き可
  - コース/部屋/ナレッジは読み取り中心
  - 削除系、platform管理不可

## 5.4 認証E2E修正

`apps/api/test/e2e.auth.ts` を実効性のあるテストにしてください。

Mock modeでヘッダー指定できるようにして構いません。

最低限:

- `store_staff` が自店舗の予約一覧を取得できる
- `store_staff` が他店舗storeIdへアクセスすると403
- `store_staff` が削除系操作をすると403
- `store_owner` が自店舗CRUDできる
- `platform_admin` が複数店舗へアクセスできる
- Clerk未設定/dummy時はmock fallbackで既存E2Eが壊れない

---

# Phase 2: P1c通知基盤

P1b補修が通った後に実装してください。

## 6.1 Notification Provider Adapter

以下のAdapter境界を作成してください。

推奨ファイル:

- `apps/api/src/notifications/types.ts`
- `apps/api/src/notifications/mockNotificationAdapter.ts`
- `apps/api/src/notifications/twilioSmsAdapter.ts`
- `apps/api/src/notifications/lineMessagingAdapter.ts`
- `apps/api/src/notifications/notificationDispatcher.ts`

必須:

- 本番キー未設定/dummy時は必ずmock送信
- Twilio/LINE本番送信は、差し替え点まで実装
- 実送信は環境変数が正しく設定されている場合のみ
- 送信内容・宛先・結果を `NotificationLog` に残す
- dedupeKeyで重複送信を防ぐ

## 6.2 通知イベント

最低限、以下の通知イベントを実装してください。

- `reservation_hold.created`
- `reservation.confirmed`
- `reservation.rejected`
- `reservation.cancelled`
- `escalation.created`

予約承認時:

- スタッフ承認後に `Reservation(CONFIRMED)` を作成
- 顧客向け通知をenqueue/mock送信
- 店舗向け通知をenqueue/mock送信
- `NotificationLog` に結果を保存

AIが直接予約確定する実装は禁止です。

## 6.3 リトライ・失敗管理

最低限:

- `QUEUED`
- `SENT`
- `FAILED`
- `RETRYING`

を扱ってください。

実装:

- 送信失敗時に `FAILED`
- retry対象を取得するAPI
- mock retry API
- AIログまたは通知管理UIで失敗が見える

## 6.4 UI

既存UIを壊さず、以下を追加してください。

- `/admin/ai-logs` に通知失敗・retry状態を表示
- 可能なら `/admin/notifications` を追加
  - 通知一覧
  - channel
  - status
  - dedupeKey
  - retry回数
  - 最終エラー

## 6.5 E2E

`apps/api/test/e2e.notification.ts` を追加してください。

最低限:

- reservation.confirmed 時に通知ログが作成される
- dummy/mock環境では実送信されずmock送信になる
- dedupeKey重複時に二重送信されない
- 失敗時に `FAILED` になる
- retry APIで `RETRYING` または `SENT` に遷移する
- storeId分離が維持される

---

## 7. 必須検証

最低限:

```bash
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm exec prisma validate --schema=prisma/schema.prisma
pnpm -r typecheck
pnpm -r build
```

PostgreSQL が使える場合:

```bash
pnpm exec prisma migrate dev --schema=prisma/schema.prisma
pnpm exec tsx prisma/seed/seed.ts
pnpm exec tsx apps/api/test/e2e.reservationHold.ts
pnpm exec tsx apps/api/test/e2e.http.ts
pnpm exec tsx apps/api/test/e2e.crud.ts
pnpm exec tsx apps/api/test/e2e.auth.ts
pnpm exec tsx apps/api/test/e2e.notification.ts
```

可能ならNext.jsを起動し主要ページHTTP 200を確認してください。

## 8. ドキュメント更新

以下を必ず更新してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- 必要なら `docs/CREDIT_SAFE_HANDOFF.md`

## 9. 納品ZIPルール

ZIPから必ず除外:

- `node_modules/`
- `.next/`
- `dist/`
- `.env`
- `*.log`
- `*.tsbuildinfo`
- 一時ファイル

## 10. 完了報告形式

以下だけで短く報告してください。

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

