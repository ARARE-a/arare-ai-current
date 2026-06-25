# 本番QA / 提出判定レポート

作成日時: 2026-06-11 13:40 JST  
対象本番URL: https://arare-ai-three.vercel.app  
判定: 提出不可

## 確認済み

- 本番URL `https://arare-ai-three.vercel.app/api/health` は HTTP 200 / `status: ok`。
- health上の feature flags は `database/openai/line/twilio/clerk` がすべて `true`。
- `npm run verify:production -- https://arare-ai-three.vercel.app` は成功。
  - `/api/setup/checklist`、`/api/admin/state`、`/api/platform/stores` は未ログインで JSON 401 を返す。
  - `/api/twilio/sms/status` は HTTP 200 で callback endpoint として応答。
  - `/api/ai/extract` は予約意図 `CREATE_RESERVATION` を返した。
- `node scripts/verify-one-day-readiness.mjs --base-url https://arare-ai-three.vercel.app --voice-relay-health-url https://voice-relay-production-dd5f.up.railway.app/health --json` は exit 1。
  - PASS: production health、AI extraction、voice relay health。
  - FAIL: setup checklist / admin state は Clerk 認証なしで 401。
- `node scripts/verify-production-parity.mjs --production=https://arare-ai-three.vercel.app --skip-local --json --timeout=30000` は補正後 `overall: UNVERIFIED`。
  - `/`、`/chat`、`/sign-in` は本番HTTP 200。
  - `/store`、`/therapist`、`/customer`、`/ops`、`/phone-ai` は `/sign-in` へ 307 redirect。
  - `/api/setup/checklist`、`/api/admin/state`、`/api/notifications` は認証後内容未確認。
- Playwright実ブラウザで本番画面を確認。
  - PCトップ画像: `output/playwright/prodqa-pc-home-20260611.png`
  - スマホチャット画像: `output/playwright/prodqa-mobile-chat-20260611.png`
  - console確認: Clerk development keys warning、未ログイン `/api/admin/state` / `/api/notifications` の 401。
- 本番DBをPrismaで読み取り確認。
  - DB host: `db.pfktqgmkamtrkcuwrebl.supabase.co:5432`
  - stores 1、courses 4、rooms 9、activeRooms 3、therapists 8、activeTherapists 2、shiftsFromNow 2。
  - future active reservations sampled 3件で、room/therapist/course/customer の必須紐付け欠落なし。
  - sampled future active reservations 内で room / therapist の時間重複なし。
  - `NotificationLog` テーブルが存在しないため、notification log count / groupBy は P2021。
- Prisma migration状態を確認。
  - 未適用 migration: `202606110001_prd_core_models`
- Twilio APIを読み取り確認。
  - Account status は `active`、type は `Full`。
  - 対象番号は存在。
  - 対象番号の Voice URL は `https://voice-relay-production-dd5f.up.railway.app/api/twilio/voice`。
  - 直近Callログ10件は `completed`、直近Messageログ7件は `delivered`。

## 未確認

- Clerk権限別ログイン実操作。
- 認証後の `/store`、`/store-v2`、`/therapist`、`/customer`、`/ops`、`/phone-ai`、`/platform` の本番画面内容。
- LINE本番Webhookの実イベント。
- Twilio実通話を今回のQAで発生させた確認。
- SMS実送信と到達callbackのDB反映。
- 予約確定からSMS送信、DB反映、店舗画面反映までの1周。
- ルーム空き、セラピスト出勤、予約判定の画面経由整合。
- 店舗ホームページ情報の読み取り証跡。
- スマホ/PCの認証後UI最終確認。

## 推測

- `NotificationLog` テーブル欠落は、未適用 migration `202606110001_prd_core_models` が原因の可能性が高い。
- Twilio Voice URL がRailway直行なのは、voice relay構成として意図された可能性がある。ただし handoff 文書の期待値は Vercel `/api/twilio/voice` なので、どちらを正とするか確認が必要。
- スマホチャットの入力placeholderは表示幅内で一部切れて見える。致命的な操作不能ではないが、最終UI確認では要確認。

## 実装上の判断

- アプリ本体、予約/通知ロジック、DBスキーマは変更していない。
- `verify-production-parity.mjs` は、認証必須で未確認の行を `PASS` 扱いしないように補正した。
- 本番DB確認は読み取り専用スクリプトで実施した。
- Twilio/LINE確認は読み取り専用スクリプトで実施し、実通話・実SMS・実LINE送信は発生させていない。

## 要ユーザー対応

- 本番DBへ未適用 migration `202606110001_prd_core_models` を適用するか、DB担当が適用可否を判断する。
- Clerkの権限別テストアカウント、または `READINESS_COOKIE` / `READINESS_BEARER_TOKEN` / `READINESS_AUTH_HEADER` を提供する。
- LINE Developersで実Webhookイベントを発生させ、管理画面/DB反映を確認する。
- Twilio Voice webhook の正を決める。Vercel経由が正ならTwilio Console修正、Railway直行が正なら文書更新。
- 実通話テスト用の発信手段と、SMS到達確認用の受信可能な電話番号を用意する。

## 変更ファイル

- `scripts/verify-production-db-readiness.mjs`
- `scripts/verify-production-external-readiness.mjs`
- `scripts/verify-production-parity.mjs`
- `docs/qa/production-submission-judgement-2026-06-11.md`
- `output/playwright/prodqa-pc-home-20260611.png`
- `output/playwright/prodqa-mobile-chat-20260611.png`

## 他担当への影響

- DB/Prisma担当: 本番 migration 未適用と `NotificationLog` 欠落の確認が必要。
- 通知/SMS/LINE担当: SMS callback / NotificationLog / LINE実イベントは未達。
- Clerk/権限担当: development keys warning と権限別ログイン未確認の対応が必要。
- 電話AI/Twilio担当: Twilio Voice URL の正規構成確認と実CallSid付き通話検証が必要。
- UI担当: スマホチャットplaceholderの表示切れ、認証後PC/スマホUI未確認の確認が必要。
