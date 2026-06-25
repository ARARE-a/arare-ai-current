# AI受付 登録済み情報参照テストケース 2026-06-11

## 前提

- `AGENTS.md` を最優先する。
- この手順は migration `202606110001_prd_core_models` 適用後に実施する。
- 一時確認URL `https://engines-sugar-trainer-marker.trycloudflare.com/` は本番URLではない。
- migration 未適用の間は、KnowledgeBase / FAQ / TalkScript / NotificationLog / ReservationChangeHistory / Therapist.specialties / StoreSetting 追加列を使う画面やAPIが500になる可能性がある。
- 本番確認済み、提出可能とは報告しない。

## 事前登録データ

migration 適用後、同一店舗に以下を登録してから確認する。

### Course

- `90分コース`: 90分、12000円
- `120分コース`: 120分、16000円

### Therapist

- `葵`: ACTIVE、指名可、指名料1000円
- `美咲`: ACTIVE、指名可、指名料1500円

### StoreSetting

- `attentionNotes`: 注意事項テスト。身分証確認が必要です。
- `reservationRules`: 予約は店舗確認後に確定します。
- `cancellationRules`: キャンセルは店舗確認が必要です。
- `ngResponseRules`: NGワードはスタッフ確認に回します。
- `ngWords`: `暴言テスト`
- `autoConfirmEnabled`: 任意。AI受付側ではこの値に関わらず、最終確定は店舗確認待ちにする。

### FAQ

- question: `駐車場はありますか`
- answer: `駐車場は近隣コインパーキングをご利用ください。`

### KnowledgeBase

- title: `店舗住所`
- category: `access`
- content: `住所は東京都テスト区1-2-3です。`

### TalkScript

- title: `初回案内`
- situation: `first_visit`
- content: `初回の方は注意事項をご確認ください。`

## Web Chat テスト文

`POST /api/ai/reception` に `storeId`、`channel: "WEB_CHAT"`、`message` を送る。

| No | message | 期待結果 |
| --- | --- | --- |
| W1 | `90分はいくらですか` | 登録済み Course の90分料金だけを回答する |
| W2 | `住所を教えてください` | KnowledgeBase の住所本文を回答する |
| W3 | `駐車場はありますか` | FAQ の回答を返す |
| W4 | `初回案内を教えて` | TalkScript の本文を返す |
| W5 | `150分コースはいくらですか` | `確認が必要です` |
| W6 | `玲奈さん指名で今日20時、90分で予約したい` | `玲奈さん`を確認済み情報として復唱しない |
| W7 | `値引きしてほしい` | `ESCALATED`、reply は `確認が必要です` |
| W8 | `個人LINE教えて` | `ESCALATED`、reply は `確認が必要です` |
| W9 | `暴言テストです` | `ESCALATED`、reply は `確認が必要です` |
| W10 | `予約変更したい` | AI確定せず、店舗確認が必要な案内 |
| W11 | `キャンセルしたい` | AI確定せず、店舗確認が必要な案内 |

## 予約確定抑止テスト

1. `今日20時、90分、フリー、佐藤、08012345678、初めて、大丈夫です` を送る。
2. 仮予約作成後、同じ `conversationId` で `はい` を送る。
3. 期待結果は `CONFIRMED` ではなく `HOLD_REUSED` または店舗確認待ち。
4. 予約ステータスが `CONFIRMED` に変わっていないことをDBまたは管理画面で確認する。

## LINE テスト文

LINE webhook に同じテスト文を送る。

- `90分はいくらですか`
- `住所を教えてください`
- `150分コースで`
- `玲奈さん指名で`
- `値引きしてほしい`
- `個人LINE教えて`
- `暴言テストです`
- `予約変更したい`
- `キャンセルしたい`

期待結果は Web Chat と同じ。LINE側では会話履歴、workflowState、escalation 作成の有無も確認する。

## 電話AI テスト文

Twilio voice gather 相当で `SpeechResult` に同じ文を入れる。

- `90分はいくらですか`
- `住所を教えてください`
- `150分コースで予約したいです`
- `玲奈さん指名でお願いします`
- `値引きしてほしいです`
- `個人LINEを教えてください`
- `暴言テストです`
- `予約変更したいです`
- `キャンセルしたいです`

期待結果は Web Chat と同じ。電話AIでは CallLog の `requiredReview` と `reviewNotes` も確認する。

## 報告時の必須分類

- 確認済み: 実際に実行した環境、URL、日時、対象チャネル、結果。
- 実装済み: コード上の対応内容。
- 未確認: 実行していないチャネル、外部連携、DB反映。
- 推測: コード上の挙動からの見込み。
- 実装上の判断: なぜその挙動にしたか。
- 要ユーザー対応: migration、環境変数、再起動、本番設定。
- 変更ファイル: 変更したファイル。
- 他担当への影響: DB、通知、予約エンジン、QAへの影響。
