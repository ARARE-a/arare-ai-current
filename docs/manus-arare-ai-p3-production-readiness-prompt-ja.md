# Manus 用: ARARE AI P3 本番接続準備・堅牢化プロンプト

添付ZIPを展開し、ARARE AI の P3「本番接続準備・堅牢化」を実装してください。

このZIPは P2 完了版です。
過去チャットには依存せず、ZIP内のコードとドキュメントを唯一の正として扱ってください。

## 0. 最初に読むファイル

- `README.md`
- `docs/HANDOFF.md`
- `docs/STATUS_REPORT.md`
- `docs/TODO_NEXT.md`
- `docs/AUTH_DESIGN.md`
- `docs/CODEX_VERIFICATION_P1D.md`
- `docs/CREDIT_SAFE_HANDOFF.md`
- `prisma/schema.prisma`
- `apps/api/src/lib/webhookSignature.ts`
- `apps/api/src/services/twilioWebhookService.ts`
- `apps/api/src/notifications/twilioSmsAdapter.ts`
- `apps/api/src/notifications/lineMessagingAdapter.ts`
- `apps/api/src/services/openaiResponderAdapter.ts`
- `apps/api/src/services/lineShiftParserAdapter.ts`
- `apps/api/src/routes/index.ts`

## 1. 絶対制約

- 本番キーをコード・docs・ログ・ZIPに含めない。
- `.env` は納品ZIPに含めない。
- AI が予約を直接 `CONFIRMED` にする実装は禁止。
- 予約確定は必ず `ReservationHold -> staff approval -> Reservation(CONFIRMED)` のみ。
- 100店舗マルチテナント前提で、全DB/API/UIで `storeId` 分離を維持する。
- 外部APIを実送信する処理は、環境変数がdummy/未設定なら必ずmock fallback。
- クレジットが少なくなったら、`docs/CREDIT_SAFE_HANDOFF.md` に従って即ZIP納品する。

## 2. 今回のゴール

本番キーをまだ入れなくても、本番接続直前の安全性を最大化してください。

優先順位:

1. Twilio / LINE Webhook の本物に近い署名検証
2. DBありE2Eで「500をPASS扱い」しない厳密テスト
3. 通知・Webhook・AI安全性の失敗系テスト
4. 本番キー投入時の安全なAdapter切替
5. 運用監視・ヘルスチェック・導入手順の整備

## 3. Webhook署名検証

### 3.1 Twilio

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

- 独自HMAC実装に寄せすぎない。Twilioは公式SDK検証を優先。
- Voice Webhookは15秒以内に応答する前提で重い処理を同期実行しない。

### 3.2 LINE

LINE Webhook署名検証を実装してください。

必須:

- `x-line-signature` ヘッダーを検証。
- `LINE_CHANNEL_SECRET` を使って HMAC-SHA256 + base64。
- raw body を使って検証。
- `WEBHOOK_MOCK_MODE=true` または `LINE_CHANNEL_SECRET=dummy` の場合だけmock通過。
- `WEBHOOK_MOCK_MODE=false` かつ署名なし/不正署名なら 403。

## 4. 厳密E2E化

今後はDB未接続による500をPASS扱いしないでください。

修正対象:

- `apps/api/test/e2e.auth.ts`
- `apps/api/test/e2e.notification.ts`
- `apps/api/test/e2e.webhook.ts`
- `apps/api/test/e2e.shiftParser.ts`

必須:

- DB接続ありの前提で実行。
- 期待ステータスを厳密化。
- 200/201/204/403/409/422 など、意味のあるステータスだけPASS。
- 500は必ずFAIL。
- NotificationLog / CallLog / AIConversationLog / Message / LineShiftParseJob の保存を検証。
- dedupe/retry/status遷移を実DBで確認。
- storeId分離を実データで確認。

## 5. 通知基盤の本番切替準備

### 5.1 Twilio SMS Adapter

`twilioSmsAdapter.ts` を強化してください。

必須:

- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` がdummy/未設定ならmock送信。
- 本番値がある場合のみTwilio SDK送信へ切替。
- 送信結果SID、status、errorCode、errorMessageを `NotificationLog` に反映。
- status callback受信口を整備。
- 送信失敗時は `FAILED`、retry時は `RETRYING` を記録。

### 5.2 LINE Messaging Adapter

`lineMessagingAdapter.ts` を強化してください。

必須:

- `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` がdummy/未設定ならmock送信。
- 本番値がある場合のみLINE送信へ切替。
- 送信失敗時のerrorを `NotificationLog.lastError` に保存。
- LINE userId未登録時のfallbackを明確化。

## 6. AI/電話安全性

`openaiResponderAdapter.ts` / `twilioWebhookService.ts` を強化してください。

必須:

- OpenAIキー未設定/dummyならmock。
- OpenAI本番接続用の差し替え口は作るが、今回実送信は不要。
- AI応答から直接 `Reservation(CONFIRMED)` を作れないことをテスト。
- Voice Webhook / Conversation Relay 経由でも `ReservationHold` まで。
- AIが高信頼でもスタッフ承認待ちにする。
- ナレッジ外は「確認が必要です。店舗に確認して折り返します。」を維持。
- LLM出力のJSON parse失敗時fallbackを実装。

## 7. LINEシフト解析の運用化

`lineShiftParserAdapter.ts` と関連APIを強化してください。

必須:

- 低信頼 `confidenceScore < 0.5` は `PENDING_REVIEW` のまま。
- 高信頼でも即Shift反映ではなく、店舗設定で承認必須にできる構造にする。
- 解析結果一覧/確認APIを整備。
- 誤解析時の修正・却下APIを追加できるなら追加。
- E2Eで「低信頼がShiftに直接入らない」ことを厳密に検証。

## 8. 運用監視・ヘルスチェック

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

## 11. 納品

ZIPから必ず除外:

- `node_modules/`
- `.next/`
- `dist/`
- `.env`
- `*.log`
- `*.tsbuildinfo`
- 一時ファイル

完了報告:

- 実装済み
- 検証済み
- 修正ファイル
- 未実装
- 未検証
- 既知のリスク
- 納品URL
- 次にやること

