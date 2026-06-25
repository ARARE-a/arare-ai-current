# Manus 用: ARARE AI P1a 開発指示

添付ZIPを引き継いで、ARARE AI の P1a を実装してください。

## 前提

- 現在の状態は P0b 完了版です。
- 全CRUD API/UI、shadcn/ui、Mock認証、ReservationHold承認フロー、HTTP E2E、Next build は実装済みです。
- 本番 Clerk / Twilio / LINE / OpenAI / Supabase キーは使わないでください。
- 外部API本番接続は今回禁止です。
- 仕様外の大きな機能追加は禁止です。
- クレジットが少なくなったら、`docs/CREDIT_SAFE_HANDOFF.md` に従って即引き継ぎZIPを作ってください。

## 最重要制約

- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- 100店舗マルチテナント前提で、全DB/API/UIで `storeId` 分離を維持。
- `.env` や本番キーは納品ZIPに含めない。
- P1aでは Mock / Adapter 境界を維持し、外部API実接続に進まない。

## 今回やること P1a

### 1. 予約カレンダービュー

`/admin/calendar` を新規作成してください。

必須:

- 日ビュー
- 週ビュー
- セラピスト別フィルタ
- 部屋別フィルタ
- `CONFIRMED` 予約と `PENDING_APPROVAL` 仮予約を見分けられる表示
- クリックで予約/仮予約の詳細を確認できる簡易パネル
- 実API接続。API未起動時のみ mock fallback 可

### 2. Platform管理画面 CRUD

`/admin/platform` を P1a レベルまで拡張してください。

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
- `PhoneRoutingSetting` など既存モデルを使い、MockデータまたはSeedデータで表示。

### 3. AI受付ログ詳細・エスカレーション管理 UI

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
- 現在の `ai/mock-message` と既存モデルを前提にしてください。

### 4. E2E CRUD テスト拡充

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

### 5. ドキュメント更新

以下を更新してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CREDIT_SAFE_HANDOFF.md` に変更が必要なら更新

## 必須検証

最低限:

```bash
pnpm install
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

可能ならNext.jsを起動し、以下のHTTP 200を確認:

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

## 納品

- `node_modules`
- `.next`
- `.env`
- `*.log`
- `*.tsbuildinfo`

を除外してZIP化し、ダウンロードURLを提示してください。

## 完了報告形式

以下だけで短く報告してください。

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

