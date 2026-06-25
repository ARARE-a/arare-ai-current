# 本番提出ブロック確認 2026-06-15

作成日: 2026-06-15 JST  
担当: 担当6 本番QA/提出判定  
判定: 提出不可  
本番URL: https://arare-ai-three.vercel.app

## 確認済み

- 本番DB migration自体は適用済み。
  - `schemaReadableForCheckedModels: true`
  - `prdCoreModelsReadable: true`
  - `queryErrors: []`
- 本番DB全体件数は存在する。
  - `NotificationLog`: 4
  - `KnowledgeBase`: 2
  - `FAQ`: 1
  - `TalkScript`: 1
  - `ReservationChangeHistory`: 10
- 対象店舗 `demo-store-arare-ai / Queen of the Night` の件数。
  - 条件: `storeId = demo-store-arare-ai`
  - KnowledgeBase: total 2 / `isActive = true` 0
  - FAQ: total 1 / `isActive = true` 0
  - TalkScript: total 1 / `isActive = true` 0
  - `deletedAt` は `KnowledgeBase` / `Faq` / `TalkScript` schema上には存在しない。
- 未来シフトは0件。
  - `shiftsFromNow: 0`
  - `futureActiveReservationsSampled: 0`
- 本番ナレッジ系APIは404。
  - `GET https://arare-ai-three.vercel.app/api/knowledge`: 404
  - `GET https://arare-ai-three.vercel.app/api/faq`: 404
  - `GET https://arare-ai-three.vercel.app/api/talk-scripts`: 404
- ローカルコード上ではrouteファイルは存在する。
  - `src/app/api/knowledge/route.ts`
  - `src/app/api/faq/route.ts`
  - `src/app/api/talk-scripts/route.ts`
- ローカル `.env` の `TWILIO_AUTH_TOKEN` は2行存在する。
  - 1件目: length 32 / REST Auth Token形式に見える
  - 2件目: prefix `THAA` / length 232 / 現行コードのREST Auth Token形式ではない
- `.env.production.local` / `.env.vercel.local` の `TWILIO_AUTH_TOKEN` はローカルファイル上では空。
- `.env` / `.env.production.local` / `.env.vercel.local` の `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` はローカルファイル上では空。

## 実装済み

- 本番DB読み取り確認スクリプトは、migration後の主要テーブル確認に対応済み。
- 本番提出ブロックのみをまとめる2026-06-15版QAメモを追加した。

## 未確認

| ブロック | 状態 | 提出判定 |
| --- | --- | --- |
| Clerk権限別ログイン | 認証情報なし。未確認 | 提出不可 |
| LINE実Webhook | LINE env未設定。実イベント未確認 | 提出不可 |
| 電話AI実通話 | 実Call SID未回収 | 提出不可 |
| 実SMS callback | 実Message SID callback未確認。ユーザー許可まで実SMS送信しない | 提出不可 |
| 予約1周 | 未来シフト0件、実E2E未確認 | 提出不可 |
| 本番認証後UI | 未確認 | 提出不可 |
| 新一時URL | 未発行/未確認。過去URLは流用しない | 提出不可 |
| 担当3 HTTP経由確認 | activeデータ0、本番API 404のため未完 | 提出不可 |
| 担当4 Twilio Auth Token原因 | 本番env実値は未確認。ローカル重複のみ確認 | 提出不可 |

## 推測

- 本番 `/api/knowledge` / `/api/faq` / `/api/talk-scripts` が404で、ローカルrouteファイルは存在するため、実装未配置ではなく「本番デプロイ未反映」または「本番ビルド/ルーティング反映差分」の可能性が高い。
- 対象店舗の active ナレッジ件数が0のため、仮にAPIが200になっても Web Chat / LINE / 電話AI の有効ナレッジ参照は現状では通らない可能性が高い。
- `THAA...` は現行のTwilio REST SMS送信処理ではAuth Tokenとして弾かれる可能性が高い。Twilioのどの種別の値かを本番env側で整理する必要がある。
- 未来シフト0件のため、予約1周検証にはテスト用シフト投入案の承認が必要になる可能性が高い。

## 実装上の判断

- 本番設定、DBスキーマ、予約/通知/AI本体は変更していない。
- DB投入が必要になり得る項目は、勝手に投入せず未確認/要ユーザー対応として残した。
- 実SMS送信、LINE実送信、電話AI実通話は実施していない。
- 本番確認していないものは本番確認済みにしていない。
- 未確認が1つでも残っているため、提出判定は提出不可。

## 要ユーザー対応

- 対象店舗 `demo-store-arare-ai` の KnowledgeBase / FAQ / TalkScript を `isActive = true` にするか、投入内容案を担当1/3から確認する。
- `/api/knowledge` / `/api/faq` / `/api/talk-scripts` の本番404について、最新デプロイ反映状況を確認する。
- Twilio本番envの `TWILIO_AUTH_TOKEN` をTwilio ConsoleのREST Auth Tokenに統一する。`THAA...` を使う設計なら、現行コード側の扱いを別途判断する。
- LINE本番envの `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` を設定する。
- 予約1周検証用の未来シフト、部屋、コース、セラピスト状態の投入内容案を承認する。
- Clerk権限別ログイン確認用の本番テストアカウントまたは検証用認証情報を提供する。
- 実SMS / LINE / 電話AI確認の実施許可と、Call SID / Message SID / Webhookイベント時刻を共有する。

## 変更ファイル

- `docs/qa/production-submission-blockers-2026-06-15.md`

## 他担当への影響

- 担当1: 全体件数と対象店舗active件数がズレている。`storeId = demo-store-arare-ai`、`isActive = true` 条件で再整理が必要。
- 担当2: 未来シフト0件のため、予約1周用の投入内容案が必要。
- 担当3: 本番ナレッジ系API 404と対象店舗active 0件がブロック。HTTP経由確認は未完。
- 担当4: Twilio Auth Token重複、LINE env空、実SMS未実施がブロック。
- 担当5: 新一時URL未発行。本番認証後UIは未確認。
- 担当6: 上記証跡が揃うまで提出不可を維持する。
