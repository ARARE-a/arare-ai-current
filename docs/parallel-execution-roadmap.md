# AI予約受付MVP 並行実装ロードマップ

この文書は、複数チャットで同時に進めるための担当分担と統合ルールです。

## 共通ルール

- AGENTS.md を最優先する。
- `確認済み`、`未確認`、`推測`、`実装上の判断`、`要ユーザー対応`を分けて報告する。
- 本番確認していないものを本番確認済み、提出可能と言わない。
- 仕様外の独自機能を増やさない。
- DBスキーマ変更は原則として担当1だけが行う。
- 同じファイルを複数担当で同時編集しない。
- 変更したファイル、影響範囲、未確認事項を必ず報告する。

## 担当1: 統合管理・DB/PRD中核

このチャットの担当。

### 目的

PRD必須モデルと中核データ構造を整え、他担当が実装できる土台を作る。

### 主な作業

- KnowledgeBase モデル追加
- FAQ モデル追加
- TalkScript モデル追加
- NotificationLog モデル追加
- ReservationChangeHistory モデル追加
- 必要なら Option / TherapistCourse 相当のモデル追加を検討
- Prisma migration / seed / README / .env.example 更新
- 他担当の作業を統合前提でレビュー

### 触ってよい範囲

- `prisma/schema.prisma`
- `prisma/migrations/**`
- `prisma/seed.ts`
- `src/app/api/knowledge/**`
- `src/app/api/faq/**`
- `src/app/api/talk-scripts/**`
- `src/app/api/notification-logs/**`
- `src/lib/prisma.ts`
- `README.md`
- `.env.example`
- `docs/**`

### 触らない範囲

- 電話AI本番Railway実装
- LINE/Twilio本番設定
- 大規模UI刷新

## 担当2: 予約エンジン

### 目的

予約作成・変更・キャンセルをPRDの安全条件に合わせる。

### 主な作業

- 予約変更時の空き再判定
- 変更前後の履歴保存
- ダブルブッキング防止強化
- シフト外予約防止の再確認
- 部屋不足時の予約不可
- 仮予約から同意後確定の強制

### 触ってよい範囲

- `src/lib/reservation-service.ts`
- `src/app/api/reservations/**`
- `src/app/api/holds/**`
- `src/app/api/blocked-slots/**`
- 予約関連テスト、検証スクリプト

### 触らない範囲

- Prismaモデル追加は担当1完了後に合わせる。
- LINE/Twilio送信処理本体は担当4に渡す。

## 担当3: AI受付

### 目的

LINE / Web Chat / 電話AIが登録済み情報だけを参照して受付する状態にする。

### 主な作業

- `orchestrateAiReservationReception` の登録済み情報参照を強化
- KnowledgeBase / FAQ / TalkScript / Course / Therapist / StoreSetting のみ回答ソースにする
- 未登録情報は「確認が必要です」に固定
- 値引き、存在しないコース、推測回答を禁止
- 予約変更/キャンセルはPRDに沿って安全に扱う

### 触ってよい範囲

- `src/lib/ai-reservation-orchestrator.ts`
- `src/lib/openai-service.ts`
- `src/lib/reservation-draft.ts`
- `src/app/api/ai/**`
- `src/app/api/line/webhook/route.ts`
- `src/app/api/twilio/voice/gather/route.ts`
- Web Chat側の最小接続修正

### 触らない範囲

- Twilio/Railway本番設定
- 通知送信の実装本体
- DBスキーマ追加

## 担当4: 通知/SMS/LINE

### 目的

通知の重複防止、失敗ログ、本番到達callback反映をPRDに近づける。

### 主な作業

- NotificationLog の利用実装
- 予約確定/変更/キャンセル/前日/当日/お礼/セラピスト通知
- Twilio SMS callback の反映確認
- LINE push失敗時のログ保存
- 通知重複送信防止

### 触ってよい範囲

- `src/lib/notification-service.ts`
- `src/lib/line-service.ts`
- `src/app/api/notifications/**`
- `src/app/api/reminders/**`
- `src/app/api/twilio/sms/status/**`

### 触らない範囲

- 予約判定本体
- DBスキーマ追加は担当1完了後に合わせる。

## 担当5: 管理画面/UI

### 目的

PRD必須画面とPC/スマホの操作性を整える。

### 主な作業

- KnowledgeBase管理画面
- FAQ管理画面
- TalkScript管理画面
- NG回答管理画面
- 予約作成/編集画面
- 通知履歴画面
- 売上一覧画面
- 既存10ページのバー、ヘッダー、カード、余白、ボタン統一の維持

### 触ってよい範囲

- `src/app/**/page.tsx`
- `src/components/**`
- `src/app/globals.css`
- UI用の軽微なAPI接続

### 触らない範囲

- 予約エンジン本体
- 通知送信本体
- DBスキーマ追加

## 担当6: 本番QA/提出判定

### 目的

本番確認済みと未確認を明確に分け、提出可否を判定する。

### 主な作業

- Clerk権限別ログイン実操作
- LINE本番Webhook実イベント
- Twilio実通話
- SMS実到達callback
- 予約確定からSMS送信、DB反映、店舗画面反映の1周
- ルーム空き、セラピスト出勤、予約判定の本番データ整合
- PC/スマホUI最終確認

### 触ってよい範囲

- `docs/qa/**`
- `scripts/verify-*.mjs`
- Playwright検証スクリプト
- 報告用スクリーンショット出力

### 触らない範囲

- 仕様変更
- DBスキーマ追加
- 予約/通知ロジック本体

## 統合順

1. 担当1がDBモデルとmigrationを入れる。
2. 担当2、3、4が新モデルに合わせてサービス層を修正する。
3. 担当5が新API/UIをつなぐ。
4. 担当6がローカル、本番を分けて検証する。
5. このチャットで統合レビュー、型チェック、提出判定を行う。

## 各担当の報告フォーマット

```
確認済み:
- ...

実装済み:
- ...

未確認:
- ...

推測:
- ...

実装上の判断:
- ...

要ユーザー対応:
- ...

変更ファイル:
- ...

他担当への影響:
- ...
```
