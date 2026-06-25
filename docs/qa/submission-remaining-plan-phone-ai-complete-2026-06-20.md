# 提出までの残タスク整理（電話AI完成扱い版） 2026-06-20

担当: Codex  
前提: 電話AIは完成扱い。ただし、この文書では電話AIの本番実通話証跡を再評価しない。  
対象: AI予約受付MVP / 店舗スマホUI / 予約・通知・LINE・本番反映

## 結論

現時点で「本番提出可能」とは判定しない。

電話AIを完成扱いにした場合、残りの主ブロッカーは以下。

1. 本番URLへの最新UI反映確認
2. 本番ログイン後のPC/スマホUI確認
3. 予約E2E確認
4. SMS送信とcallback反映確認
5. LINE実Webhookと履歴反映確認
6. 最終証跡まとめ

外部設定が整っている前提なら、残りは 1日から1.5日。  
SMS / LINE / Clerk / Vercel / Railway の設定確認で詰まる場合は 2日から3日。

## 確認済み

| 項目 | 状態 | 根拠 |
| --- | --- | --- |
| スマホ店舗ダッシュボード導線 | 確認済み | ユーザーがスマホで表示・遷移を確認 |
| 予約作成ボタン | 確認済み | ユーザーが表示・遷移確認済み |
| 本日の予約カード | 確認済み | ユーザーが遷移確認済み |
| AI受付・会話ログ | 確認済み | ユーザーが遷移確認済み |
| ルーム / 出勤カード | 確認済み | ユーザーが遷移確認済み |
| スマホ画面の空白改善 | 確認済み | ユーザーが「見やすくなりました」と確認 |
| TypeScriptチェック | 確認済み | `npx tsc --noEmit --pretty false` 成功 |
| 会話品質mock検証 | 確認済み | `pnpm run verify:final` 成功、1095/1095 passed |

## 未確認

| 項目 | 状態 | 提出への影響 | 目安 |
| --- | --- | --- | --- |
| 本番URLへの最新UI反映 | 一部確認 / 認証後未確認 | 本番URLとして提出するなら認証後UI確認が必須 | 30分から1時間 |
| 本番ログイン後UI | 未確認 | Clerk認証後のPC/スマホ確認が必要 | 1から2時間 |
| 予約E2E | 未確認 | 予約作成、空き判定、確定、キャンセル、画面反映の確認が必要 | 1.5から3時間 |
| SMS送信 | 未確認 | 送信済みだけでなくcallbackと通知ログ反映が必要 | 1から3時間 |
| LINE実Webhook | 未確認 | LINE Developersからの実イベント、DB、店舗画面反映が必要 | 2から4時間 |
| 最終証跡まとめ | 未確認 | 提出時の根拠として必要 | 1時間 |

## 電話AI完成扱いにした項目

| 項目 | 扱い | 注意 |
| --- | --- | --- |
| Twilio実通話 | 完成扱い | この文書では再検証対象外 |
| ConversationRelay | 完成扱い | setup / prompt / close の再検証は対象外 |
| CallSid証跡 | 完成扱い | 提出証跡に含める場合は別途保管済みであること |
| Railway Relayログ | 完成扱い | 再起動・本番URL反映確認は対象外 |

## 実装上の判断

- 店舗スマホUIは、デモ店舗が触る画面としてはかなり近い。
- 残りの多くはコード実装ではなく、本番URL、認証、外部サービス、実イベント証跡の確認。
- `verify:final` は mock adapter boundary の検証であり、本番確認ではない。
- `trycloudflare.com` の確認は本番確認済みに含めない。

## 推測

- Vercel本番デプロイが最新で、Clerk / SMS / LINE env が整っていれば、1日から1.5日で提出候補まで進められる可能性が高い。
- LINEまたはSMSの外部設定が未整備なら、半日から1日ずつ追加でかかる可能性がある。
- 本番ログイン権限や環境変数の確認権限がない場合、ユーザー対応待ちで停止する。

## 要ユーザー対応

| 対応 | 必要なもの |
| --- | --- |
| 本番URL確認 | `https://arare-ai-three.vercel.app` が最新デプロイか確認 |
| Clerkログイン確認 | 管理者/店舗ユーザーでログインできるアカウント |
| SMS実送信許可 | 実SMSを送ってよい電話番号と確認許可 |
| LINE実Webhook確認 | LINE Developers設定、テスト送信用LINEアカウント |
| 提出証跡保管 | スクショ、URL、MessageSid、DB反映結果 |

## 追加確認 2026-06-20 09:23 JST

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| `https://arare-ai-three.vercel.app/` | HTTP 200 | 本番URLは到達確認済み |
| `https://arare-ai-three.vercel.app/store-v2` | 未ログインでは `/sign-in` へ 307 redirect | 認証保護は動作。ログイン後画面は未確認 |
| `https://arare-ai-three.vercel.app/api/health` | `status: ok`、database/openai/line/twilio/clerk が `true` | env設定の存在は確認済み |

注意:

- `/api/health` は環境変数が設定されていることの確認であり、SMS到達、LINE実Webhook、予約E2Eの本番成功を意味しない。
- `/store-v2` の最新スマホUIが本番に反映されているかは、ログイン後に画面を見るまで未確認。

## 追加確認 2026-06-20 09:25 JST

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| `npm run verify:production -- https://arare-ai-three.vercel.app` | 成功 | 本番ヘルス、SMS callback endpoint、AI extract endpoint は到達確認済み |
| `/api/setup/checklist` | 401 `Authentication is required.` | 認証ガード確認済み。認証後payloadは未確認 |
| `/api/admin/state` | 401 `Authentication is required.` | 認証ガード確認済み。認証後payloadは未確認 |
| `/api/platform/stores` | 401 `Authentication is required.` | 認証ガード確認済み。認証後payloadは未確認 |
| `/api/twilio/sms/status` | 200 endpoint応答 | callback endpoint存在は確認済み。実MessageSid callback反映は未確認 |
| `/api/ai/extract` | 200、予約抽出JSON応答 | 本番AI抽出APIの疎通は確認済み |
| `/reservations` | HTTP 200 | ページ到達確認済み。ログイン後操作は未確認 |
| `/notification-logs` | HTTP 200 | ページ到達確認済み。ログイン後データ表示は未確認 |

## 追加対応 2026-06-20 09:32 JST

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| 本番スクショ確認 | ユーザー提供スクショでは `予約作成` ボタン、`タップして予約確認`、`タップして詳細確認` が見えない | 本番が古いUIだった可能性が高い |
| `.vercelignore` 修正 | `.env*`、`.codex-remote-attachments`、`reports`、`test-results`、`tmp-*` を除外 | デプロイ前の秘密情報・作業ファイル混入リスクを低減 |
| `npm run build` | 成功 | 本番ビルド可能 |
| `npx vercel --prod --yes` | 成功。`https://arare-ai-three.vercel.app` に alias 済み | 本番へ最新コードを反映 |
| デプロイ後 `npm run verify:production -- https://arare-ai-three.vercel.app` | 成功 | 外部から確認できる本番疎通は維持 |

残り:

- ログイン後の本番スマホ画面で、最新UIが反映されたことをユーザーが再確認する。
- ブラウザキャッシュが残る可能性があるため、更新または再ログイン後に確認する。

## ユーザー確認 2026-06-20

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| 本番スマホ `/store-v2` の `予約作成` ボタン | スクショで表示確認 | 本番反映確認済み |
| 本番スマホ下部ナビ `ダッシュ` | スクショで表示確認 | 本番反映確認済み |
| 本番スマホの高さ配分 | スクショ上、予約/AIログ/ルーム/出勤が表示 | 本番反映確認済み |
| `タップして予約確認` | 本番データが0件のため対象カードなし | 未確認 |
| `タップして詳細確認` | 本番AIログが0件のため対象カードなし | 未確認 |

次に必要な確認:

- 本番で予約データを1件作成し、予約カードの表示と遷移を確認する。
- 本番で会話ログまたは通知ログを1件作成し、AI受付ログの表示と遷移を確認する。

## 追加調査・修正 2026-06-20

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| 本番DB全体 | Store 1、Course 4、Room 9、Therapist 8、Shift 31、Reservation 61、Conversation 4370 | 初期化ではない |
| 予約作成画面のコース未選択 | 本番DBにコースは存在するため、DB空ではなく店舗コンテキスト/API取得の問題が濃厚 | 原因切り分け済み |
| 店舗アクセス解決 | Clerkセッションの `storeId` claim をDB存在確認なしで優先していた | stale / 別storeId claim で空表示になる可能性 |
| 修正 | `sessionStoreId` がDBに存在する場合だけ優先。存在しない場合はUserメール紐付け、単一店舗bootstrapへフォールバック | 実装済み |
| 検証 | `npm run build`、`npx tsc --noEmit --pretty false`、`pnpm run verify:final` 成功 | ローカル確認済み |
| 本番反映 | `npx vercel --prod --yes` 成功。`https://arare-ai-three.vercel.app` にalias済み | 本番反映済み |
| デプロイ後確認 | `verify:production` 成功、`verify-production-db-readiness` 成功 | 外部疎通とDB読み取り確認済み |

未確認:

- ユーザーのログイン済みブラウザで、予約作成画面のコース選択肢が復旧したか。

## 次にやる順番

1. 本番URLに最新UIが反映されているか確認する。
2. 本番ログイン後に `/store-v2`、`/reservations`、`/notification-logs`、`/therapist` をスマホとPCで確認する。
3. 予約E2Eを1周する。
4. SMS送信とcallback反映を確認する。
5. LINE実Webhookと履歴反映を確認する。
6. 最終提出証跡をまとめる。

## 現時点の判定

| 判定 | 理由 |
| --- | --- |
| デモ店舗に見せる準備 | かなり近い |
| 本番提出可能 | 未判定 / まだ言えない |
| 最大残リスク | 本番外部連携と認証後確認 |
