# Gensparkに最初に貼る全文プロンプト

ARARE AIという、メンズエステ店舗向けのAI受付・予約自動化SaaSを作ってください。

目的は、電話、LINE、Webチャットから来た予約問い合わせをAIが一次受付し、店舗ごとのコース、料金、セラピスト、シフト、部屋、注意事項、NG対応ルール、FAQ、トークスクリプトだけを参照して、仮予約を作成し、店舗スタッフが承認してから予約確定する業務アプリを作ることです。

導入規模は100店舗を想定してください。単店向けではなく、100店舗の店舗別データ分離、電話番号ルーティング、LINE設定、通知設定、AI設定、導入状態監視に耐えるマルチテナントSaaSとして設計してください。

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

店舗導入時は、原則として店舗の公開電話番号を変えない設計にしてください。顧客が見ている既存の店舗番号はそのまま使い、MVPでは既存番号からARARE AI用Twilio番号への着信転送で導入できるようにしてください。DBとUIでは、顧客に公開する番号 publicPhoneNumber と、AI受付に入る番号 aiIngressPhoneNumber を分けて管理してください。番号ポートインとBYOC/SIP連携は本格導入オプションとして設計し、初回MVPでは転送導入モードを標準にしてください。

100店舗導入では、原則として店舗ごとに異なる aiIngressPhoneNumber を割り当ててください。1つのAI受付番号を複数店舗で共有すると、転送着信時にどの店舗宛か判定できない場合があるためです。PhoneRoutingSettingを店舗ごとに持ち、Platform Adminが100店舗分の番号割当、転送状態、テスト結果、通話量、未対応数、エラー数を一覧できるようにしてください。

電話AI基盤はTwilio固定ではなく、VoiceProviderAdapterで差し替え可能にしてください。MVPではTwilio Conversation Relayを第一候補にし、mockも必ず実装してください。将来的に Twilio Media Streams + OpenAI Realtime、OpenAI Realtime SIP、Vapi、Retell AI、Telnyx、Plivo を比較・切り替えできる設計にしてください。ただし、予約DB、顧客DB、店舗設定、ReservationHold、承認SLA、監査ログ、NGルール、ナレッジ管理はARARE AI側に持たせ、電話AIプロバイダに予約確定ロジックを閉じ込めないでください。

Gensparkの標準フルスタック構成に合わせて実装してください。可能であれば TypeScript、Hono/Node.js、PostgreSQLまたはGensparkで利用可能なDB、Tailwind CSS、shadcn/ui相当のUI、Cloudflare Pages/Workers向け構成にしてください。DBがPostgreSQLでない場合は、予約確定時の排他制御の制約をREADMEに明記してください。

UIは業務アプリとして作ってください。LPではなく、ログイン後の管理画面を最初の画面にしてください。

PC画面はSquare Dashboard、Shopify Admin、Google Calendar、LINE公式アカウント管理画面のように、情報密度が高く、静かで、運用しやすい司令塔にしてください。

スマホ画面は現場スタッフがすぐ使える作業端末にしてください。390x844基準で、未対応キュー、本日の予約、通知失敗、空き部屋、出勤セラピスト、最新AIログ、クイックアクション、下部ナビを見やすく配置してください。

最後に、実装済み、未実装、未検証、外部サービス側でユーザー設定が必要な項目を分けて報告してください。

---

## 追加の詳細仕様

このプロダクトは、単なる予約フォームではなく、店舗ごとの情報をAIが参照して受付品質を担保する「ナレッジ管理付きのAI受付OS」です。

必須の対象チャネルは以下です。

- 電話AI受付
- LINE AI受付
- WebチャットAI受付
- PC管理画面
- スマホ運用画面

MVPでは、外部サービスの実接続よりも、安全な予約フローと管理画面を優先してください。

---

## 最重要原則

AIが回答に使ってよい情報は以下のみです。

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

未登録情報については、必ず以下のように回答してください。

「確認が必要です。店舗に確認して折り返します。」

AIは以下を勝手に行ってはいけません。

- 予約確定
- 値引き
- 登録されていないコース案内
- 個人LINEや私的連絡先の案内
- クレームの自動解決
- 予約ルール外の特殊対応

---

## 予約確定フロー

予約確定は必ず以下の順番にしてください。

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
14. AIが予約内容を復唱
15. 顧客が明確に同意
16. 店舗へ確認通知
17. 店舗スタッフが承認
18. 予約をCONFIRMEDにする
19. LINEまたはSMSで確定通知を送る

AIはReservationHoldを飛ばして、直接CONFIRMEDの予約を作ってはいけません。

---

## 必須データモデル

最低限、以下のモデルを作ってください。

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

特にMVPで重要なモデルは以下です。

- ReservationHold: AIが一時的に押さえる仮予約枠
- AuditLog: 予約作成、変更、キャンセル、承認、設定変更の履歴
- NotificationLog: 通知の送信履歴と重複防止
- Escalation: AIが人間確認に回した問い合わせ
- AiSetting: AIの口調、禁止回答、確認ルール、自動確定設定
- BlockedSlot: 店舗、部屋、セラピスト単位の予約不可枠
- ConsentLog: 復唱確認、注意事項確認、顧客同意の記録
- CallLog: 通話履歴、録音URL、文字起こし、AI要約、聞き取り信頼度

---

## 必須画面

PC管理画面には以下を作ってください。

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

スマホ運用画面には以下を作ってください。

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

---

## 外部連携

MVPでは、以下は実接続済みと主張せず、Webhookとサービス層、モック確認を優先してください。

### 店舗電話番号

標準導入では、店舗の公開電話番号を変更しないでください。

電話AIへの接続方式は以下の4つを想定してください。

1. 転送導入モード: MVP標準。既存店舗番号への着信を、店舗側の電話会社、PBX、スマホ転送設定などでARARE AI用Twilio番号へ転送する。
2. 番号ポートインモード: 本格導入オプション。既存店舗番号をTwilioへ移管し、顧客に見える番号は変えない。
3. BYOC / SIP連携モード: 上級・多店舗向け。既存キャリアと番号を維持したまま、SIPでTwilio Programmable Voiceへ接続する。
4. 新規Twilio番号モード: デモ・暫定用。既存番号にこだわりがない店舗だけで使う。

MVPで必ず作るもの:

- publicPhoneNumber: 顧客に公開している既存店舗番号
- aiIngressPhoneNumber: AI受付用のTwilio番号
- forwardingMode: always / businessHoursOnly / afterHoursOnly / noAnswer / manual
- forwardingStatus: not_configured / pending_test / active / failed
- lastForwardingTestAt
- lastForwardingTestResult
- callerIdPreserved: true / false / unknown

店舗電話番号設定画面には以下を表示してください。

- 公開番号
- AI受付番号
- 転送設定状態
- テスト着信結果
- 発信者番号が保持されたか
- 店舗側で転送設定が必要である旨
- 転送料金が店舗側に発生する可能性がある旨

CallLogには以下を保存してください。

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

店舗判定はMVPではaiIngressPhoneNumberを優先してください。

### Twilio

- Twilio Voice webhook受信用エンドポイント
- 非通知拒否ロジック
- CallLog保存
- 通話文字起こし保存欄
- AI要約保存欄
- 聞き取り信頼度保存欄
- 予約候補抽出
- ReservationHold作成
- 店舗確認通知への接続口

非通知、anonymous、private、blocked、unknownは予約受付不可にしてください。

非通知への案内文:

「番号通知のうえ、おかけ直しください。」

### LINE

- LINE webhook受信用エンドポイント
- 署名検証の実装またはTODO
- LINE user id保存欄
- 会話ログ
- 予約候補抽出
- ReservationHold作成
- 店舗確認待ちキュー
- 確定通知送信のサービス層

### SMS

- Twilio Messaging送信用サービス層
- SMS status callback受信用エンドポイント
- NotificationLog反映
- dedupe keyによる重複防止

### OpenAI

- AI_PROVIDER=mock|openai
- 登録済みナレッジだけを参照するサービス層
- 未登録情報には「確認が必要です」と返す
- 予約候補抽出
- エスカレーション判定
- OpenAI APIキーがない場合は安全にmockへフォールバック

---

## 必須エラー対策

以下を必ず実装してください。

- 同じセラピストまたは同じ部屋に重複予約を作らない
- 出勤していないセラピストへの予約を拒否する
- 空き部屋がなければ予約不可にする
- 仮予約、復唱、同意、店舗承認なしに予約確定しない
- AIは登録済み情報だけで回答する
- Courseに存在しないコースを案内しない
- AIは値引き交渉や割引提案をしない
- 通知失敗理由をNotificationLogへ保存する
- dedupeKeyで通知重複を防ぐ
- 表示はJST固定にする
- 電話番号を店舗単位でユニークにする
- 予約変更前後の内容をReservationChangeHistoryに保存する
- キャンセル、無断キャンセルは売上に入れない
- 電話AIでは日時、コース、名前、電話番号を必ず復唱する
- Therapistが全顧客情報を見られないようにする
- 必須設定が不足している店舗ではAI受付を開始できない
- 非通知、anonymous、private、blocked、unknownからの予約作成、変更、キャンセルを拒否する

---

## MVP優先度

### P0: 初回生成で必須

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
- .env.example
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

## 追加で確定する設計論点

### 100店舗導入前提

ARARE AIは100店舗導入を前提にしてください。

必須:

- 店舗ごとのデータ完全分離
- 店舗ごとのAI受付設定
- 店舗ごとの電話番号ルーティング
- 店舗ごとのLINE設定
- 店舗ごとのSMS/通知設定
- 店舗ごとのナレッジ、FAQ、NGルール
- 店舗ごとの承認SLA
- Platform Adminによる全店舗監視
- 店舗横断の導入状態ダッシュボード
- 外部連携の未設定、失敗、期限切れを一覧で見られること

避けること:

- 1店舗前提の固定設定
- 店舗IDなしのデータ保存
- すべての店舗が同じ電話AI番号に転送される設計
- 店舗ごとの営業時間、ルール、NG条件を共通化してしまうこと
- 障害時にどの店舗で失敗したか追跡できないログ

100店舗運用のため、以下はジョブ化できる設計にしてください。

- 通知送信
- 通知再送
- 前日リマインド
- CallLog要約
- LINEシフト解析
- ReservationHold期限切れ処理
- スタッフ承認SLA再通知
- 外部連携ヘルスチェック

最低限必要なインデックス:

- すべての店舗スコープテーブルに `storeId`
- 予約検索用に `storeId + startAt`
- 顧客検索用に `storeId + phoneNumber`
- 通知重複防止用に `storeId + dedupeKey`
- 電話店舗判定用に `aiIngressPhoneNumber`
- LINEユーザー判定用に `storeId + lineUserId`
- ReservationHold期限切れ用に `storeId + status + expiresAt`

### データモデルとマルチテナント

ARARE AIは複数店舗向けSaaSとして作ってください。

MVPでは、すべての店舗スコープデータに `storeId` を必須で持たせてください。

対象:

- Customer
- Therapist
- Shift
- Room
- Course
- Reservation
- ReservationHold
- Conversation
- Message
- KnowledgeBase
- FAQ
- TalkScript
- Notification
- NotificationLog
- BlacklistEntry
- NgRule
- AuditLog
- Escalation
- AiSetting
- BlockedSlot
- ConsentLog
- CallLog
- StoreGroup
- StoreOnboardingStatus
- PhoneRoutingSetting
- ExternalIntegrationStatus
- BackgroundJob
- SystemHealthEvent
- LineShiftParseJob

APIでは必ず認証ユーザーが対象店舗に所属しているか確認してください。

PostgreSQLを使える場合は、将来的にRow Level Securityへ移行できる設計にしてください。ただしMVPではアプリケーション層での `storeId` 必須化を最優先にしてください。

### ReservationHoldの有効期限

ReservationHoldは以下のステータスを持たせてください。

- ACTIVE
- PENDING_APPROVAL
- APPROVED
- REJECTED
- EXPIRED
- CANCELLED

有効期限:

- ACTIVEは作成から10分で期限切れ
- 顧客が復唱内容に同意したらPENDING_APPROVAL
- PENDING_APPROVALの承認期限はデフォルト15分
- 店舗設定で5分から30分の範囲で変更可能
- ACTIVEまたはPENDING_APPROVALのholdは予約可能枠の計算で埋まり扱い
- EXPIRED / REJECTED / CANCELLEDは空き枠扱い
- 承認時は必ず最新の予約、hold、BlockedSlot、Shift、Room状態を再確認

### スタッフ承認SLA

AIが仮予約を作成し、顧客が同意した後は、以下のSLAで店舗スタッフへ通知してください。

- 0分: 即時通知
- 5分: 未承認なら再通知
- 10分: Owner / Managerへ強めの再通知
- 15分: 未承認ならReservationHoldをEXPIREDにする

期限切れ時:

- 予約はCONFIRMEDにしない
- 顧客には「現在店舗確認中です。確定次第ご連絡します」と案内
- 期限切れ後に承認する場合は空き状況を再確認して新しいholdを作る
- 自動キャンセルという表現は顧客向けに使わない

### NGルールのデータ構造

NGルールは自由テキストだけではなく、構造化データにしてください。

NgRule:

- id
- storeId
- name
- category: blacklist / phrase / behavior / request / course / therapist / phone / safety / custom
- severity: low / medium / high / critical
- action: answer_with_template / escalate / reject_hold / require_staff_approval / block_reservation
- matchType: exact / contains / regex / semantic / manual
- patterns
- responseTemplate
- escalationReason
- appliesToChannels
- enabled

MVP方針:

- criticalのみ自動ブロック
- highはスタッフ承認必須
- medium以下はエスカレーションまたは注意表示
- semantic判定はモックまたはTODOでよい
- 値引き要求、個人LINE要求、クレーム、ルール外問い合わせは必ずエスカレーション

### イケボ音声の本番・モック

本番では男性の自然で落ち着いた接客音声を目指します。

MVPでは本番キーなしでも検証できるようにしてください。

電話AI基盤はTwilio固定ではなく、Provider差し替え可能な設計にしてください。

本番候補:

- Twilio Conversation Relay
- Twilio Media Streams + OpenAI Realtime
- OpenAI Realtime SIP
- Vapi
- Retell AI
- Telnyx
- Plivo
- 高品質TTS
- ElevenLabs等の外部TTSはP1以降で検証

VoiceProvider種別:

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

VoiceProviderAdapterの責務:

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

MVPモック:

- 電話AIモック画面では会話をチャット形式で表示
- AI発話に `voiceStyle: male_calm / male_bright / male_luxury` を保存
- 発話テキスト、想定音声、相槌、復唱ポイントを画面に表示
- 可能ならブラウザSpeechSynthesisで音声再生
- ブラウザ音声が使えない場合はテキスト表示でよい
- 事前録音音声は必須にしない

保存する設定:

- voiceProvider: mock / twilio_conversation_relay / twilio_media_streams_openai_realtime / openai_realtime_sip / vapi / retell / telnyx / plivo
- voiceId
- voiceStyle
- speakingRate
- pitch
- interruptionEnabled
- fillerEnabled
- maxResponseLatencyMs

### LINEシフト解析

MVPでは自由テキストを完全許容しないでください。

まずは以下のようなテンプレート入力を推奨してください。

```text
出勤
6/15 12:00-20:00
6/16 休み
6/17 18:00-23:00
```

許容形式:

- `6/15 12:00-20:00`
- `6月15日 12時-20時`
- `明日 18:00-23:00`
- `6/16 休み`
- `6/17 未定`
- 複数行入力

解析結果は即時反映せず、必ず `LineShiftParseJob` として保存してください。

確認画面でスタッフまたはセラピストが承認してからShiftへ反映してください。

フォールバック:

- confidenceScoreが0.85未満なら自動反映しない
- 日付が曖昧なら確認メッセージを返す
- 時刻が曖昧なら確認メッセージを返す
- 店舗営業時間外なら確認待ち
- セラピスト本人が特定できない場合は未対応キューへ送る
- 解析不能なら入力例を表示する

---

## 提出物

最後に以下を出してください。

- ソースコード
- DB schema
- migration
- seed
- README
- .env.example
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

## 報告ルール

完了報告では必ず以下を分けてください。

- 実装済み
- 動作確認済み
- 未実装
- 未検証
- モック実装
- 外部サービス側でユーザー設定が必要なもの
- 技術的な制約
- 次の推奨作業

禁止事項:

- 実Twilio通話をしていないのに確認済みと言う
- 実LINE webhookを受けていないのに確認済みと言う
- 実SMS callbackを受けていないのに確認済みと言う
- OpenAI APIキーなしでAI本番接続済みと言う
- DB制約が弱いのに本番安全と言い切る

ARARE AIで本当に価値が出るのは、見た目のLPではなく、予約事故を起こさないこと、店舗情報以外でAIが勝手に答えないこと、電話・LINE・Webチャットの問い合わせを一元管理できること、現場スタッフがスマホで迷わず処理できることです。
