# 本番E2E進捗メモ 2026-06-20

担当: Codex

## 確認済み

### 本番疎通

- 対象URL: `https://arare-ai-three.vercel.app`
- `npm run verify:production -- https://arare-ai-three.vercel.app`: 成功
- 直近30分のVercel本番500ログ: なし
- `node scripts/verify-production-db-readiness.mjs`: 成功

### 本番DB状態

読み取り確認では、以下のデータが存在する。

| 項目 | 件数 |
| --- | ---: |
| Store | 1 |
| Course | 4 |
| Room | 9 |
| Active Room | 3 |
| Therapist | 8 |
| Active Therapist | 2 |
| Shift | 31 |
| Future Shift | 2 |
| Reservation | 61 |
| Conversation | 4370 |
| User | 6 |

表示上0件に見える問題は、本番DB初期化ではなく、以前のVercel `DATABASE_URL` 認証失敗が主因と判断。

### 予約E2E（SMSなし）

本番DBにQA用仮予約を1件作成し、即キャンセルした。

| 項目 | 値 |
| --- | --- |
| 予約ID | `cmqltxe6d0003n7kwzk81h865` |
| QA marker | `QA-E2E-1781928006570` |
| 作成時status | `TENTATIVE` |
| 最終status | `CANCELLED` |
| 開始 | `2026-06-20T12:30:00.000Z` |
| コース | `Legend Massage 90分コース` |
| セラピスト | `清澄せいら` |
| 部屋 | `vinoプレジオ本町 101` |
| ReservationHold | 1件 |
| Notification | 2件 |
| AuditLog | `reservation.created`, `reservation.cancelled` |

## 追加確認 2026-06-20 15:40 JST

### 本番画面からの予約確定とSMS callback

ユーザーが本番画面から `テスト山田` の仮予約を確定した。

| 項目 | 値 |
| --- | --- |
| 予約ID | `cmqlyhoyp0003la04rf21hcth` |
| 顧客 | `テスト山田` |
| 開始 | `2026-06-21 01:00 JST` |
| 終了 | `2026-06-21 02:30 JST` |
| コース | `Legend Massage 90分コース` |
| セラピスト | `清澄せいら` |
| 部屋 | `vinoプレジオ本町 101` |
| 最終status | `CONFIRMED` |
| Hold | `approvedAt` あり |
| AuditLog | `reservation.created`, `reservation.approval_guard_passed`, `reservation.approved`, `notification.sms_status_callback` |
| 確定API | 本番ログで `POST /api/reservations/cmqlyhoyp0003la04rf21hcth/approve` が 200 |
| SMS callback | 本番ログで `/api/twilio/sms/status` へ2回到達 |

### SMS未到達の切り分け

- 確認済み: Twilio Message SID は `SM4af2f7f20ae4fc51f537cb70c1d41f6f`。
- 確認済み: DB callback payload の `MessageStatus` は `undelivered`。
- 確認済み: DB callback payload の `ErrorCode` は `30008`。
- 確認済み: Twilio REST API 直接取得でも `status=undelivered`, `error_code=30008`, `error_message=Unknown error`。
- 確認済み: Twilio Monitor Alerts にも同MessageSidで `30008` が記録されている。
- 確認済み: 送信元は `TWILIO_PHONE_NUMBER` / 店舗電話AI番号の米国番号。`TWILIO_SMS_FROM` は未設定。
- 確認済み: 送信本文は299文字、Twilio上では `numSegments=5`。
- 実装上の判断: アプリ側の確定処理、SMS送信要求、status callback受信、DB反映は動作している。未到達はTwilio/キャリア配送経路、宛先番号、長文分割、または送信元番号戦略の問題として切り分ける。
- 次に必要: 同じ宛先に短文SMSを送って、長文/分割起因か経路・番号起因かを確認する。

この確認では `approveReservation` は呼んでいないため、SMS送信は発生させていない。

## 未確認

- ログイン済み本番画面で `/store-v2` のカード表示が復旧したか。
- ログイン済み本番画面で `/reservations` のコース選択肢が表示されるか。
- 画面操作で予約作成、編集、キャンセルできるか。
- 予約確定によるSMS送信、Message SID、callback DB反映。
- LINE本番Webhookの実イベント反映。
- 電話AI実通話のCallSid付き再確認。

## 実装上の判断

- 予約E2Eのうち、SMSを伴わない仮予約作成とキャンセルは本番DBで確認済み。
- 確定処理はSMS送信が走るため、ユーザー許可とSMS受信可能なテスト番号が必要。
- 本番提出可能判定には、ログイン済みUI確認、SMS callback、LINE webhookの証跡がまだ必要。

## 追加確認 2026-06-20 13:45 JST

### 空き時間検索の速度改善

- 確認済み: 本番ログで、修正前は「空き時間を探す」1回に対して `/api/reservations` が約35回連続実行されていた。
- 実装済み: `/api/reservations/availability-slots` を追加し、候補日時を一括判定する形へ変更。
- 確認済み: ユーザーの本番スマホ確認で「早い、改善されてる」と報告あり。
- 確認済み: 本番ログ上も `POST /api/reservations/availability-slots` 1回と、必要時の詳細確認 `PUT /api/reservations` 1回に減少。

### 予約E2E再確認（SMSなし）

本番DBにQA用仮予約を1件作成し、直後にキャンセルした。確定APIはSMS送信を伴うため叩いていない。

| 項目 | 値 |
| --- | --- |
| 予約ID | `cmqlvjrio0003n7egv82273ro` |
| QA marker | `QA-E2E-SLOTS-1781930729705` |
| 空き候補一括判定 | `198ms` |
| 作成時status | `TENTATIVE` |
| 最終status | `CANCELLED` |
| 開始 | `2026-06-20T12:30:00.000Z` |
| コース | `Legend Massage 90分コース` |
| セラピスト | `清澄せいら` |
| 部屋 | `vinoプレジオ本町 101` |
| ReservationHold | 1件 |
| Notification | 2件 |
| AuditLog | `reservation.created`, `reservation.cancelled` |
