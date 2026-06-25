# Manus 新アカウント用: ARARE AI 引き継ぎ + P1a 開発プロンプト

添付ZIPを展開し、ARARE AI の開発を引き継いでください。

このManusアカウントには過去の会話履歴がない前提です。過去チャットには依存せず、添付ZIP内のコードとドキュメントを唯一の正として作業してください。

## 0. まず読むファイル

作業開始前に必ず以下を確認してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CREDIT_SAFE_HANDOFF.md`
- `prisma/schema.prisma`
- `apps/api/src/routes/index.ts`
- `apps/web/lib/api.ts`

## 1. プロジェクト概要

ARARE AI は、メンズエステ店舗向けの AI 受付・予約自動化 SaaS です。

対象は将来的に 100店舗規模です。

主な機能:

- 電話AI / LINE / Webチャットによる一次受付
- 店舗ナレッジに基づく回答
- 仮予約作成
- 店舗スタッフによる承認
- 予約確定通知
- セラピスト、シフト、部屋、コース、顧客、ナレッジ管理
- 100店舗マルチテナント運用

## 2. 絶対に守る制約

- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- すべての店舗データは `storeId` で分離する。
- 100店舗運用を前提にする。
- 本番の Supabase / Twilio / LINE / Clerk / OpenAI キーは使わない。
- `.env` は納品ZIPに含めない。
- 外部API本番接続は今回禁止。
- Twilio / LINE / OpenAI / Clerk は Mock / Adapter 境界を維持する。
- 仕様外の新機能を勝手に追加しない。
- P1aの範囲だけ実装する。

## 3. 現在の状態

添付ZIPは P0b 完了版です。

完了済みの想定:

- Prisma schema / migration / seed
- ReservationHold 承認フロー
- HTTP E2E
- 全CRUD API
- 全CRUD UI
- shadcn/ui 基本コンポーネント
- Mock認証 / Mock認可
- storeId 分離
- Next.js build 成功
- 低クレジット時の引き継ぎルール

ただし、必ずローカルで再検証してください。

## 4. 最初にやる検証

まず以下を実行してください。

```bash
pnpm install
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm exec prisma validate --schema=prisma/schema.prisma
pnpm -r typecheck
pnpm -r build
```

PostgreSQL が使える場合のみ、追加で以下を実行してください。

```bash
docker compose up -d
pnpm exec prisma migrate dev --schema=prisma/schema.prisma
pnpm exec tsx prisma/seed/seed.ts
pnpm exec tsx apps/api/test/e2e.reservationHold.ts
pnpm exec tsx apps/api/test/e2e.http.ts
```

検証に失敗した場合は、P1a実装より先に原因を修正してください。

## 5. 今回やること P1a

### 5.1 予約カレンダービュー

`/admin/calendar` を新規作成してください。

必須:

- 日ビュー
- 週ビュー
- セラピスト別フィルタ
- 部屋別フィルタ
- `CONFIRMED` 予約と `PENDING_APPROVAL` 仮予約を見分けられる表示
- クリックで予約/仮予約詳細を確認できる簡易パネル
- 実API接続
- API未起動時のみ mock fallback 可

### 5.2 Platform管理画面 CRUD

`/admin/platform` を拡張してください。

必須:

- 店舗一覧
- 店舗作成
- 店舗編集
- 導入状態表示
- 電話転送設定表示
- AI稼働状態表示
- 100店舗運用を想定した検索/絞り込み

注意:

- 本番電話API接続はしない。
- 既存の `PhoneRoutingSetting` などのモデルを使う。
- MockデータまたはSeedデータで表示してよい。

### 5.3 AI受付ログ詳細・エスカレーション管理UI

`/admin/ai-logs` を拡張してください。

必須:

- 会話ログ一覧
- 会話詳細
- ナレッジ外 fallback 表示
- NGルールヒット表示
- Escalation の未対応/対応済み管理
- 通知失敗の表示

注意:

- OpenAI本番接続はしない。
- 現在の `ai/mock-message` と既存モデルを前提にする。

### 5.4 E2E CRUD テスト拡充

API E2Eを追加してください。

必須:

- 顧客CRUD
- セラピストCRUD
- シフトCRUD
- コースCRUD
- 部屋CRUD
- ナレッジCRUD
- storeId分離テスト
- store_staff が他店舗データにアクセスできない想定の Mock認可テスト

テストは実PostgreSQLが使える場合に実行してください。
PostgreSQLが使えない環境では、テストファイル作成と型検証まででよいですが、未検証として明記してください。

## 6. UI方針

- shadcn/ui の既存コンポーネントを優先して使う。
- 管理画面は派手にせず、店舗スタッフが迷わず使える業務UIにする。
- 100店舗運用を想定し、一覧・検索・状態表示を重視する。
- カードを過剰に増やさず、表・フィルタ・ステータスバッジ中心にする。
- PC管理画面とスマホ運用画面の役割を分ける。

## 7. ドキュメント更新

作業後、以下を必ず更新してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- 必要に応じて `docs/CREDIT_SAFE_HANDOFF.md`

## 8. 必須検証

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
```

可能なら Next.js を起動し、以下のHTTP 200を確認:

- `/admin/dashboard`
- `/admin/holds`
- `/admin/reservations`
- `/admin/calendar`
- `/admin/knowledge`
- `/admin/ai-logs`
- `/admin/platform`
- `/admin/customers`
- `/admin/therapists`
- `/admin/shifts`
- `/admin/courses`
- `/admin/rooms`
- `/mobile/home`
- `/mobile/holds`
- `/mobile/urgent`
- `/mobile/conversation`

## 9. 低クレジット時の対応

クレジットが少なくなった、または継続が危うい場合は、新機能追加を即停止してください。

その場合は `docs/CREDIT_SAFE_HANDOFF.md` に従い、以下だけ実行してください。

1. 現在の変更を整理
2. 可能な範囲で検証
3. `docs/HANDOFF.md` / `docs/STATUS_REPORT.md` / `docs/TODO_NEXT.md` を更新
4. クリーンZIPを作成
5. ダウンロードURLを提示

## 10. 納品ZIPのルール

ZIPに含める:

- `apps/`
- `packages/`
- `prisma/`
- `docs/`
- `.env.example`
- `.npmrc`
- `docker-compose.yml`
- `package.json`
- `pnpm-workspace.yaml`
- `README.md`
- lockfile

ZIPから除外:

- `node_modules/`
- `.next/`
- `.env`
- `*.log`
- `*.tsbuildinfo`
- 一時ファイル

## 11. 完了報告形式

以下だけで短く報告してください。

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

