# Manus 新アカウント用: ARARE AI P3 本番接続準備・堅牢化プロンプト

添付ZIPを展開し、ARARE AI の開発を引き継いでください。

このManusアカウントには過去の会話履歴がない前提です。過去チャットには依存せず、添付ZIP内のコードとドキュメントを唯一の正として扱ってください。

## 0. 添付ZIPについて

添付ZIPは ARARE AI の P2 完了版です。

ここまでの到達点:

- 全CRUD API/UI
- 予約承認フロー
- 予約カレンダー
- Platform管理画面
- AI受付ログ・通知管理UI
- Clerk/RBACのMock/本番差し替え土台
- Notification Adapter
- Twilio/LINE通知Adapter境界
- OpenAI responder Adapter境界
- Twilio Voice Webhook / Conversation Relay 受け口
- LINEシフト解析Adapter
- 実DB E2Eの強化
- AIが直接 `CONFIRMED` を作らない安全制約

ただし、本番キーを使った実接続はまだ行っていません。

## 1. 最初に読むファイル

作業開始前に必ず以下を確認してください。

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CODEX_VERIFICATION_P1D.md`
- `docs/CREDIT_SAFE_HANDOFF.md`
- `prisma/schema.prisma`
- `apps/api/src/lib/webhookSignature.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/middleware/authClerk.ts`
- `apps/api/src/middleware/authz.ts`
- `apps/api/src/middleware/storeScope.ts`
- `apps/api/src/notifications/notificationDispatcher.ts`
- `apps/api/src/notifications/twilioSmsAdapter.ts`
- `apps/api/src/notifications/lineMessagingAdapter.ts`
- `apps/api/src/services/twilioWebhookService.ts`
- `apps/api/src/services/openaiResponderAdapter.ts`
- `apps/api/src/services/lineShiftParserAdapter.ts`

## 2. プロジェクト概要

ARARE AI は、メンズエステ店舗向けの AI受付・予約自動化SaaSです。

将来的に100店舗運用を想定しています。

主な機能:

- 電話AI / LINE / Webチャットによる一次受付
- 店舗ナレッジに基づく回答
- 仮予約作成
- 店舗スタッフ承認による予約確定
- 顧客、セラピスト、シフト、コース、部屋、ナレッジ管理
- 予約カレンダー
- Platform管理
- 通知管理
- AI受付ログ・エスカレーション管理
- LINEシフト解析
- マルチテナント `storeId` 分離

## 3. 絶対に守る制約

- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- 100店舗マルチテナント前提で、全DB/API/UIで `storeId` 分離を維持。
- 本番キーをコード・docs・ログ・ZIPに含めない。
- `.env` は納品ZIPに含めない。
- 外部APIは、環境変数がdummy/未設定なら必ずmock fallback。
- Twilio/LINE/OpenAI/Clerkの実キーを使う実送信・実応答は今回まだ行わない。
- 今回は「本番接続準備・堅牢化」まで。
- クレジットが少なくなったら、`docs/CREDIT_SAFE_HANDOFF.md` に従って即ZIP納品。

## 4. 今回のゴール

P3では、本番キーを入れた瞬間に事故らない状態へ寄せてください。

優先順位:

1. Twilio / LINE Webhook の本物に近い署名検証
2. DBありE2Eで「500をPASS扱い」しない厳密テスト
3. 通知・Webhook・AI安全性の失敗系テスト
4. 本番キー投入時の安全なAdapter切替
5. 運用監視・ヘルスチェック・導入手順の整備

## 5. 最初にやる検証

まず以下を実行してください。

```bash
pnpm install
pnpm exec prisma generate --schema=prisma/schema.prisma
pnpm exec prisma validate --schema=prisma/schema.prisma
pnpm -r typecheck
pnpm -r build
```

PostgreSQL が使える場合は、先にDBを起動してから既存E2Eも実行してください。

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

検証失敗があれば、P3実装より先に修正してください。

---

# Phase 1: Webhook署名検証

## 6.1 Twilio署名検証

`apps/api/src/lib/webhookSignature.ts` を強化してください。

必須:

- `twilio` npm package を使う。
- `twilio.validateRequest` / 必要に応じて `validateRequestWithBody` を使う。
- `X-Twilio-Signature` ヘッダーを検証。
- form-urlencoded と JSON の両方を考慮。
- `WEBHOOK_MOCK_MODE=true` または `TWILIO_AUTH_TOKEN=dummy` の場合だけmock通過。
- `WEBHOOK_MOCK_MODE=false` かつ署名なし/不正署名なら 403。
- Twilio retry用の `I-Twilio-Idempotency-Token` を保存/ログ化できる構造にする。

注意:

- Twilio署名検証は公式SDK検証を優先する。
- Voice Webhookは15秒以内に応答する前提で、重い処理を同期実行しない。

## 6.2 LINE署名検証

LINE Webhook署名検証を実装してください。

必須:

- `x-line-signature` ヘッダーを検証。
- `LINE_CHANNEL_SECRET` を使って HMAC-SHA256 + base64。
- raw body を使って検証。
- `WEBHOOK_MOCK_MODE=true` または `LINE_CHANNEL_SECRET=dummy` の場合だけmock通過。
- `WEBHOOK_MOCK_MODE=false` かつ署名なし/不正署名なら 403。

---

# Phase 2: 厳密E2E化

今後はDB未接続による500をPASS扱いしないでください。

修正対象:

- `apps/api/test/e2e.auth.ts`
- `apps/api/test/e2e.notification.ts`
- `apps/api/test/e2e.webhook.ts`
- `apps/api/test/e2e.shiftParser.ts`

必須:

- DB接続あり前提で実行。
- 期待ステータスを厳密化。
- 200/201/204/403/409/422 など、意味のあるステータスだけPASS。
- 500は必ずFAIL。
- NotificationLog / CallLog / AIConversationLog / Message / LineShiftParseJob の保存を検証。
- dedupe/retry/status遷移を実DBで確認。
- storeId分離を実データで確認。

---

# Phase 3: 通知基盤の本番切替準備

## 8.1 Twilio SMS Adapter

`twilioSmsAdapter.ts` を強化してください。

必須:

- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` がdummy/未設定ならmock送信。
- 本番値がある場合のみTwilio SDK送信へ切替。
- 送信結果SID、status、errorCode、errorMessageを `NotificationLog` に反映。
- status callback受信口を整備。
- 送信失敗時は `FAILED`、retry時は `RETRYING` を記録。

## 8.2 LINE Messaging Adapter

`lineMessagingAdapter.ts` を強化してください。

必須:

- `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` がdummy/未設定ならmock送信。
- 本番値がある場合のみLINE送信へ切替。
- 送信失敗時のerrorを `NotificationLog.lastError` に保存。
- LINE userId未登録時のfallbackを明確化。

---

# Phase 4: AI/電話安全性

`openaiResponderAdapter.ts` / `twilioWebhookService.ts` を強化してください。

必須:

- OpenAIキー未設定/dummyならmock。
- OpenAI本番接続用の差し替え口は作るが、今回実送信は不要。
- AI応答から直接 `Reservation(CONFIRMED)` を作れないことをテスト。
- Voice Webhook / Conversation Relay 経由でも `ReservationHold` まで。
- AIが高信頼でもスタッフ承認待ちにする。
- ナレッジ外は「確認が必要です。店舗に確認して折り返します。」を維持。
- LLM出力のJSON parse失敗時fallbackを実装。

---

# Phase 5: LINEシフト解析の運用化

`lineShiftParserAdapter.ts` と関連APIを強化してください。

必須:

- 低信頼 `confidenceScore < 0.5` は `PENDING_REVIEW` のまま。
- 高信頼でも即Shift反映ではなく、店舗設定で承認必須にできる構造にする。
- 解析結果一覧/確認APIを整備。
- 誤解析時の修正・却下APIを追加できるなら追加。
- E2Eで「低信頼がShiftに直接入らない」ことを厳密に検証。

---

# Phase 6: 運用監視・ヘルスチェック

追加してください。

- `/health`
- `/ready`
- `/stores/:storeId/health`

確認項目:

- DB接続
- Prisma migration状態の確認方針
- Notification adapter状態
- Voice adapter状態
- AI adapter状態
- LINE adapter状態
- Clerk mock/real mode

UIでは `/admin/platform` に店舗別のREADY/NOT_READY理由を表示してください。

---

## 9. ドキュメント更新

必ず更新:

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CODEX_VERIFICATION_P1D.md`
- `docs/CREDIT_SAFE_HANDOFF.md`

追加推奨:

- `docs/PRODUCTION_READINESS.md`
- `docs/WEBHOOK_SECURITY.md`
- `docs/ENVIRONMENT_VARIABLES.md`

## 10. 必須検証

最低限:

```bash
pnpm install
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

可能ならNext.jsを起動し主要ページHTTP 200確認。

## 11. 納品ルール

ZIPから必ず除外:

- `node_modules/`
- `.next/`
- `dist/`
- `.env`
- `*.log`
- `*.tsbuildinfo`
- 一時ファイル

## 12. 完了報告形式

以下だけで短く報告してください。

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

