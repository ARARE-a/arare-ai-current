# 本番提出ブロック対応案 2026-06-15

作成日: 2026-06-15 JST  
判定: 提出不可  
対象本番URL: https://arare-ai-three.vercel.app  
一時URL: https://texture-arab-bomb-spam.trycloudflare.com

## 確認済み

- 本番 `/api/knowledge` `/api/faq` `/api/talk-scripts` は引き続き404。
- ローカルコード上は次のrouteファイルが存在する。
  - `src/app/api/knowledge/route.ts`
  - `src/app/api/faq/route.ts`
  - `src/app/api/talk-scripts/route.ts`
- 一時URL `https://texture-arab-bomb-spam.trycloudflare.com` は HTTP 200。ただし本番確認済みには含めない。
- 本番DB `demo-store-arare-ai / Queen of the Night` のナレッジ系件数。
  - KnowledgeBase: total 2 / active 0
  - FAQ: total 1 / active 0
  - TalkScript: total 1 / active 0
  - `deletedAt` は該当3モデルに存在しない。
- 対象店舗の未来シフトは0件。
- 対象店舗の予約1周に使える既存データ候補。
  - active room: `vinoプレジオ本町 101` / `202` / `303`
  - active course: `Legend Massage 90分コース`
  - active therapist: `美咲` / `清澄せいら`
- ローカル `.env` の `TWILIO_AUTH_TOKEN` は2行ある。
  - 1行目: 32文字でREST Auth Token形式に見える。
  - 2行目: `THAA...` で始まる232文字の値。現行REST Auth Token形式ではない。
- ローカル `.env` / `.env.production.local` / `.env.vercel.local` のLINE Channel Secret / Access Tokenは空。

## 実装済み

- この対応案文書を追加した。
- DB投入、本番env変更、実SMS/LINE/電話送信は実施していない。

## 未確認

- Vercel本番が最新コードで再デプロイ済みかどうか。
- 本番デプロイ後に `/api/knowledge` `/api/faq` `/api/talk-scripts` の404が解消するか。
- 本番envの実 `TWILIO_AUTH_TOKEN` がREST Auth Tokenへ統一済みか。
- Vercel/Railway本番envのLINE Channel Secret / Access Token設定状態。
- active化・未来シフト投入後の Web Chat / LINE / 電話AI / SMS / 予約1周。

## 推測

- 本番API 404は、ローカル実装が存在するため、最新コード未デプロイまたは本番ビルド反映差分の可能性が高い。
- ナレッジ系DBレコードは存在するがすべて `isActive=false` のため、AI受付が有効データとして参照できない可能性が高い。
- `THAA...` はTwilio ConsoleのREST Auth Tokenではない可能性が高く、現行コードのSMS送信では弾かれる可能性が高い。

## 実装上の判断

- 提出不可を維持する。
- 勝手にDB投入しない。
- 勝手に本番envを変更しない。
- 過去一時URLの結果は使わず、今回の一時URLも本番確認扱いにしない。

## 要ユーザー対応

### 1. Vercel本番再デプロイ後の確認

再デプロイ後に担当6で次を再実行する。

```powershell
foreach ($p in @('/api/knowledge','/api/faq','/api/talk-scripts')) {
  curl.exe -L -s -o NUL -w "%{http_code}" --max-time 30 "https://arare-ai-three.vercel.app$p"
}
```

合格条件:

- 404ではないこと。
- 未ログインなら401/403でもよい。routeが本番に存在することを確認する。
- 認証情報ありで200とDB payloadを確認する。

### 2. KnowledgeBase / FAQ / TalkScript active化投入案

既存レコードを使う最小案:

| model | id | 現在 | 投入案 |
| --- | --- | --- | --- |
| KnowledgeBase | `cmq9dglw70055n7d0wz7v2g3r` | `isActive=false` | `isActive=true` |
| KnowledgeBase | `cmq9deo6v0053n7d0ew43zlpy` | `isActive=false` | `isActive=true` |
| FAQ | `cmq9dgyrk0057n7d0egm3abd6` | `isActive=false` | `isActive=true` |
| TalkScript | `cmq9dhkpj0059n7d02l2vh6nb` | `isActive=false` | `isActive=true` |

注意:

- 内容がUI検証用文面なので、営業デモ用として適切かは担当1/3が確認する。
- 営業デモ用の正式文面が必要な場合は、上記をactive化せず、正式レコード投入案を別途作る。

### 3. 予約1周用の未来シフト投入案

店舗営業時間: `12:00` - `29:00`  
対象コース: `Legend Massage 90分コース`  
対象部屋: active room 3件あり  
投入日は、実施日から見て未来日で固定する。

案A: 2026-06-16 JST

| therapist | therapistId | status | shift JST | DB保存時刻の目安 |
| --- | --- | --- | --- | --- |
| 清澄せいら | `cmq6fxo7x000dn790t3sh6wqg` | ACTIVE | 2026-06-16 18:00-27:00 JST | `2026-06-16T09:00:00.000Z` - `2026-06-16T18:00:00.000Z` |
| 美咲 | `cmpyxcl1d000jn7bc1ii18bc0` | ACTIVE | 2026-06-16 18:00-27:00 JST | `2026-06-16T09:00:00.000Z` - `2026-06-16T18:00:00.000Z` |

案B: 2026-06-17 JST

| therapist | therapistId | status | shift JST | DB保存時刻の目安 |
| --- | --- | --- | --- | --- |
| 清澄せいら | `cmq6fxo7x000dn790t3sh6wqg` | ACTIVE | 2026-06-17 18:00-27:00 JST | `2026-06-17T09:00:00.000Z` - `2026-06-17T18:00:00.000Z` |
| 美咲 | `cmpyxcl1d000jn7bc1ii18bc0` | ACTIVE | 2026-06-17 18:00-27:00 JST | `2026-06-17T09:00:00.000Z` - `2026-06-17T18:00:00.000Z` |

推奨:

- 案B。確認作業が日跨ぎしても未来シフトとして残りやすい。

### 4. TWILIO_AUTH_TOKEN整理案

ローカル `.env`:

- `TWILIO_AUTH_TOKEN` は1つだけにする。
- 残す値はTwilio ConsoleのREST Auth Token形式の値。
- `THAA...` で始まる値は現行コードの `TWILIO_AUTH_TOKEN` には入れない。
- `THAA...` が別用途のトークンなら、別名envに分離し、現行コードで参照しない。

本番env:

- Vercel / Railway の `TWILIO_AUTH_TOKEN` をTwilio ConsoleのREST Auth Tokenへ統一する。
- 変更後に実SMS送信前のdry checkを行う。
- 実SMS送信はユーザー許可後のみ実施する。

### 5. LINE env設定確認案

本番envに以下が空でないことを確認する。

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

設定後に確認すること:

- LINE DevelopersのWebhook URLが `https://arare-ai-three.vercel.app/api/line/webhook`。
- Webhookが有効。
- 実LINE送信イベントがVercel logs / DB / 管理画面に残る。

### 6. API 404解消・active化・未来シフト投入後の再検証

順序:

1. Vercel本番再デプロイ。
2. ナレッジAPI 404解消確認。
3. activeナレッジ投入。
4. 未来シフト投入。
5. Clerk認証後UI確認。
6. Web Chat HTTP確認。
7. LINE実Webhook確認。
8. 電話AI実通話確認。
9. SMS callback確認。
10. 予約1周確認。

## 変更ファイル

- `docs/qa/submission-blocker-action-proposals-2026-06-15.md`

## 他担当への影響

- 担当1: active化する既存レコードの内容確認、または正式ナレッジ投入案が必要。
- 担当2: 未来シフト案A/Bのどちらを投入するか承認が必要。
- 担当3: API 404解消後、Web Chat / LINE / 電話AIのHTTP確認が必要。
- 担当4: Twilio token整理、LINE env設定、実SMSはユーザー許可後に確認が必要。
- 担当5: 新一時URLは暫定確認のみ。本番認証後UIは別途必要。
- 担当6: すべての本番証跡が揃うまで提出不可を維持する。
