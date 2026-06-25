# 担当6 本番QAチェックリスト / migration適用後E2E手順

作成日: 2026-06-11 JST  
現在判定: 提出不可  
対象本番URL: https://arare-ai-three.vercel.app

## 現在の全体ブロッカー

- Supabase DB に migration `202606110001_prd_core_models` が未適用。
- 本番DBで `NotificationLog` テーブルが存在しないことを確認済み。
- `Therapist.specialties`、KnowledgeBase、FAQ、TalkScript、NotificationLog、ReservationChangeHistory などを使う画面/APIは、本番実DBで500になる可能性がある。
- Clerk権限別ログイン、LINE本番Webhook実イベント、Twilio実通話、SMS callback DB反映、予約確定から店舗画面反映までの1周は未確認。

## 1. migration適用前チェックリスト

提出判定はこの段階では必ず「提出不可」のままにする。

- `npx prisma migrate status --schema prisma/schema.prisma` を実行し、未適用 migration と接続先DB hostを記録する。
- `node scripts/verify-production-db-readiness.mjs` を実行し、`schemaReadableForCheckedModels: false` と `NotificationLog` P2021 が再現するか確認する。
- `https://arare-ai-three.vercel.app/api/health` を確認し、healthの `features` と `publicAppUrl` を記録する。ただしhealthが `ok` でも提出可能とは扱わない。
- Vercel / Railway / Supabase の `DATABASE_URL` が対象Supabase本番DBを指しているか、外部設定担当に確認する。
- DB担当に、migration適用前バックアップまたは復旧手段があることを確認する。
- migration SQLの対象が既存データを破壊しないか、DB担当に確認する。
- migration適用中は、LINE/Twilio/予約E2Eの実イベントを実行しない。
- migration適用者、適用開始時刻、適用完了時刻、対象DB hostを記録する欄を用意する。

記録欄:

| 項目 | 値 |
| --- | --- |
| migration適用者 | |
| 適用前DB host | |
| 適用前 `prisma migrate status` 結果 | |
| backup / rollback確認 | |
| 適用開始時刻 | |
| 適用完了時刻 | |

## 2. migration適用後チェックリスト

次の全項目が確認できるまで、提出判定は「提出不可」のままにする。

- `npx prisma migrate status --schema prisma/schema.prisma` が「Database schema is up to date」相当になること。
- `node scripts/verify-production-db-readiness.mjs` が `schemaReadableForCheckedModels: true` になること。
- `NotificationLog` count / groupBy が P2021 なしで読めること。
- `ReservationChangeHistory` を使う予約変更/確定処理でDBエラーが出ないこと。
- `npm run verify:production -- https://arare-ai-three.vercel.app` が成功すること。
- 認証情報を入れた状態で `node scripts/verify-one-day-readiness.mjs --base-url https://arare-ai-three.vercel.app --voice-relay-health-url https://voice-relay-production-dd5f.up.railway.app/health --json` が成功すること。
- `node scripts/verify-production-parity.mjs --production=https://arare-ai-three.vercel.app --skip-local --json --timeout=30000` で、認証が必要な行を別途Clerk手順で確認済みにできること。
- `node scripts/verify-production-external-readiness.mjs https://arare-ai-three.vercel.app` を実行し、Twilio/LINEの外部設定状態を記録する。
- Vercel production logs / Railway logs に migration後の500が出ていないことを確認する。

合格条件:

| 項目 | 合格条件 | 結果 |
| --- | --- | --- |
| Prisma migration | 未適用なし | |
| DB readiness | queryErrors 0 | |
| NotificationLog | count可能 | |
| ReservationChangeHistory | 予約確定/変更で作成確認 | |
| Protected API | 認証済みで200 | |
| 本番ログ | 新規500なし | |

## 3. Clerk権限別ログイン確認手順

必要なもの:

- Platform管理者、OWNER、MANAGER、STAFF の本番Clerkテストアカウント。
- 必要なら `READINESS_COOKIE` / `READINESS_BEARER_TOKEN` / `READINESS_AUTH_HEADER`。
- 各アカウントがDB上の `User.email` と対応していること。

手順:

1. ブラウザを新規セッションで開く。
2. `https://arare-ai-three.vercel.app/sign-in` にアクセスする。
3. 対象ロールのアカウントでログインする。
4. ログイン後、次のページを確認してスクリーンショットを保存する。
   - Platform管理者: `/platform`、`/permissions`、`/setup`
   - OWNER / MANAGER: `/store-v2`、`/customer`、`/ops`、`/phone-ai`
   - STAFF: 許可された店舗運用画面、許可外画面の拒否表示
5. `/api/setup/checklist`、`/api/admin/state`、`/api/notifications` が認証済みで200または仕様通りの応答になることを確認する。
6. ログアウトし、次のロールで同じ手順を繰り返す。

確認観点:

- ロールごとに見える店舗/機能範囲が正しい。
- 許可外画面が見えていない。
- 401/403/500 が出ていない。
- Clerk development keys warning が本番で残っていない。

証跡:

| ロール | アカウント | 確認ページ | API結果 | スクリーンショット | 判定 |
| --- | --- | --- | --- | --- | --- |
| Platform管理者 | | | | | |
| OWNER | | | | | |
| MANAGER | | | | | |
| STAFF | | | | | |

## 4. LINE本番Webhook実イベント確認手順

必要なもの:

- LINE DevelopersでWebhookが有効化されていること。
- Webhook URL: `https://arare-ai-three.vercel.app/api/line/webhook`
- 本番LINE Botに送信できる顧客テストLINEアカウント。
- セラピストLINE連携を確認する場合は、対象セラピストの `lineId` がDBに紐付いていること。

手順:

1. LINE DevelopersでWebhook URLと有効状態を確認する。
2. 可能なら `node scripts/verify-production-external-readiness.mjs https://arare-ai-three.vercel.app` でLINE webhook endpointを読み取り確認する。
3. 顧客LINEから、予約にならない安全な問い合わせを送信する。
   - 例: `QA-LINE-20260611 料金を知りたいです`
4. Vercel logsで `/api/line/webhook` が実イベントを受け、200を返したことを確認する。
5. DBで `Conversation.channel = LINE`、Message、必要なEscalation/AI応答が作成されていることを確認する。
6. 管理画面の履歴にLINE会話が表示されることを確認する。
7. セラピストLINEの出勤/退室入力を確認する場合は、仕様で定義された文面のみ送信し、Shift反映と画面反映を確認する。

合格条件:

- LINE DevelopersのWebhookが有効。
- 実LINE送信イベントが本番URLに到達。
- DBと管理画面に同じイベント証跡が残る。
- 500、署名エラー、重複保存がない。

## 5. Twilio実通話とSMS callback DB反映確認手順

必要なもの:

- Twilio対象番号。
- 発信可能なテスト電話。
- SMS受信可能なテスト電話番号。
- Twilio Console閲覧権限。
- migration適用後の `NotificationLog` 利用可能状態。

事前確認:

- Twilio Voice webhook の正規URLを決める。
  - Railway直行を正とする場合: `https://voice-relay-production-dd5f.up.railway.app/api/twilio/voice`
  - Vercel経由を正とする場合: `https://arare-ai-three.vercel.app/api/twilio/voice`
- `https://voice-relay-production-dd5f.up.railway.app/health` が `ok: true`。
- `node scripts/verify-production-external-readiness.mjs https://arare-ai-three.vercel.app` でTwilio番号設定と直近ログを記録する。

実通話手順:

1. テスト電話からTwilio対象番号へ発信する。
2. 次のような予約確定まで進むテスト文面で会話する。
   - `今日21時で空いてますか。90分でお願いします。フリーでお願いします。名前はQAテストです。電話番号はテスト用番号です。はい。`
3. Twilio ConsoleでCall SIDを記録する。
4. Railway / Vercel logsで同じCall SIDが出ていることを確認する。
5. DBで `CallLog.twilioCallSid` が同じCall SIDになっていることを確認する。
6. 予約またはReservationHoldが作成されていることを確認する。
7. SMS送信が発生した場合、Twilio Message SIDを記録する。
8. DBで `Notification.smsSid`、`Notification.smsDeliveryStatus`、`NotificationLog.providerMessageId` を確認する。
9. Twilio Message statusが `accepted/sent/delivered` のいずれかから最終的に `delivered` または失敗理由付きになることを確認する。
10. `/api/twilio/sms/status` のcallbackがDBへ反映されたことを確認する。

合格条件:

- Call SIDがTwilio、ログ、DBで一致。
- 予約/保留、通知、SMS Message SIDが同じ流れに紐付く。
- SMS callback後にDBのdelivery statusが更新される。
- NotificationLogに送信試行と結果が残る。

## 6. 予約確定 -> SMS送信 -> DB反映 -> 店舗画面反映 1周確認手順

必要なもの:

- migration適用済みDB。
- Clerk OWNERまたはMANAGERアカウント。
- SMS受信可能なテスト電話番号。
- 店舗画面をPC/スマホで確認できる環境。

手順:

1. 事前DB状態を記録する。
   - active rooms
   - active therapists
   - shiftsFromNow
   - future active reservations
   - pending/failed notifications
2. Web Chat、LINE、または電話AIのいずれかでQA用予約を作る。
   - 名前に `QAテスト` を含める。
   - 電話番号はSMS受信可能なテスト番号を使う。
   - 日時、コース、フリー/指名、注意事項、最終確認の状態を記録する。
3. OWNERまたはMANAGERで `/store-v2` にログインする。
4. 店舗画面で該当予約/保留が表示されることを確認する。
5. 店舗画面から予約を確定する。
6. DBで次を確認する。
   - `Reservation.status = CONFIRMED`
   - `ReservationHold.approvedAt` または相当する確定証跡
   - `ReservationChangeHistory` 作成
   - `Notification` 作成
   - `NotificationLog` 作成
7. Twilio ConsoleでMessage SIDとdelivery statusを確認する。
8. `/api/twilio/sms/status` callback後、DBの `smsDeliveryStatus` / `smsDeliveredAt` / `smsDeliveryRaw` を確認する。
9. 店舗画面を再読込し、今日/未来予約、通知状態、失敗件数に反映されていることを確認する。
10. PCとスマホ両方でスクリーンショットを保存する。

合格条件:

- 予約確定操作で500が出ない。
- DB、Twilio、店舗画面の予約ID/顧客/日時/通知状態が一致。
- SMSが届く、または失敗時に失敗理由がDBと画面に残る。
- ルーム/セラピストの重複がない。
- 通知重複送信がない。

## 最終提出判定条件

次のすべてが満たされるまで「提出不可」。

- 本番DB migration未適用が0。
- Clerk権限別ログインが全ロールで確認済み。
- LINE本番Webhook実イベントがDB/画面に反映済み。
- Twilio実Call SIDがDB/ログ/画面で照合済み。
- SMS callbackがDBへ反映済み。
- 予約確定からSMS送信、DB反映、店舗画面反映までの1周が確認済み。
- PC/スマホの認証後UIで重大な表示崩れなし。
- 本番ログに新規500なし。
