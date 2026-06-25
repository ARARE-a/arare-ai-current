# ARARE AI Genspark用PRD / 開発指示書

## 0. このドキュメントの目的

このドキュメントは、Genspark AI DeveloperでARARE AIを開発するためのPRD兼実装指示書である。

Gensparkには、最初から全機能を一気に作らせない。まずは、商用化に耐える土台として以下を優先する。

- 予約事故を起こさないDB設計
- 店舗ごとの設定とナレッジ管理
- 仮予約から店舗承認への安全な予約フロー
- PC管理画面
- スマホ運用画面
- LINE / 電話AI / SMS連携に備えたWebhookとモック実装
- 実装済み、未実装、未検証を正直に分けた提出レポート

重要: 外部サービスの本番確認をしていないのに「本番確認済み」と報告してはいけない。

---

## 1. Gensparkへ最初に貼るプロンプト

以下をGenspark AI Developerの「Full-Stack Websites or App」に貼る。

```text
ARARE AIという、メンズエステ店舗向けのAI受付・予約自動化SaaSを作ってください。

目的は、電話、LINE、Webチャットから来た予約問い合わせをAIが一次受付し、店舗ごとのコース、料金、セラピスト、シフト、部屋、注意事項、NG対応ルール、FAQ、トークスクリプトだけを参照して、仮予約を作成し、店舗スタッフが承認してから予約確定する業務アプリを作ることです。

最初のMVPでは、実Twilio、実LINE、実SMS、実OpenAIの本番接続を完了したと主張しないでください。まずは以下を作ってください。

1. PC管理画面
2. スマホ運用画面
3. 店舗オンボーディング
4. コース、料金、部屋、セラピスト、シフト管理
5. 顧客管理
6. 予約CRUD
7. ダブルブッキング防止
8. シフト外予約防止
9. 部屋不足防止
10. ReservationHoldによる仮予約
11. 店舗承認後の予約確定
12. ナレッジ、FAQ、トークスクリプト、NG回答管理
13. AI受付ログ
14. 電話AI / LINE / Webチャットのモック受付画面
15. Twilio / LINE / SMS / OpenAI用のWebhookエンドポイントとサービス層
16. 通話ログ、文字起こし、AI要約を保存できるCallLog
17. NotificationLogによる通知重複防止
18. AuditLog
19. 初回設定チェックリスト
20. 非通知電話拒否ロジック
21. 本番提出チェックリスト
22. README、.env.example、実装済み/未実装/未検証レポート

AIは登録済み情報以外を回答してはいけません。未登録情報には「確認が必要です」と返してください。

AIは顧客の明確な同意、仮予約、店舗承認なしに予約を確定してはいけません。

Gensparkの標準フルスタック構成に合わせて実装してください。可能であれば TypeScript、Hono/Node.js、PostgreSQLまたはGensparkで利用可能なDB、Tailwind CSS、shadcn/ui相当のUI、Cloudflare Pages/Workers向け構成にしてください。DBがPostgreSQLでない場合は、予約確定時の排他制御の制約をREADMEに明記してください。

UIは業務アプリとして作ってください。LPではなく、ログイン後の管理画面を最初の画面にしてください。

PC画面はSquare Dashboard、Shopify Admin、Google Calendar、LINE公式アカウント管理画面のように、情報密度が高く、静かで、運用しやすい司令塔にしてください。

スマホ画面は現場スタッフがすぐ使える作業端末にしてください。390x844基準で、未対応キュー、本日の予約、通知失敗、空き部屋、出勤セラピスト、最新AIログ、クイックアクション、下部ナビを見やすく配置してください。

最後に、実装済み、未実装、未検証、外部サービス側でユーザー設定が必要な項目を分けて報告してください。
```

---

## 2. プロダクト名

ARARE AI

メンズエステ店舗向けのAI受付・予約自動化OS。

単なる予約フォームではなく、店舗ごとの情報をAIが参照し、電話・LINE・Webチャット・管理画面・スマホ運用画面を一元管理するSaaSである。

---

## 3. MVPの基本方針

Gensparkで最初に作るものは「本番運用可能な最小構成の土台」である。

MVPで実現すること:

- 店舗情報を登録できる
- コース、料金、部屋、セラピスト、シフトを登録できる
- 顧客情報を管理できる
- 管理画面から予約を作成、変更、キャンセルできる
- AI受付の問い合わせから仮予約を作成できる
- 店舗スタッフが仮予約を承認して確定できる
- ダブルブッキングを防ぐ
- シフト外予約を防ぐ
- 部屋不足時は予約不可にする
- ナレッジ未登録情報には「確認が必要です」と返す
- LINE、電話、Webチャットの受付をモックで確認できる
- Twilio、LINE、SMS、OpenAIの接続口を用意する
- 実接続していないものは未検証として表示する

### 3.1 100店舗導入前提

ARARE AIは、初期構想の時点から100店舗導入を想定する。

100店舗前提で必須になること:

- 店舗ごとのデータ完全分離
- 店舗ごとのAI受付設定
- 店舗ごとの電話番号ルーティング
- 店舗ごとのLINE設定
- 店舗ごとのSMS/通知設定
- 店舗ごとのナレッジ、FAQ、NGルール
- 店舗ごとの承認SLA
- 店舗ごとの通話ログ、会話ログ、監査ログ
- Platform Adminによる全店舗監視
- 店舗横断の導入状態ダッシュボード
- 外部連携の未設定、失敗、期限切れを一覧で見られること
- 通知、通話、AI処理をジョブ化し、失敗時に再試行できること

100店舗前提で避けること:

- 1店舗前提の固定設定
- 店舗IDなしのデータ保存
- すべての店舗が同じ電話AI番号に転送される設計
- 店舗ごとの営業時間、ルール、NG条件を共通化してしまうこと
- Platform Adminしか操作できない属人運用
- 障害時にどの店舗で失敗したか追跡できないログ

MVP時点では全機能を大規模化しすぎないが、DB、API、電話ルーティング、権限、ログは100店舗で破綻しない構造にする。

MVPで無理に作らないこと:

- Instagram DM連携
- X DM連携
- SNS自動投稿
- 広告自動運用
- NG客の完全自動判定
- 顧客同一人物の完全自動判定
- AIによる売上改善提案
- 電話AIによる即時予約確定
- クレームの自動解決
- 値引き交渉

---

## 4. 最重要原則

### 4.1 AIの回答制限

AIが回答に使ってよい情報は以下のみ。

- 店舗設定
- コース
- オプション
- 料金
- セラピスト情報
- シフト
- 部屋情報
- FAQ
- ナレッジ
- トークスクリプト
- NG回答ルール
- 予約ルール
- キャンセルルール
- 注意事項

未登録情報については、必ず以下のように回答する。

```text
確認が必要です。店舗に確認して折り返します。
```

### 4.2 予約確定の安全原則

AIは予約を直接確定してはいけない。

予約は必ず以下の順番にする。

1. 顧客の希望日時を取得
2. コースを取得
3. 指名有無を取得
4. 顧客名を取得
5. 折り返し可能な電話番号を取得
6. 来店経験を取得
7. 注意事項を確認
8. NGフラグ、ブラックリストを確認
9. 対応可能セラピストを検索
10. セラピストの空きを確認
11. 部屋の空きを確認
12. ダブルブッキングを検証
13. ReservationHoldを作成
14. AIが内容を復唱
15. 顧客が明確に同意
16. 店舗へ確認通知
17. 店舗スタッフが承認
18. 予約をCONFIRMEDにする
19. LINEまたはSMSで確定通知を送る

### 4.3 本番検証の正直さ

Gensparkは以下を勝手に「確認済み」と報告してはいけない。

- Twilio実通話
- LINE本番Webhook
- SMS status callback
- OpenAI本番API応答
- 本番DB migration
- 本番URLでのE2E
- 実端末スマホ確認

未検証は未検証として報告する。

---

## 5. 想定ユーザー

### 5.1 Platform Admin

複数店舗の導入状態、外部連携状態、提出判定、障害、環境変数、確認証跡を管理する。

### 5.2 Owner

店舗設定、権限、予約、通知、電話AI、LINE、売上、運用品質を管理する。

### 5.3 Manager

日常運用、予約確定、顧客対応、通知再送、シフト、部屋割当を管理する。

### 5.4 Staff

本日の予約、AI受付ログ、通知失敗、未対応キュー、顧客メッセージを確認・処理する。

### 5.5 Therapist

自分に割り当てられた予約、出勤、来店準備、連絡事項のみ確認する。

---

## 6. Genspark向け技術構成

Gensparkの生成環境に合わせるが、以下を優先する。

### 6.1 推奨構成

- Frontend: TypeScript / Tailwind CSS / shadcn/ui相当 / lucide icons
- Backend: Hono または Node.js API
- Hosting: Cloudflare Pages / Workers または Genspark Hosted
- DB: PostgreSQLを第一候補
- ORM: Prisma またはGenspark標準のDBアクセス層
- Auth: Clerk、またはGenspark標準認証
- AI: OpenAI API用サービス層
- 電話: Twilio Voice / Conversation Relay / Media Streamsに接続可能なWebhook
- SMS: Twilio Messaging APIに接続可能なサービス層
- LINE: LINE Messaging APIに接続可能なWebhook

### 6.2 DBの注意

予約確定処理には排他制御が必要。

PostgreSQLが使える場合:

- 予約確定時はトランザクションを使う
- 同一セラピスト、同一部屋の時間重複を防ぐ
- ReservationHoldの期限切れを扱う

Cloudflare D1など制約があるDBの場合:

- READMEに制約を書く
- 競合防止の実装方針を書く
- 本番化前にPostgreSQL移行を推奨として明記する

### 6.3 マルチテナント設計

ARARE AIは複数店舗向けSaaSとして実装する。

MVPでは、すべての店舗スコープデータに `storeId` を必須で持たせる。

店舗スコープのテーブル:

- UserStoreRole
- Customer
- Therapist
- Shift
- Room
- Course
- CourseOption
- Reservation
- ReservationHold
- ReservationChangeHistory
- Conversation
- Message
- KnowledgeBase
- FAQ
- TalkScript
- Notification
- NotificationLog
- SalesRecord
- BlacklistEntry
- StoreSetting
- AuditLog
- Escalation
- AiSetting
- BlockedSlot
- ConsentLog
- CallLog
- PhoneRoutingSetting
- LineShiftParseJob

必須方針:

- `storeId` なしで店舗データを読み書きしない
- APIでは認証ユーザーが対象店舗に所属しているか必ず確認する
- Platform Admin以外は所属店舗以外のデータを取得できない
- Therapistは自分に紐づく予約と限定顧客情報だけ取得できる
- `storeId + phoneNumber` など、店舗単位のユニーク制約を使う
- `AuditLog` に `actorUserId`、`storeId`、`action`、`targetType`、`targetId` を保存する

PostgreSQLを使う場合は、将来的にRow Level Securityを有効化できる設計にする。

ただし、MVPではアプリケーション層での `storeId` 必須化を最優先とし、RLSはP1以降でもよい。

### 6.4 100店舗運用の非機能要件

100店舗導入を想定し、以下の非機能要件を満たす設計にする。

#### 6.4.1 店舗識別

すべてのリクエスト、Webhook、ジョブ、ログは、可能な限り `storeId` に紐づける。

電話Webhookでは、MVPでは `aiIngressPhoneNumber` から店舗を判定する。

LINE Webhookでは、`lineChannelId` または店舗ごとのLINE設定から店舗を判定する。

SMS callbackでは、`providerMessageId`、`toNumber`、`notificationId` から店舗を判定する。

#### 6.4.2 ジョブ化

以下は同期処理に閉じず、ジョブキュー化できる設計にする。

- 通知送信
- 通知再送
- 前日リマインド
- CallLog要約
- LINEシフト解析
- ReservationHold期限切れ処理
- スタッフ承認SLA再通知
- 外部連携ヘルスチェック

MVPではDBベースの簡易ジョブでもよい。

#### 6.4.3 監視

Platform Admin画面に以下を出す。

- 店舗別AI受付ステータス
- 店舗別電話転送ステータス
- 店舗別LINE連携ステータス
- 店舗別SMS送信失敗数
- 店舗別未承認ReservationHold数
- 店舗別未対応Escalation数
- 店舗別CallLog件数
- 店舗別通知失敗
- 外部Webhook最終受信時刻

#### 6.4.4 インデックス

100店舗で遅くならないよう、少なくとも以下を考慮する。

- すべての店舗スコープテーブルに `storeId` index
- 予約検索用に `storeId + startAt`
- 顧客検索用に `storeId + phoneNumber`
- 通知重複防止用に `storeId + dedupeKey`
- 電話店舗判定用に `aiIngressPhoneNumber`
- LINEユーザー判定用に `storeId + lineUserId`
- ReservationHold期限切れ用に `storeId + status + expiresAt`

#### 6.4.5 導入管理

100店舗を個別導入するため、店舗ごとに導入ステータスを管理する。

導入ステータス:

- draft
- onboarding
- waiting_external_setup
- test_ready
- live
- suspended
- churned

店舗ごとに以下を確認できること。

- 初回設定チェックリスト
- 電話転送テスト
- LINE webhookテスト
- SMS callbackテスト
- AI応答テスト
- 本番稼働可否
- 未完了タスク

---

## 7. 必須データモデル

最低限必要なモデル:

- Store
- User
- Customer
- Therapist
- Shift
- Room
- Course
- CourseOption
- Reservation
- ReservationHold
- ReservationChangeHistory
- Conversation
- Message
- KnowledgeBase
- FAQ
- TalkScript
- Notification
- NotificationLog
- SalesRecord
- BlacklistEntry
- StoreSetting
- Role / Permission
- AuditLog
- Escalation
- AiSetting
- BlockedSlot
- ConsentLog
- CallLog

100店舗導入を前提に追加するモデル:

- StoreGroup: 複数店舗を束ねる運営会社、ブランド、グループ
- StoreOnboardingStatus: 店舗ごとの導入進捗
- PhoneRoutingSetting: 公開番号、AI受付番号、転送状態、店舗判定
- ExternalIntegrationStatus: Twilio、LINE、SMS、OpenAI等の連携状態
- BackgroundJob: 通知、期限切れ、解析、要約などの非同期処理
- SystemHealthEvent: 店舗別、連携別の障害・警告イベント

特にMVPで重要なモデル:

- ReservationHold: AIが一時的に押さえる仮予約枠
- AuditLog: 予約作成、変更、キャンセル、承認、設定変更の履歴
- NotificationLog: 通知の送信履歴と重複防止
- Escalation: AIが人間確認に回した問い合わせ
- AiSetting: AIの口調、禁止回答、確認ルール、自動確定設定
- BlockedSlot: 店舗、部屋、セラピスト単位の予約不可枠
- ConsentLog: 復唱確認、注意事項確認、顧客同意の記録
- CallLog: 通話履歴、録音URL、文字起こし、AI要約、聞き取り信頼度

### 7.1 ER図レベルの主要リレーション

Gensparkは以下の関係を前提にDBを設計する。

- Store 1 - N UserStoreRole
- User 1 - N UserStoreRole
- Store 1 - N Customer
- Store 1 - N Therapist
- Store 1 - N Room
- Store 1 - N Course
- Course 1 - N CourseOption
- Store 1 - N Shift
- Therapist 1 - N Shift
- Store 1 - N Reservation
- Reservation N - 1 Customer
- Reservation N - 1 Course
- Reservation N - 0..1 Therapist
- Reservation N - 0..1 Room
- Reservation 1 - N ReservationChangeHistory
- Store 1 - N ReservationHold
- ReservationHold 0..1 - 1 Reservation
- Store 1 - N Conversation
- Conversation 1 - N Message
- Conversation 0..1 - 1 Customer
- Conversation 0..1 - 1 ReservationHold
- Store 1 - N KnowledgeBase
- Store 1 - N FAQ
- Store 1 - N TalkScript
- Store 1 - N BlacklistEntry
- Store 1 - N Notification
- Notification 1 - N NotificationLog
- Store 1 - N AuditLog
- Store 1 - N Escalation
- Store 1 - N BlockedSlot
- Store 1 - N CallLog
- CallLog 0..1 - 1 Conversation
- CallLog 0..1 - 1 ReservationHold
- Store 1 - N LineShiftParseJob

### 7.2 ReservationHold詳細仕様

`ReservationHold` は、AIまたはスタッフが一時的に押さえた仮予約枠である。

目的:

- AIが情報収集中に枠を二重提案しない
- 顧客に復唱確認する間、枠を一時保持する
- 店舗スタッフ承認までの短時間だけ枠を保護する
- 承認前にCONFIRMED予約を作らない

必須フィールド:

- id
- storeId
- customerId
- conversationId
- requestedStartAt
- requestedEndAt
- courseId
- therapistId
- roomId
- source: phone / line / web_chat / admin
- status: ACTIVE / PENDING_APPROVAL / APPROVED / REJECTED / EXPIRED / CANCELLED
- expiresAt
- approvalDeadlineAt
- approvedAt
- approvedByUserId
- rejectedAt
- rejectedByUserId
- rejectionReason
- customerConsentStatus: pending / confirmed / denied
- consentLogId
- confidenceScore
- extractedPayload
- createdAt
- updatedAt

有効期限:

- 初期状態の `ACTIVE` は作成から10分で期限切れにする
- 顧客が復唱内容に同意したら `PENDING_APPROVAL` にする
- `PENDING_APPROVAL` の承認期限はデフォルト15分
- 店舗ごとに5分から30分の範囲で変更可能
- `expiresAt` を過ぎたholdは予約判定から除外する
- 期限切れ時は `EXPIRED` にする

競合防止:

- ACTIVEまたはPENDING_APPROVALのholdは、予約可能枠の計算で埋まり扱いにする
- APPROVEDになるとReservationをCONFIRMEDで作成する
- REJECTED / EXPIRED / CANCELLEDは空き枠として扱う
- 承認時には、必ず最新のReservation、ReservationHold、BlockedSlot、Shift、Room状態を再確認する

### 7.3 NGルールのデータ構造

NGルールは単なる自由テキストではなく、AI判定、表示、エスカレーションに使える構造化データとして保存する。

必須モデル:

- NgRule
- NgRuleMatch

`NgRule` 必須フィールド:

- id
- storeId
- name
- category: blacklist / phrase / behavior / request / course / therapist / phone / safety / custom
- severity: low / medium / high / critical
- action: answer_with_template / escalate / reject_hold / require_staff_approval / block_reservation
- matchType: exact / contains / regex / semantic / manual
- patterns
- normalizedPatterns
- responseTemplate
- escalationReason
- appliesToChannels: phone / line / web_chat / admin
- enabled
- createdAt
- updatedAt

`NgRuleMatch` 必須フィールド:

- id
- storeId
- ngRuleId
- conversationId
- messageId
- customerId
- reservationHoldId
- matchedText
- confidenceScore
- actionTaken
- createdAt

MVPでの方針:

- 自動ブロックはcriticalのみ
- highはスタッフ承認必須
- medium以下はエスカレーションまたは注意表示
- semantic判定はモックまたはTODOでよい
- 値引き要求、個人LINE要求、クレーム、ルール外問い合わせは必ずエスカレーションする

---

## 8. 必須画面

### 8.1 PC管理画面

PCは司令塔として作る。

必須画面:

- ダッシュボード
- 店舗オンボーディング
- 初回設定チェックリスト
- 予約カレンダー
- 予約一覧
- 予約作成、編集、キャンセル
- 仮予約承認キュー
- 顧客管理
- セラピスト管理
- シフト管理
- 部屋管理
- コース、料金、オプション管理
- ナレッジ管理
- FAQ管理
- トークスクリプト管理
- NG回答管理
- AI受付ログ
- 通話ログ
- LINE / Webチャットログ
- 通知履歴
- NotificationLog
- AuditLog
- 売上サマリー
- 店舗設定
- 権限管理
- 外部連携設定
- 本番提出チェックリスト

PCダッシュボードに表示するもの:

- 本日の予約
- 部屋別予約カレンダー
- 未対応キュー
- AI受付ログ
- 通知失敗
- 空き部屋
- 出勤セラピスト
- 売上サマリー
- クイックアクション
- 外部連携ステータス

### 8.2 スマホ運用画面

スマホは現場作業アプリとして作る。

390x844を基準にする。

スマホホームに必ず表示するもの:

- 店舗名
- 営業状態
- 通知
- 今すぐ対応キュー
- 本日の予約サマリー
- 空き部屋
- 出勤セラピスト
- 通知失敗数
- 最新AIメッセージ
- クイックアクション
- 下部ナビ

スマホで避けること:

- 小さすぎる文字
- 表形式を詰め込むこと
- 長すぎるホームスクロール
- 下部ナビに入力欄が隠れること
- 装飾過多

---

## 9. UI方針

ARARE AIは営業用LPではなく、運用業務アプリである。

UIの方向性:

- 静かで高密度
- 現場が迷わない
- 重要アラートがすぐ見える
- テーブル、カレンダー、ログを重視
- カード角丸は8px程度
- カードの入れ子は禁止
- 装飾のためだけのグラデーションや球体背景は禁止
- メインアクセントはティール
- 状態色は緑、オレンジ、赤を使う
- ダークネイビーはサイドバーやヘッダーに限定する
- 業務画面の本文は読みやすいサイズにする

参考UI:

- Square Dashboard
- Shopify Admin
- Google Calendar
- LINE公式アカウント管理画面
- Square POS
- Uber Eats店舗アプリ

既存サービスをコピーしてはいけない。操作性の参考として使う。

---

## 10. 主要フロー

### 10.1 店舗オンボーディング

店舗導入時に以下を登録する。

- 店舗名
- 住所
- 電話番号
- 営業時間
- 部屋数
- 予約受付ルール
- キャンセルルール
- 注意事項
- NG対応ルール
- コース一覧
- 料金表
- オプション
- セラピスト一覧
- セラピストプロフィール
- 得意施術
- 指名料金
- 対応可能コース
- 部屋情報
- LINE設定
- 電話AI設定
- SMS設定
- AI回答用ナレッジ

初回設定が未完了の場合:

- AI受付開始ボタンを無効化する
- 不足項目を画面に表示する
- Platform Adminにも不足状態を表示する

### 10.2 ナレッジ管理

以下を管理できること。

- ナレッジ
- FAQ
- トークスクリプト
- NG回答
- 店舗独自ルール
- コース説明
- 料金説明
- セラピスト説明
- 注意事項

必要操作:

- 追加
- 編集
- 無効化
- 検索
- カテゴリ絞り込み
- 並び順管理

AIは登録済みナレッジ以外を回答してはいけない。

### 10.3 予約確定

予約ステータス:

- TENTATIVE
- CONFIRMED
- VISITED
- CANCELLED
- NO_SHOW

予約確定時に必ず確認すること:

- セラピストが対応可能
- セラピストが出勤予定
- 部屋が空いている
- BlockedSlotに該当しない
- 顧客がブラックリストではない
- ReservationHoldが期限内
- 顧客が内容に同意済み
- 店舗スタッフが承認済み
- AuditLogを作成できる
- NotificationLogを作成できる

### 10.4 AI受付

AI受付の目的:

- 予約問い合わせの一次受付
- 必要情報の抽出
- 登録済み情報に基づく案内
- 仮予約作成
- 店舗確認へのエスカレーション
- 会話ログ保存

AIが勝手にしてはいけないこと:

- 予約確定
- 値引き
- 登録されていないコース案内
- 個人LINEや私的連絡先の案内
- クレームの自動解決
- 予約ルール外の特殊対応

### 10.5 スタッフ承認SLA

AIが仮予約を作成し、顧客が内容に同意した後は、店舗スタッフの承認待ちにする。

MVPのデフォルトSLA:

- 0分: 店舗スタッフへ即時通知
- 5分: 未承認なら再通知
- 10分: 未承認ならOwner / Managerへ強めの再通知
- 15分: 未承認ならReservationHoldをEXPIREDにする

期限切れ時の動作:

- 予約はCONFIRMEDにしない
- ReservationHoldをEXPIREDにする
- 顧客には「現在店舗確認中です。確定次第ご連絡します」と案内する
- 期限切れ後に承認しようとした場合は、空き状況を再確認してから新しいholdを作る
- 期限切れはAuditLogに残す

店舗設定で変更可能な値:

- approvalReminderMinutes: デフォルト5
- approvalEscalationMinutes: デフォルト10
- holdApprovalTimeoutMinutes: デフォルト15
- timeoutCustomerMessage

自動キャンセルという表現は顧客向けに使わない。顧客には「まだ確定していない」と伝える。

### 10.6 LINEシフト解析

セラピストがLINEに送った出勤表をAIが解析し、Shift候補を作る。

MVPでは、自由テキストを完全に許容しない。

まずは以下のテンプレート入力を推奨する。

```text
出勤
6/15 12:00-20:00
6/16 休み
6/17 18:00-23:00
```

許容する形式:

- `6/15 12:00-20:00`
- `6月15日 12時-20時`
- `明日 18:00-23:00`
- `6/16 休み`
- `6/17 未定`
- 複数行入力

解析結果は即時反映しない。

必ず `LineShiftParseJob` として保存し、確認画面でスタッフまたはセラピストが承認してからShiftへ反映する。

`LineShiftParseJob` 必須フィールド:

- id
- storeId
- therapistId
- lineUserId
- rawText
- parsedShifts
- parseStatus: parsed / needs_confirmation / failed / approved / rejected
- confidenceScore
- errorReason
- approvedByUserId
- approvedAt
- createdAt

フォールバック:

- confidenceScoreが0.85未満なら自動反映しない
- 日付が曖昧なら確認メッセージを返す
- 時刻が曖昧なら確認メッセージを返す
- 店舗営業時間外なら確認待ちにする
- セラピスト本人が特定できない場合は未対応キューへ送る
- 解析不能なら「形式を確認してください」と返し、入力例を表示する

P1以降で自由テキスト対応を広げる。

---

## 11. 外部連携仕様

### 11.0.0 電話AI基盤のProvider抽象化

ARARE AIの電話AI基盤は、Twilio固定ではなく、Provider差し替え可能な設計にする。

ただし、MVPの第一候補はTwilioとする。

基本方針:

- 電話番号、既存番号からの転送、着信、通話制御はTwilioを第一候補にする
- MVPの音声方式はTwilio Conversation Relayを第一候補にする
- 音声品質検証ではOpenAI Realtime SIPまたはTwilio Media Streams + OpenAI Realtimeを比較できるようにする
- 高速デモや音声品質比較ではVapi / Retell AIを比較できるようにする
- 代替電話基盤としてTelnyx / Plivoも将来候補に入れる
- 予約DB、顧客DB、店舗設定、ReservationHold、承認SLA、監査ログ、NGルール、ナレッジ管理はARARE AI側に持つ
- 電話AIプロバイダに予約確定ロジックを閉じ込めない

Provider種別:

```ts
type VoiceProvider =
  | "mock"
  | "twilio_conversation_relay"
  | "twilio_media_streams_openai_realtime"
  | "openai_realtime_sip"
  | "vapi"
  | "retell"
  | "telnyx"
  | "plivo";
```

MVPで実装必須:

- mock
- twilio_conversation_relay

MVPでは設定項目だけ用意し、実装はTODOでよいもの:

- twilio_media_streams_openai_realtime
- openai_realtime_sip
- vapi
- retell
- telnyx
- plivo

`VoiceProviderAdapter` の責務:

- 着信開始イベントを受ける
- 店舗を特定する
- CallLogを作る
- Conversationを作る
- 音声/テキスト入力をMessageへ保存する
- AI応答を生成する
- 予約候補を抽出する
- ReservationHoldを作る
- Escalationを作る
- 通話終了イベントを保存する
- エラーをSystemHealthEventへ送る

店舗ごとの音声AI設定として `VoiceAiSetting` または `AiSetting` に以下を持たせる。

- storeId
- voiceProvider
- voiceProviderStatus
- voiceStyle
- voiceId
- sttProvider
- ttsProvider
- llmProvider
- fallbackProvider
- maxLatencyMs
- interruptionEnabled
- fillerEnabled
- humanHandoffEnabled
- emergencyFallbackPhoneNumber
- providerConfigJson

管理画面では以下を表示する。

- 店舗ごとのVoice Provider設定
- Providerステータス
- Mock / Twilio / OpenAI / Vapi / Retell等の選択欄
- 実装済み / TODO / 未検証の表示
- 最終テスト日時
- 最終テスト結果
- 通話件数
- 失敗件数
- 平均応答時間
- 平均会話時間
- エスカレーション率

禁止:

- 電話AIプロバイダ内に予約確定ロジックを閉じ込めない
- Vapi/Retell等に顧客DBや予約DBの主導権を渡さない
- Providerを変えると予約フローが壊れる設計にしない
- 実通話確認していないProviderを「本番確認済み」と表示しない
- MVPで全Providerを完全実装しようとしない

### 11.0 店舗電話番号の導入方針

ARARE AIの標準導入方針は、店舗の公開電話番号を変えないことである。

顧客が見ている店舗番号、ポータル掲載番号、名刺、SNS、Googleビジネスプロフィール等の電話番号は、可能な限り変更しない。

電話AIへの接続方式は、店舗ごとに以下から選べるようにする。

#### A. 転送導入モード（MVP標準）

店舗が現在契約している電話会社、固定電話、IP電話、PBX、スマホ転送設定などで、既存の店舗番号への着信をARARE AI用のTwilio番号へ転送する。

この方式では、顧客に見える店舗番号は変わらない。

100店舗導入では、原則として店舗ごとに異なる `aiIngressPhoneNumber` を割り当てる。

理由:

- 1つのAI受付番号を複数店舗で共有すると、転送着信時にどの店舗宛か判定できない場合がある
- 電話会社やPBXによっては転送元番号、元の着信先番号、SIPヘッダーが保持されない
- 店舗ごとのCallLog、営業時間、ナレッジ、NGルールを安全に分離する必要がある

例外:

- SIP/BYOCで店舗識別ヘッダーを確実に受け取れる場合
- 既存PBXが店舗IDを付与してルーティングできる場合
- IVRで店舗番号を入力させる方式を採用する場合

ただしMVPでは、IVR入力での店舗選択は標準にしない。

ARARE AI側では、店舗ごとに以下を保存する。

- publicPhoneNumber: 顧客に公開している既存店舗番号
- aiIngressPhoneNumber: AI受付用のTwilio番号
- forwardingMode: always / businessHoursOnly / afterHoursOnly / noAnswer / manual
- forwardingStatus: not_configured / pending_test / active / failed
- lastForwardingTestAt
- lastForwardingTestResult
- callerIdPreserved: true / false / unknown

必要な画面:

- 店舗電話番号設定
- 転送先Twilio番号の表示
- 電話会社別の転送設定メモ欄
- テスト着信ボタン
- 最後のテスト結果
- 発信者番号が保持されたかどうかの表示
- 転送解除時の注意事項

注意:

- 転送設定は店舗側の電話会社、PBX、スマホ側で行う必要がある。
- 転送時に発信者番号が保持されるかは電話会社やPBX設定に依存する。
- 転送料金が店舗側に発生する可能性がある。
- 店舗からの折り返し発信で既存番号を表示できるとは限らない。
- MVPでは、この転送導入モードを最優先で実装する。

#### B. 番号ポートインモード（本格導入オプション）

既存の店舗番号をTwilioへ番号移管する方式。

この方式でも、顧客に見える電話番号は変わらない。ただし、番号の収容先キャリアがTwilioに変わる。

メリット:

- Twilio側で着信を直接制御できる
- AI受付、営業時間分岐、人間転送、録音、通話ログを設計しやすい
- 長期運用では転送より構成がシンプルになる

注意:

- 移管手続き、LOA、本人確認、規制書類が必要になる場合がある
- 移管には数週間かかる可能性がある
- 日本番号ではSMS利用可否に制約があるため、LINEまたは別SMS番号を併用する
- 移管中の一時的な運用リスクをREADMEに明記する

#### C. BYOC / SIP連携モード（上級・多店舗向け）

店舗または既存キャリアがSIPでTwilioへ通話を送れる場合、既存キャリアと番号を維持したままTwilio Programmable Voiceへ接続する。

この方式は、SIP対応PBX、SBC、IP電話基盤を持つ店舗または代理店向けとする。

MVPではUI上の選択肢として設計してよいが、完全実装はP1以降でよい。

#### D. 新規Twilio番号モード（デモ・暫定）

新しいTwilio番号を店舗の受付番号として使う方式。

これは最短で動かせるが、店舗の既存番号を変える必要があるため、ARARE AIの標準導入方式にはしない。

用途:

- デモ
- テスト店舗
- 新規オープン店舗
- 既存番号にこだわりがない店舗

### 11.0.1 推奨実装順

1. MVPでは転送導入モードを作る
2. 店舗ごとにAI受付用Twilio番号を発行または登録する
3. 店舗画面に転送設定手順とテスト着信を用意する
4. テスト着信で発信者番号、店舗判定、CallLog保存を確認する
5. 安定運用できる店舗には番号ポートインを提案できるようにする
6. 多店舗や電話基盤を持つ事業者にはBYOC/SIP連携を提案できるようにする

### 11.0.2 Gensparkへの実装指示

Gensparkは、店舗電話番号を変更させる前提で実装してはいけない。

DBとUIでは、公開番号とAI受付番号を分けること。

- 公開番号: 顧客に見える番号
- AI受付番号: TwilioまたはSIPでARARE AIに入る番号

CallLogには以下を保存する。

- publicPhoneNumber
- aiIngressPhoneNumber
- fromNumber
- toNumber
- routingMode
- callerIdPreserved
- storeId
- callSid
- callStatus
- startedAt
- endedAt

店舗判定は、MVPではaiIngressPhoneNumberを優先して行う。

将来的には、SIPヘッダー、転送元情報、BYOC設定による店舗判定にも対応できる設計にする。

100店舗導入前提では、以下も必須とする。

- PhoneRoutingSettingを店舗ごとに持つ
- aiIngressPhoneNumberはユニークにする
- Platform Adminが100店舗分の番号割当、転送状態、テスト結果を一覧できる
- 店舗ごとに通話量、未対応数、エラー数を確認できる
- 1店舗の設定ミスが他店舗へ影響しないようにする

### 11.1 Twilio電話AI

MVPでは、実通話本番確認までは行わなくてよい。

ただし、以下を実装する。

- Twilio Voice webhook受信用エンドポイント
- 非通知拒否ロジック
- CallLog保存
- 通話文字起こし保存欄
- AI要約保存欄
- 聞き取り信頼度保存欄
- 予約候補抽出
- ReservationHold作成
- 店舗確認通知への接続口

非通知、anonymous、private、blocked、unknownは予約受付不可。

案内文:

```text
番号通知のうえ、おかけ直しください。
```

電話で必ず復唱する項目:

- 日時
- コース
- 顧客名
- 電話番号

### 11.2 LINE AI

MVPでは、LINE本番Webhook未設定でもモック確認できるようにする。

必要なもの:

- LINE webhook受信用エンドポイント
- 署名検証の実装またはTODO
- LINE user id保存欄
- 会話ログ
- 予約候補抽出
- ReservationHold作成
- 店舗確認待ちキュー
- 確定通知送信のサービス層

### 11.3 SMS

必要なもの:

- Twilio Messaging送信用サービス層
- SMS status callback受信用エンドポイント
- NotificationLog反映
- dedupe keyによる重複防止

### 11.4 OpenAI

MVPでは、本番APIキーなしでも動くモックAIを用意する。

必要なもの:

- `AI_PROVIDER=mock|openai`
- 登録済みナレッジだけを参照するサービス層
- 未登録情報には「確認が必要です」と返す
- 予約候補抽出
- エスカレーション判定
- OpenAI APIキーがない場合は安全にmockへフォールバック

### 11.5 イケボ音声の実現方式

ARARE AIの電話体験は、男性の自然で落ち着いた接客音声を目指す。

本番方針:

- MVPではTwilio Conversation Relayを第一候補にする
- 高品質検証ではOpenAI Realtime SIPまたはTwilio Media Streams + OpenAI Realtimeを比較する
- 高速デモ比較ではVapi / Retell AIも候補にする
- TTSは日本語対応の高品質男性音声を選ぶ
- ElevenLabs等の外部TTSはP1以降で検証する
- 相槌、短い確認、復唱を会話設計に入れる
- 低遅延のため、回答文は短く区切って返す

MVPモック方針:

- 本番キーなしでは実音声合成を必須にしない
- 電話AIモック画面では、会話をチャット形式で表示する
- AI発話には `voiceStyle: male_calm / male_bright / male_luxury` を保存する
- 発話テキスト、想定音声、相槌、復唱ポイントを画面に表示する
- 可能であればブラウザのSpeechSynthesisで男性風の音声再生を試す
- ブラウザ音声が使えない場合はテキスト表示でよい
- 事前録音音声を必須にしない

保存する設定:

- voiceProvider: mock / twilio_conversation_relay / twilio_media_streams_openai_realtime / openai_realtime_sip / vapi / retell / telnyx / plivo
- voiceId
- voiceStyle
- speakingRate
- pitch
- interruptionEnabled
- fillerEnabled
- maxResponseLatencyMs

モックで検証すること:

- 会話の自然さ
- 復唱確認のタイミング
- 予約候補抽出
- エスカレーション判定
- 通話ログ保存

モックで検証しないこと:

- 実際の音質
- 実通話の遅延
- 割り込み音声の精度
- 実TTSプロバイダの品質

---

## 12. 環境変数

`.env.example` に最低限以下を入れる。

```env
DATABASE_URL=
AUTH_SECRET=
APP_BASE_URL=

AI_PROVIDER=mock
OPENAI_API_KEY=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_WEBHOOK_SECRET=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=

SMS_PROVIDER=mock
NOTIFICATION_FROM_PHONE=
```

本番キーをリポジトリに書いてはいけない。

---

## 13. 権限

必須ロール:

- Platform Admin
- Owner
- Manager
- Staff
- Therapist

権限ルール:

- Platform Admin: 全店舗の導入状態、外部連携、提出判定を確認できる
- Owner: 店舗設定、ユーザー、予約、通知、電話AI、権限を管理できる
- Manager: 日常運用、予約、通知、必要に応じて電話AI設定を管理できる
- Staff: 予約、顧客、通知、会話履歴を確認できる
- Therapist: 自分の担当予約と限定された顧客情報のみ確認できる

Therapistが全顧客情報を見られないようにする。

---

## 14. 通知

必須通知:

- 予約確定通知
- 予約変更通知
- キャンセル通知
- 前日リマインド
- セラピストへの予約通知
- 通知失敗アラート
- 店舗確認待ち通知

通知チャネル:

- 内部通知
- LINE
- SMS

NotificationLogには以下を保存する。

- storeId
- reservationId
- notificationType
- channel
- status
- destination
- provider
- providerMessageId
- dedupeKey
- errorCode
- errorMessage
- payload
- sentAt

NotificationLogで通知重複を防ぐ。

---

## 15. 売上管理

MVPでは詳細分析よりも、正しく集計できることを優先する。

必須指標:

- 日次売上
- 月次売上
- セラピスト別売上
- コース別売上
- 指名率
- リピート率
- 稼働率

売上対象:

- CONFIRMED
- VISITED

売上除外:

- CANCELLED
- NO_SHOW

集計ルールは画面上に表示する。

---

## 16. 必須エラー対策

### 16.1 ダブルブッキング

同じセラピストまたは同じ部屋に重複予約を作らない。

### 16.2 シフト外予約

出勤していないセラピストへの予約を拒否する。

### 16.3 部屋不足

空き部屋がなければ予約不可にする。

### 16.4 AIの勝手な予約確定

仮予約、復唱、同意、店舗承認なしに確定しない。

### 16.5 幻覚回答

AIは登録済み情報だけで回答する。

### 16.6 存在しないコース案内

Courseに存在しないコースを案内しない。

### 16.7 勝手な値引き

AIは値引き交渉や割引提案をしない。

### 16.8 通知失敗

失敗理由をNotificationLogへ保存する。

### 16.9 通知重複

dedupeKeyで重複送信を防ぐ。

### 16.10 タイムゾーン

表示はJST固定。DB保存時の扱いもREADMEに明記する。

### 16.11 顧客重複

電話番号を店舗単位でユニークにする。

### 16.12 変更履歴

予約変更前後の内容をReservationChangeHistoryに保存する。

### 16.13 キャンセル済み売上計上

キャンセル、無断キャンセルは売上に入れない。

### 16.14 電話AIの聞き間違い

日時、コース、名前、電話番号を必ず復唱する。

### 16.15 権限漏れ

Therapistが全顧客情報を見られないようにする。

### 16.16 初回設定不足

必須設定が不足している店舗ではAI受付を開始できない。

### 16.17 非通知電話

非通知、anonymous、private、blocked、unknownからの予約作成、変更、キャンセルを拒否する。

---

## 17. MVP優先度

### P0: 初回Genspark生成で必須

- 店舗オンボーディング
- 初回設定チェックリスト
- 予約管理
- 仮予約と店舗承認
- 顧客管理
- セラピスト管理
- シフト管理
- 部屋管理
- コース、料金管理
- ダブルブッキング防止
- シフト外予約防止
- 部屋不足防止
- ナレッジ管理
- FAQ管理
- トークスクリプト管理
- NG回答管理
- AI受付モック
- LINE受付モック
- 電話受付モック
- Webチャット受付モック
- CallLog
- Conversation / Message
- NotificationLog
- AuditLog
- Escalation
- 非通知拒否
- PC管理画面
- スマホ運用画面
- README
- `.env.example`
- 提出判定レポート

### P1: P0安定後

- 実Twilio通話
- 実LINE Messaging API
- 実SMS送信
- OpenAI本番接続
- AI応答プレビュー / テストモード
- 当日リマインド
- 来店後お礼
- 売上ダッシュボード強化
- セラピスト別売上詳細
- 指名率
- リピート率

### P2: 後回し

- Instagram DM連携
- X DM連携
- SNS自動投稿
- 広告自動運用
- NG客AI自動判定
- 顧客同一人物の完全自動判定
- AI売上改善提案

---

## 18. 開発順序

Gensparkには以下の順序で作らせる。

1. データモデルとDB migration
2. シードデータ
3. 認証とロール
4. 店舗オンボーディング
5. 初回設定チェックリスト
6. コース、料金、部屋、セラピスト、シフト管理
7. 顧客管理
8. 予約CRUD
9. ダブルブッキング、シフト外、部屋不足の防止
10. ReservationHold
11. 店舗承認フロー
12. AuditLog
13. NotificationLog
14. ナレッジ、FAQ、トークスクリプト、NG回答管理
15. AI受付モック
16. LINE / 電話 / Webチャットの受付モック
17. Twilio / LINE / SMS / OpenAI用サービス層とWebhook
18. CallLog
19. Escalation
20. PCダッシュボード
21. スマホ運用画面
22. 売上集計
23. 本番提出チェックリスト
24. READMEと`.env.example`
25. 実装済み/未実装/未検証レポート

---

## 19. 受け入れテスト

Gensparkの出力に対して、最低限以下を確認する。

### 19.1 予約

- 同じセラピストに同時間帯の予約を作れない
- 同じ部屋に同時間帯の予約を作れない
- シフト外のセラピストに予約を作れない
- 部屋が足りない場合は予約不可になる
- ReservationHoldから承認後にCONFIRMEDになる
- 承認前はCONFIRMEDにならない
- 予約変更履歴が残る

### 19.2 AI受付

- 登録済みFAQには回答できる
- 未登録情報には「確認が必要です」と返す
- 値引き要求はエスカレーションする
- 個人LINE要求はエスカレーションする
- クレームはエスカレーションする
- 予約候補を抽出して仮予約にできる

### 19.3 通知

- 予約確定時にNotificationLogが作られる
- 同じdedupeKeyで重複送信されない
- 送信失敗時にerrorCodeとerrorMessageが保存される

### 19.4 権限

- Therapistは自分の予約だけ見られる
- Staffは店舗内予約を見られる
- Ownerは店舗設定を変更できる
- Platform Adminは導入状態を見られる

### 19.5 外部連携

- Twilio webhookがダミーイベントを受けられる
- LINE webhookがダミーイベントを受けられる
- SMS status callbackがダミーイベントを受けられる
- 実本番確認していない場合は未検証として表示される

---

## 20. 提出物

Gensparkに必ず出させるもの:

- ソースコード
- DB schema
- migration
- seed
- README
- `.env.example`
- PCスクリーンショット
- スマホスクリーンショット
- 実装済み一覧
- 未実装一覧
- 未検証一覧
- 外部サービス設定手順
- 動作確認手順
- 本番提出チェックリスト
- 技術的な制約
- 次にやるべきこと

---

## 21. Gensparkへの報告ルール

完了報告では必ず以下を分ける。

- 実装済み
- 動作確認済み
- 未実装
- 未検証
- モック実装
- 外部サービス側でユーザー設定が必要なもの
- 技術的な制約
- 次の推奨作業

禁止:

- 実Twilio通話をしていないのに確認済みと言う
- 実LINE webhookを受けていないのに確認済みと言う
- 実SMS callbackを受けていないのに確認済みと言う
- OpenAI APIキーなしでAI本番接続済みと言う
- DB制約が弱いのに本番安全と言い切る

---

## 22. 最終判断

このPRDは、Gensparkで最初に作るには十分な情報量がある。

ただし、全機能を一度に作らせるのではなく、P0を先に完成させる。

ARARE AIで本当に価値が出るのは、見た目のLPではなく以下である。

- 予約事故を起こさない
- 店舗情報以外でAIが勝手に答えない
- 電話、LINE、Webチャットの問い合わせを一元管理できる
- 現場スタッフがスマホで迷わず処理できる
- 外部連携の本番確認状況を正直に管理できる

Gensparkには、この順番と安全条件を守らせること。
