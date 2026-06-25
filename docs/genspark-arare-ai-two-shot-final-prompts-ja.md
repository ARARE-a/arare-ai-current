# Genspark 残り2回用プロンプト

## 使い方

クレジットが残り少ないため、以下の2回だけを使う。

- 1回目: P0bデータモデル補完 + 予約中核API
- 2回目: 最小UI接続 + 最終検証 + ZIP納品

長文説明、再設計、追加資料作成、質問返しは禁止。

---

## 1回目に貼るプロンプト

```text
残りクレジットが少ないため、確認せず実装してください。
このターンでは「P0bデータモデル補完 + 予約中核API」まで進めてください。

前提:
- P0a修正版ZIPを土台にする
- PRD完全版に記載されたP0範囲のみ
- 本番Supabase/Twilio/LINE/Clerk/OpenAIキーは使わない
- 外部連携はmock/stubのみ
- 長文説明、設計書作成、質問返しは禁止

実装すること:

1. Prisma schemaのP0b補完
- Message に storeId を追加
- StoreGroup
- CourseOption
- NgRuleMatch
- ReservationChangeHistory
- AiSetting
- BlacklistEntry
- Role
- Permission
- RolePermission
- SalesRecord
- Notification

2. 予約中核APIをPrisma前提で実装
- POST /stores/:storeId/reservation-holds
- POST /stores/:storeId/reservation-holds/:id/approve
- POST /stores/:storeId/reservation-holds/:id/reject
- GET /stores/:storeId/reservations
- POST /stores/:storeId/reservations
- POST /stores/:storeId/ai/mock-message

3. 必須ロジック
- storeIdなしの店舗データアクセス拒否
- AIはCONFIRMEDを直接作らない
- 承認APIのみCONFIRMEDを作れる
- 承認時に最新の空き状況を再確認する
- ダブルブッキング防止
- シフト外予約防止
- 部屋不足防止
- NGルール一致時はEscalation
- ナレッジ外は「確認が必要です。店舗に確認して折り返します。」
- AuditLogを作る口を用意
- NotificationLog dedupeを使う

4. 検証
- npx prisma validate --schema=prisma/schema.prisma
- pnpm -r typecheck

5. ZIP納品
- ZIP化してダウンロードURLを出す

優先順位:
1. prisma validate / typecheckを通す
2. schemaのP0b補完
3. ReservationHold承認フローAPI
4. 予約事故防止ロジック
5. ZIP納品

時間が足りない場合、UIは触らなくてよいです。

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / 次にやること
```

---

## 2回目に貼るプロンプト

```text
確認せず実行してください。
このターンが最終想定です。
目的は「最小UI接続 + 最終検証 + ZIP納品」です。

前回ZIPを土台にしてください。
長文説明、追加設計、質問返しは禁止です。

実装すること:

1. PC管理画面の最小UIをAPIまたはmock dataにつなぐ
- ダッシュボード
- 仮予約承認キュー
- 予約一覧
- ナレッジ管理
- AI受付ログ
- Platform Admin 100店舗監視

2. スマホ運用画面の最小UIをAPIまたはmock dataにつなぐ
- ホーム
- 今すぐ対応
- 仮予約承認
- 会話詳細

3. 必須UI挙動
- 仮予約が承認待ちとして見える
- 承認/却下操作ができる
- AIが独断で予約確定しないことが画面で分かる
- 未対応Escalationが見える
- 通知失敗が見える
- 100店舗の導入状態がPlatform Adminで見える

4. 最終検証
- npx prisma validate --schema=prisma/schema.prisma
- pnpm -r typecheck
- 可能なら pnpm -r build

5. 最終納品
- ZIP化
- ダウンロードURLを提示
- 実装済み/未実装/未検証を短く報告

優先順位:
1. typecheck/prisma validateを通す
2. 仮予約承認キューのUI
3. PCダッシュボード
4. スマホ今すぐ対応
5. Platform Admin 100店舗監視
6. ZIP納品

時間が足りない場合、見た目の作り込みは不要です。
業務導線が分かる最小UIを優先してください。

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / 次にやること
```
