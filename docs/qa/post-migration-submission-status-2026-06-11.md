# 担当6 migration後 提出判定ステータス

作成日: 2026-06-11 JST  
判定: 提出不可  
本番URL: https://arare-ai-three.vercel.app  
一時URL: https://chest-electrical-cardiovascular-peripherals.trycloudflare.com/

## 確認済み

- `npx prisma migrate status --schema prisma/schema.prisma` は成功。
  - DB host: `db.pfktqgmkamtrkcuwrebl.supabase.co:5432`
  - 結果: `Database schema is up to date!`
- `npx prisma validate --schema prisma/schema.prisma` は成功。
- `npx tsc --noEmit` は成功。
- 一時URL `https://chest-electrical-cardiovascular-peripherals.trycloudflare.com/` は HTTP 200。ただし本番URLではないため、本番確認済みには含めない。
- `node scripts/verify-production-db-readiness.mjs` は成功。
  - `schemaReadableForCheckedModels: true`
  - `prdCoreModelsReadable: true`
  - `queryErrors: []`
  - `NotificationLog` は読取可能。現時点 count は 0。
  - `KnowledgeBase` / `FAQ` / `TalkScript` / `ReservationChangeHistory` は読取可能。現時点 count は 0。
  - `Therapist.specialties` は読取可能。サンプル5件で配列として取得。
  - future active reservations sampled 3件で紐付け欠落なし。
  - sampled future active reservations内でroom/therapist重複なし。
- `npm run verify:production -- https://arare-ai-three.vercel.app` は成功。
  - `/api/health` は HTTP 200 / `status: ok`。
  - `/api/twilio/sms/status` は HTTP 200。
  - `/api/ai/extract` は `CREATE_RESERVATION` を返した。
  - 認証必須APIは未ログインで401を返す。
- `node scripts/verify-one-day-readiness.mjs --base-url https://arare-ai-three.vercel.app --voice-relay-health-url https://voice-relay-production-dd5f.up.railway.app/health --json` は exit 1。
  - PASS: production health、AI extraction、voice relay health。
  - FAIL: setup checklist / admin state は認証情報なしで401。
- `node scripts/verify-production-parity.mjs --production=https://arare-ai-three.vercel.app --skip-local --json --timeout=30000` は `overall: UNVERIFIED`。
  - `/`、`/chat`、`/sign-in`、`/api/health` は確認済み。
  - `/store`、`/therapist`、`/customer`、`/ops`、`/phone-ai`、認証必須APIは未確認。
- `node scripts/verify-production-external-readiness.mjs https://arare-ai-three.vercel.app` は exit 1。
  - Twilio account は `active`、type `Full`。
  - 対象Twilio番号は存在。
  - 対象番号のVoice URLは `https://voice-relay-production-dd5f.up.railway.app/api/twilio/voice`。
  - 期待値として置いたVercel `/api/twilio/voice` とは不一致。
  - 直近Callログ10件は `completed`、直近SMSログ7件は `delivered`。
  - LINEはローカル検証環境の `LINE_CHANNEL_ACCESS_TOKEN` が空のため、LINE API読み取り確認は未実施。

## 実装済み

- `scripts/verify-production-db-readiness.mjs` を拡張し、migration後の次項目を読み取り確認できるようにした。
  - KnowledgeBase
  - FAQ
  - TalkScript
  - NotificationLog
  - ReservationChangeHistory
  - Therapist.specialties
- migration後の担当6提出判定ステータス文書を追加した。

## 未確認

| 項目 | 状態 | 提出判定 |
| --- | --- | --- |
| 担当2 予約作成/変更/キャンセル/approve | 結果未回収 | 提出不可 |
| 担当2 重複予約/シフト外/部屋不足/履歴保存 | 結果未回収 | 提出不可 |
| 担当3 Web Chat / LINE / 電話AIのナレッジ参照 | 結果未回収 | 提出不可 |
| 担当3 未登録情報/値引き/NG/変更/キャンセル安全応答 | 結果未回収 | 提出不可 |
| 担当4 実Twilio SMS callback | 未確認 | 提出不可 |
| 担当4 LINE失敗ログ | 未確認 | 提出不可 |
| 担当4 通知重複抑止 | 未確認 | 提出不可 |
| 担当5 PC/スマホUI | migration後の認証後UI未確認 | 提出不可 |
| 担当5 追加管理UI CRUD表示 | 未確認 | 提出不可 |
| Clerk権限別ログイン | テストアカウント/認証情報なし | 提出不可 |
| LINE本番Webhook実イベント | 未確認 | 提出不可 |
| 電話AI実通話 | 今回未実施 | 提出不可 |
| SMS callback DB反映 | NotificationLog読取は可能だが実callback未確認 | 提出不可 |
| 予約確定 -> SMS送信 -> DB反映 -> 店舗画面反映 | 未確認 | 提出不可 |

## 推測

- migration未適用によるDBスキーマ欠落ブロッカーは解消済みと見てよい。ただし、各機能のE2E成功までは未確認。
- `KnowledgeBase` / `FAQ` / `TalkScript` / `ReservationChangeHistory` / `NotificationLog` はテーブルとして読めるが、countが0の項目があるため、データ投入や機能動作は別途確認が必要。
- Twilio Voice URLの不一致は、Railway直行構成が正であれば問題ではない可能性がある。ただしVercel経由を提出条件にする場合は外部設定修正が必要。

## 実装上の判断

- 本番DBスキーマ、予約/通知/AI本体、本番設定は変更していない。
- 一時URLは本番確認済みに含めない。
- 認証後画面/API、外部実イベント、予約1周が未確認のため、提出判定は「提出不可」。
- `NotificationLog` が読めるようになったことは確認済みだが、SMS callback反映確認とは分けて扱う。

## 要ユーザー対応

- Clerk権限別ログイン用の本番テストアカウント、または検証用認証情報を提供する。
- LINE Developers側で本番Webhook実イベントを発生させる。
- Twilio実通話とSMS受信可能なテスト番号を用意する。
- 担当2〜5のmigration後検証結果を、証跡付きで担当6へ回収する。
- Twilio Voice URLの正を確認する。Railway直行が正なら提出資料側を合わせ、Vercel経由が正ならTwilio Console設定を変更する。

## 変更ファイル

- `docs/qa/post-migration-submission-status-2026-06-11.md`
- `scripts/verify-production-db-readiness.mjs`

## 他担当への影響

- 担当2: migration後の予約系E2Eと履歴保存結果が未回収。
- 担当3: ナレッジ参照と安全応答の本番/実DB確認結果が未回収。
- 担当4: 実SMS callback、LINE失敗ログ、通知重複抑止の確認が必要。
- 担当5: 認証後PC/スマホUIと追加管理UI CRUD表示確認が必要。
- 担当6: 上記が揃うまで提出不可を維持する。
