# 本番提出ブロック確認 2026-06-14

作成日: 2026-06-14 JST  
担当: 担当6 本番QA/提出判定  
判定: 提出不可  
本番URL: https://arare-ai-three.vercel.app

## 確認済み

- migration未適用ブロックは解消済み。
  - `npx prisma migrate status --schema prisma/schema.prisma`: `Database schema is up to date!`
  - `npx prisma validate --schema prisma/schema.prisma`: 成功
  - `npx tsc --noEmit`: 成功
- 本番DBで新DB項目は読み取り可能。
  - `NotificationLog`: count 4
  - `KnowledgeBase`: count 2
  - `FAQ`: count 1
  - `TalkScript`: count 1
  - `ReservationChangeHistory`: count 10
  - `Therapist.specialties`: サンプル5件で配列として取得
- 本番DB読み取り確認で `queryErrors: []`。
- 本番公開URLの疎通。
  - `/`: HTTP 200
  - `/chat`: HTTP 200
  - `/sign-in`: HTTP 200
  - `/api/health`: HTTP 200 / `status: ok`
  - `/api/ai/extract`: `CREATE_RESERVATION`
  - `/api/twilio/sms/status`: HTTP 200
- 認証必須画面/APIは未ログイン状態で認証ゲートに入る。
  - `/store`、`/therapist`、`/customer`、`/ops`、`/phone-ai`: `/sign-in` へ 307 redirect
  - `/api/setup/checklist`、`/api/admin/state`、`/api/notifications`: 401
- Twilio read-only APIはローカル `.env` の資格情報で読取成功。
  - Twilio account: `active`
  - 対象番号: 存在確認済み
  - 直近Callログ10件: `completed`
  - 直近SMSログ7件: `delivered`
- `NotificationLog` は存在するが、SMS callback本番E2Eの証跡とは別扱い。
- `shiftsFromNow: 0`。本番DB上、現在時点以降の出勤データは0件。

## 実装済み

- `scripts/verify-production-db-readiness.mjs` は新DB項目の読み取り確認に対応済み。
- 認証必須項目を `PASS` にしないため、`scripts/verify-production-parity.mjs` は `UNVERIFIED` 判定を返す。
- 本番提出ブロックの確認結果をこの文書へ整理した。

## 未確認

提出ブロックとして残る項目:

| ブロック | 状態 | 提出判定 |
| --- | --- | --- |
| Clerk権限別ログイン | 認証情報なし。実ログイン未確認 | 提出不可 |
| LINE実Webhook | 実イベント未確認。ローカル検証用 `LINE_CHANNEL_ACCESS_TOKEN` は空 | 提出不可 |
| 電話AI実通話 | 今回のQAで実通話未実施。新しいCall SIDなし | 提出不可 |
| SMS callback | `/api/twilio/sms/status`疎通とNotificationLog存在は確認済み。ただし実Message SID callbackのDB反映は未確認 | 提出不可 |
| 予約1周 | 予約確定 -> SMS送信 -> DB反映 -> 店舗画面反映の同一フロー未確認 | 提出不可 |
| 本番認証後UI | 未確認。未ログインではredirect/401まで | 提出不可 |
| 担当3結果 | FAQ/KnowledgeBase/TalkScript投入後のHTTP経由確認は未回収 | 提出不可 |
| 担当4結果 | 実SMS callback、LINEログ、通知重複抑止、Twilio Auth Token形式エラー原因は未回収 | 提出不可 |
| 担当5結果 | 新一時URLのPC/スマホUI結果は未回収。本番認証後UIは未確認扱い | 提出不可 |

## 推測

- Twilio Auth Token形式エラーは、ローカル `.env` のTwilio read-only APIでは再現していない。Railway/Vercelなど別環境変数、または送信処理側で参照している値が原因の可能性がある。
- `shiftsFromNow: 0` のため、予約1周や空き判定を本番DBで検証するには、先に未来シフト投入が必要な可能性が高い。
- LINE本番設定は `/api/health` 上では有効に見えるが、こちらのローカル検証環境ではLINE APIを読めないため、実Webhook確認までは未確認のまま。

## 実装上の判断

- 本番設定、DBスキーマ、予約/通知/AI本体は変更していない。
- 一時URLの結果は本番提出判定に含めない。
- 未確認ブロックが1つでも残る場合は提出不可という指示に従い、現時点の判定は提出不可。
- Twilio read-onlyログに過去のcompleted/deliveredがあっても、今回の予約1周証跡ではないため提出条件には使わない。

## 要ユーザー対応

- Clerk本番テストアカウント、または検証用 `READINESS_COOKIE` / `READINESS_BEARER_TOKEN` / `READINESS_AUTH_HEADER` を提供する。
- LINE本番Botから実Webhookイベントを発生させ、イベントID/時刻/DB反映/画面反映を共有する。
- 電話AIの実通話を行い、Call SIDを共有する。
- SMS送信を発生させ、Message SIDとcallback後のDB反映を共有する。
- 予約1周確認用に、未来シフト、空きルーム、SMS受信可能なテスト電話番号を用意する。
- 担当3/4/5の検証結果を証跡付きで担当6へ共有する。

## 変更ファイル

- `docs/qa/production-submission-blockers-2026-06-14.md`

## 他担当への影響

- 担当3: HTTP経由確認結果が未回収。担当6の提出判定では未確認扱い。
- 担当4: 実callback/LINEログ/重複抑止/Twilio Auth Token原因が未回収。提出不可の主要ブロック。
- 担当5: 一時URLのPC/スマホUI確認は本番確認扱いにしない。本番認証後UIは未確認。
- 担当6: Clerk/LINE/電話/SMS/予約1周の証跡が揃うまで提出不可を維持する。
