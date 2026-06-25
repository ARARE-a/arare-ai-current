# Gensparkへの追加論点回答

以下の方針で確定してください。

## 0. 導入規模

重要な前提として、ARARE AIは100店舗導入を想定してください。

単店向けアプリではなく、100店舗の店舗別データ分離、電話番号ルーティング、LINE設定、通知設定、AI設定、導入状態監視に耐えるマルチテナントSaaSとして設計してください。

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

100店舗前提で避けること:

- 1店舗前提の固定設定
- 店舗IDなしのデータ保存
- すべての店舗が同じ電話AI番号に転送される設計
- 店舗ごとの営業時間、ルール、NG条件を共通化してしまうこと
- 障害時にどの店舗で失敗したか追跡できないログ

電話AIについては、MVPでは原則として店舗ごとに異なる `aiIngressPhoneNumber` を割り当ててください。

理由は、1つのAI受付番号を複数店舗で共有すると、転送着信時にどの店舗宛か安全に判定できない場合があるためです。

Platform Adminが100店舗分の番号割当、転送状態、テスト結果、通話量、未対応数、エラー数を一覧できるようにしてください。

## 1. データモデルの詳細

ARARE AIは複数店舗向けSaaSとして実装します。

MVPでは、すべての店舗スコープデータに `storeId` を必須で持たせます。

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

APIでは必ず、認証ユーザーが対象店舗に所属しているか確認してください。

PostgreSQLを使える場合は、将来的にRow Level Securityへ移行できる設計にしてください。ただしMVPでは、まずアプリケーション層で `storeId` 必須化を徹底してください。

## 2. ReservationHoldの仕様

ReservationHoldは、AIまたはスタッフが一時的に押さえる仮予約枠です。

ステータス:

- ACTIVE
- PENDING_APPROVAL
- APPROVED
- REJECTED
- EXPIRED
- CANCELLED

期限:

- ACTIVEは作成から10分で期限切れ
- 顧客が復唱内容に同意したらPENDING_APPROVAL
- PENDING_APPROVALの承認期限はデフォルト15分
- 店舗設定で5分から30分の範囲で変更可能

予約枠の扱い:

- ACTIVE / PENDING_APPROVALは予約可能枠の計算で埋まり扱い
- EXPIRED / REJECTED / CANCELLEDは空き枠扱い
- APPROVEDになるとReservationをCONFIRMEDで作成
- 承認時には、最新のReservation、ReservationHold、BlockedSlot、Shift、Room状態を必ず再確認

## 3. NGルールのデータ構造

NGルールは自由テキストだけではなく、構造化データで持ちます。

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

NgRuleMatch:

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

MVP方針:

- criticalのみ自動ブロック
- highはスタッフ承認必須
- medium以下はエスカレーションまたは注意表示
- semantic判定はモックまたはTODOでよい
- 値引き要求、個人LINE要求、クレーム、ルール外問い合わせは必ずエスカレーション

## 4. イケボ音声の実現方式

本番では、男性の自然で落ち着いた接客音声を目指します。

本番候補:

- Twilio ConversationRelay
- 高品質TTS
- ElevenLabs等の外部TTSはP1以降で検証

MVPでは、本番キーなしでも検証できるようにモック実装にします。

MVPモック:

- 電話AIモック画面では会話をチャット形式で表示
- AI発話に `voiceStyle: male_calm / male_bright / male_luxury` を保存
- 発話テキスト、想定音声、相槌、復唱ポイントを画面に表示
- 可能ならブラウザSpeechSynthesisで音声再生
- ブラウザ音声が使えない場合はテキスト表示でよい
- 事前録音音声は必須にしない

保存する設定:

- voiceProvider: mock / browser / twilio / elevenlabs / openai
- voiceId
- voiceStyle
- speakingRate
- pitch
- interruptionEnabled
- fillerEnabled
- maxResponseLatencyMs

## 5. LINEシフト解析

MVPでは自由テキストを完全許容しません。

まずは以下のテンプレート入力を推奨します。

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

解析結果は即時反映しません。

必ず `LineShiftParseJob` として保存し、確認画面でスタッフまたはセラピストが承認してからShiftへ反映してください。

フォールバック:

- confidenceScoreが0.85未満なら自動反映しない
- 日付が曖昧なら確認メッセージを返す
- 時刻が曖昧なら確認メッセージを返す
- 店舗営業時間外なら確認待ち
- セラピスト本人が特定できない場合は未対応キューへ送る
- 解析不能なら入力例を表示する

## 6. スタッフ承認SLA

AIが仮予約を作成し、顧客が同意した後は、以下のSLAで店舗スタッフへ通知してください。

- 0分: 即時通知
- 5分: 未承認なら再通知
- 10分: Owner / Managerへ強めの再通知
- 15分: 未承認ならReservationHoldをEXPIREDにする

期限切れ時:

- 予約はCONFIRMEDにしない
- 顧客には「現在店舗確認中です。確定次第ご連絡します」と案内
- 期限切れ後に承認する場合は空き状況を再確認して新しいholdを作る
- 期限切れはAuditLogに残す
- 顧客向けに「自動キャンセル」という表現は使わない

店舗設定で変更可能な値:

- approvalReminderMinutes: デフォルト5
- approvalEscalationMinutes: デフォルト10
- holdApprovalTimeoutMinutes: デフォルト15
- timeoutCustomerMessage

この方針でMVP設計を進めてください。
