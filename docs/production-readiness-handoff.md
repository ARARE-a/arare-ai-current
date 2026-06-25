# Production Readiness Handoff

Last updated: 2026-06-11 JST

この文書は、AI予約受付MVPを理想状態へ近づけるための残タスク手順です。
報告時は必ず「確認済み」「未確認」「推測」「実装上の判断」「要ユーザー対応」を分けます。

## 確認済み

- Railway voice-relay 本番は稼働中。
- 最新確認済みデプロイ: `02d7c36a-ea42-419a-af2a-848d8f2afaea`
- Vercel production デプロイ: `dpl_8ifPUNVHc3GbHUhCxdamsaDjnqPR`
- `https://arare-ai-three.vercel.app/api/health` は `status: ok`
- 未ログイン時のprotected APIは、HTMLではなくJSON 401を返すことを確認済み
- `https://voice-relay-production-dd5f.up.railway.app/health` は `ok: true`
- Supabase project `arare-ai-auto` / ref `pfktqgmkamtrkcuwrebl` は `ACTIVE_HEALTHY`
- Supabase region は `ap-northeast-1`
- 電話AIのCSVガードは `freeTalkRecoveryRows: 350`、`freeTalkRecoverySkippedCorruptRows: 0`
- 本番WebSocketで日本語プロンプトを送信し、DB到達エラー時にスタッフ折り返し案内へ退避することを確認済み
- ローカル `npm run build` は成功
- ローカル `npx tsc --noEmit` は成功

## こちらで実装済み

- DB参照エラー時に電話AIプロセスが落ちず、折り返し案内へ退避する処理を追加
- 出勤確認DBエラー時に「本日出勤なし」と誤案内しない保守的ガードを追加
- 自由会話リカバリCSVを350行の正常UTF-8データへ復旧
- Clerk未設定ローカル環境で middleware が起動時に落ちないよう修正
- protected API は未ログイン時にHTMLリダイレクトではなくJSON 401を返すよう修正
- middleware改善をVercel productionへ反映済み

## 未確認

- 実電話でのTwilio着信
- 実CallSid付きの通話ログ保存
- 予約DB作成
- SMS実送信とTwilio delivery callback
- 顧客LINE、セラピストLINE、LINE webhookの本番反映
- PC/スマホ実機UI確認
- 店舗HP読み取り証跡の本番反映

## 要ユーザー対応 1: Supabase DB接続をRailway/Vercelから到達可能にする

### 背景

現在のRailway `DATABASE_URL` は次の形です。

```text
postgresql://...@db.pfktqgmkamtrkcuwrebl.supabase.co:5432/...
```

本番WebSocket検証では、このDBホストへRailwayから到達できず、Prismaが `Can't reach database server` を返しています。

Supabase公式docsでは、Direct connection はIPv6、またはIPv4 add-onがある場合のIPv4です。
IPv4のみの環境から接続する場合は、Session Pooler、またはIPv4 add-onを使います。

### 推奨対応

MVP最短復旧は、Supabaseの **Session Pooler** を使う方法です。
Prismaのprepared statement問題を避けるため、まずはTransaction PoolerではなくSession Poolerを推奨します。

### Supabaseで取得するもの

1. Supabase Dashboardを開く
2. 対象project `pfktqgmkamtrkcuwrebl` を開く
3. `Project Settings` -> `Database` -> `Connection string`
4. `Session pooler` を選ぶ
5. 次の形のURLをコピーする

```text
postgres://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

`<DB_PASSWORD>` はSupabase DB passwordに置き換えます。
このプロジェクトのrefは `pfktqgmkamtrkcuwrebl`、regionは `ap-northeast-1` です。

### Railwayへ反映

PowerShellで、実URLを貼って実行します。

```powershell
$env:RAILWAY_TOKEN="<Railway token>"
$dbUrl="<Supabase Session Pooler URL>"
npx @railway/cli variable set "DATABASE_URL=$dbUrl" --service voice-relay --environment production --skip-deploys --json
npx @railway/cli deployment redeploy --service voice-relay --environment production --yes --json
```

反映後、こちらで確認するコマンド:

```powershell
Invoke-RestMethod https://voice-relay-production-dd5f.up.railway.app/health
```

### Vercelへ反映

Vercel Dashboardで実施します。

1. Vercel Dashboardを開く
2. project `arare-ai-three` を開く
3. `Settings` -> `Environment Variables`
4. `DATABASE_URL` を同じSession Pooler URLに更新
5. `Production` に反映されるよう保存
6. production redeployを実行

確認URL:

```text
https://arare-ai-three.vercel.app/api/health
```

## 要ユーザー対応 2: Twilio Voice/SMS設定

Twilio Consoleで対象電話番号を開きます。

Voice webhook:

```text
https://arare-ai-three.vercel.app/api/twilio/voice
```

Method:

```text
POST
```

SMS status callback:

```text
https://arare-ai-three.vercel.app/api/twilio/sms/status
```

Method:

```text
POST
```

Vercelの `VOICE_RELAY_WS_URL` は次の形にします。

```text
wss://voice-relay-production-dd5f.up.railway.app/conversation-relay?token=<VOICE_RELAY_SHARED_SECRET>
```

`<VOICE_RELAY_SHARED_SECRET>` はRailwayの `VOICE_RELAY_SHARED_SECRET` と同じ値です。
チャットには貼らないでください。

## 要ユーザー対応 3: LINE本番確認

LINE DevelopersでWebhook URLを設定します。

```text
https://arare-ai-three.vercel.app/api/line/webhook
```

必要な確認:

- LINE Developers側でWebhookが有効
- `LINE_CHANNEL_SECRET` がVercelに設定済み
- `LINE_CHANNEL_ACCESS_TOKEN` がVercelに設定済み
- 顧客LINEからテスト送信
- セラピストLINEから出勤/退室テスト送信
- 管理画面にLINE履歴が残ること

## DB復旧後にこちらで実行する確認

1. Railway health確認
2. 本番WebSocketで予約導線の短縮テスト
3. 本番電話の実CallSid確認
4. 通話ログ、予約、通知、SMS callbackのDB照合
5. `/platform` の提出判定確認
6. PC/スマホUI確認
7. 失敗項目の追加修正

## 実電話テスト台本

1回目は、予約確定まで行うテストです。

```text
今日21時で空いてますか？
90分でお願いします。
フリーでお願いします。
佐藤です。
08012345678です。
はい。
```

確認する証跡:

- Twilio Call SID
- Railwayログに同じCall SIDがある
- DBのcall logに同じCall SIDがある
- 予約またはReservationHoldが作成されている
- SMS notificationが作成されている
- SMSがTwilioでaccepted/sent/deliveredのいずれかになっている
- 管理画面の今日/未来予約、通知、通話ログに反映されている

## 完成までの現実的な残時間

外部設定がすぐできる場合:

- DB接続差し替えと再デプロイ: 1-3時間
- 実電話から予約作成までの通し確認: 2-4時間
- SMS送信/callback確認: 1.5-3時間
- LINE webhook確認: 2-4時間
- PC/スマホUI最終確認: 2-4時間

合計: 8.5-18時間

実電話200件、SMS成功率99%以上、DB証跡、QA承認まで含める場合:

```text
40-80時間以上
```

## 提出判定

次がすべて確認済みになるまでは提出不可です。

- Railway本番確認
- Twilio本番確認
- 実電話Call SID提出
- DB証跡提出
- SMS成功/失敗callback確認
- LINE実Webhook確認
- PC/スマホUI確認
- 予約確定後エラー0件
