# Manus 新アカウント用: ARARE AI P4 フロント統合・本番運用準備プロンプト

添付ZIPを展開し、ARARE AI の開発を引き継いでください。

このManusアカウントには過去の会話履歴がない前提です。過去チャットには依存せず、添付ZIP内のコードとドキュメントを唯一の正として扱ってください。

## 0. 添付ZIPについて

添付ZIPは P3「本番接続準備・堅牢化」完了版です。

P3までで完了している想定:

- Twilio / LINE Webhook署名検証の実装
- 通知Adapterの本番切替準備
- 実DB E2Eの厳密化
- OpenAI responder / Twilio Voice / LINEシフト解析の安全制約
- LINEシフト解析の承認・却下フロー
- `/health` / `/ready` / 店舗別health
- AIが直接 `CONFIRMED` を作れない制約
- `ReservationHold -> staff approval -> Reservation(CONFIRMED)` の維持

ただし、作業開始後に必ず自分で検証してください。

## 1. まず読むファイル

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CREDIT_SAFE_HANDOFF.md`
- `docs/PRODUCTION_READINESS.md` があれば読む
- `docs/WEBHOOK_SECURITY.md` があれば読む
- `docs/ENVIRONMENT_VARIABLES.md` があれば読む
- `prisma/schema.prisma`
- `apps/api/src/routes/index.ts`
- `apps/api/src/lib/webhookSignature.ts`
- `apps/api/src/notifications/notificationDispatcher.ts`
- `apps/api/src/services/twilioWebhookService.ts`
- `apps/api/src/services/openaiResponderAdapter.ts`
- `apps/api/src/services/lineShiftParserAdapter.ts`
- `apps/web/app/admin/platform/page.tsx`
- `apps/web/app/admin/notifications/page.tsx`
- `apps/web/app/admin/ai-logs/page.tsx`

## 2. 絶対に守る制約

- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- 100店舗マルチテナント前提で、全DB/API/UIで `storeId` 分離を維持。
- 本番キーをコード・docs・ログ・ZIPに含めない。
- `.env` は納品ZIPに含めない。
- 外部APIは dummy / 未設定なら必ず mock fallback。
- 実キーを使う実送信・実通話・実OpenAI呼び出しは、ユーザーが明示的に許可しない限り行わない。
- クレジットが少なくなったら `docs/CREDIT_SAFE_HANDOFF.md` に従って即ZIP納品。

## 3. 今回のゴール P4

P4では、機能追加を増やしすぎず、店舗導入前に必要な「運用UI・検収・設定・導入手順」を固めてください。

優先順位:

1. P3成果物の再検証
2. フロントエンド統合と運用UIの完成度向上
3. 本番接続前チェックリストと環境変数管理
4. 店舗オンボーディング導線
5. 100店舗運用を想定したPlatform監視
6. 最終的な引き継ぎZIP

## 4. 最初にやる検証

まず以下を実行してください。

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
pnpm exec tsx apps/api/test/e2e.auth.ts
pnpm exec tsx apps/api/test/e2e.notification.ts
pnpm exec tsx apps/api/test/e2e.webhook.ts
pnpm exec tsx apps/api/test/e2e.shiftParser.ts
```

失敗した場合は、P4実装より先に修正してください。

## 5. P4 実装内容

### 5.1 Platform運用画面の強化

`/admin/platform` を店舗導入・監視に使える状態へ寄せてください。

必須:

- 店舗一覧
- READY / NOT_READY
- NOT_READY理由
- DB接続状態
- Clerk状態
- Twilio状態
- LINE状態
- OpenAI状態
- Voice adapter状態
- Notification adapter状態
- 電話転送設定
- `PhoneRoutingSetting` の表示
- 100店舗想定の検索・絞り込み

### 5.2 店舗オンボーディング導線

店舗導入時に必要な設定をUI/APIで確認できるようにしてください。

必須:

- 店舗基本情報
- 既存電話番号
- AI受電番号
- 転送導入モード
- コース登録状態
- セラピスト登録状態
- 部屋登録状態
- シフト登録状態
- ナレッジ登録状態
- 通知設定状態
- Webhook設定状態

### 5.3 通知・Webhook運用UI

`/admin/notifications` と `/admin/ai-logs` を運用向けに整えてください。

必須:

- SENT / FAILED / RETRYING / QUEUED の見分け
- retryボタン
- lastError表示
- providerMessageId表示
- dedupeKey表示
- Webhook受信ログ表示
- Twilio/LINE署名検証失敗ログの表示
- Escalation対応済み/未対応の表示

### 5.4 LINEシフト解析UI

可能なら追加してください。

- `/admin/line-shifts`
- 解析ジョブ一覧
- `PENDING_REVIEW`
- 承認
- 却下
- 修正
- Shift反映
- 低信頼エントリの警告表示

### 5.5 本番接続前チェック

APIまたはdocsで、本番接続前チェックリストを整備してください。

必須チェック:

- `.env` に必須キーが揃っているか
- dummyのままのキーがないか
- Webhook署名検証が有効か
- DB migration済みか
- seed/demoデータが本番に混ざっていないか
- Clerk metadataに `storeId` / `role` があるか
- Twilio番号・LINE channel・OpenAI model設定があるか
- AIがCONFIRMEDを作れないE2Eが通っているか

### 5.6 E2E追加

可能なら以下を追加してください。

- `e2e.readiness.ts`
- `e2e.onboarding.ts`
- `e2e.lineShiftApproval.ts`
- `e2e.productionChecklist.ts`

テストでは500をPASS扱いしないでください。

## 6. ドキュメント更新

必ず更新:

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CREDIT_SAFE_HANDOFF.md`

追加・更新推奨:

- `docs/PRODUCTION_READINESS.md`
- `docs/WEBHOOK_SECURITY.md`
- `docs/ENVIRONMENT_VARIABLES.md`
- `docs/STORE_ONBOARDING_RUNBOOK.md`
- `docs/PILOT_STORE_CHECKLIST.md`

## 7. 必須検証

最低限:

```bash
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm exec prisma validate --schema=prisma/schema.prisma
pnpm -r typecheck
pnpm -r build
```

実DB:

```bash
pnpm exec prisma migrate dev --schema=prisma/schema.prisma
pnpm exec tsx prisma/seed/seed.ts
pnpm exec tsx apps/api/test/e2e.reservationHold.ts
pnpm exec tsx apps/api/test/e2e.http.ts
pnpm exec tsx apps/api/test/e2e.crud.ts
pnpm exec tsx apps/api/test/e2e.auth.ts
pnpm exec tsx apps/api/test/e2e.notification.ts
pnpm exec tsx apps/api/test/e2e.webhook.ts
pnpm exec tsx apps/api/test/e2e.shiftParser.ts
```

追加したE2Eがあれば必ず実行してください。

可能ならNext.jsを起動し主要ページHTTP 200確認。

## 8. 納品

ZIPから必ず除外:

- `node_modules/`
- `.next/`
- `dist/`
- `.env`
- `*.log`
- `*.tsbuildinfo`
- 一時ファイル

完了報告は以下だけで短く:

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

