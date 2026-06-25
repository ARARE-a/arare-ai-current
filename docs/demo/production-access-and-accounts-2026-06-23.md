# 本番URL・アカウント整理 2026-06-23

## 本番URL

- 本番アプリ: `https://arare-ai-three.vercel.app`
- 店舗ダッシュボード: `https://arare-ai-three.vercel.app/store-v2`
- 予約管理: `https://arare-ai-three.vercel.app/reservations`
- 電話AIログ: `https://arare-ai-three.vercel.app/phone-ai#call-logs`
- 通知ログ: `https://arare-ai-three.vercel.app/notification-logs`
- 提出前チェック: `https://arare-ai-three.vercel.app/platform`
- Voice Relay: `https://voice-relay-production-dd5f.up.railway.app`
- Voice Relay health: `https://voice-relay-production-dd5f.up.railway.app/health`

## アカウント区分

| 用途 | 使う人 | 扱い |
| --- | --- | --- |
| 管理者 | 運営者 | 本番設定、外部連携、障害確認用 |
| デモ店舗 | 店舗説明用 | 店舗画面、予約、通知、電話AIログ確認用 |
| セラピスト | セラピスト本人 | LINEで出勤、退室、予約通知を受ける |
| 顧客 | 予約客 | SMS通知を受ける。ログイン不要 |

## デモ用ログイン

- デモ店舗用メール: `mizuburo3130@gmail.com`
- パスワード: リポジトリやドキュメントには保存しない。

## 外部サービスの扱い

- Vercel: 本番アプリと環境変数。
- Railway: 電話AI Voice Relay。
- Supabase: 本番DB。
- Twilio: 電話AI番号、音声Webhook、SMS送信、SMS callback。
- LINE Developers: セラピストLINE通知、Webhook。
- Clerk: ログインと権限。

## 注意

- DB接続情報やAPIキーはチャットやドキュメントに残さない。
- DBパスワードを変更した場合は、VercelとRailwayの `DATABASE_URL` を両方更新する。
- DBパスワード変更後は、必ず以下を確認する。
  - `https://arare-ai-three.vercel.app/api/health`
  - `https://voice-relay-production-dd5f.up.railway.app/health`
  - 電話AIの実通話
  - 予約一覧の取得
  - 予約確定通知
