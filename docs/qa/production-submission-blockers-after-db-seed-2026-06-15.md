# DB投入後 本番提出ブロック確認 2026-06-15

作成日: 2026-06-15 JST  
担当: 担当6 本番QA/提出判定  
判定: 提出不可  
本番URL: https://arare-ai-three.vercel.app

## 確認済み

- `demo-store-arare-ai / Queen of the Night` に active ナレッジ系データが入っていることを、本番DB読み取りで確認。
  - KnowledgeBase active: 1
  - FAQ active: 1
  - TalkScript active: 1
- activeデータのサンプル。
  - KnowledgeBase: `予約受付の基本条件`
  - FAQ: `予約はいつ確定しますか？`
  - TalkScript: `仮予約復唱と同意確認`
- `清澄せいら` / `美咲` の未来シフトを本番DB読み取りで確認。
  - 清澄せいら: `2026-06-16T03:00:00.000Z` - `2026-06-16T14:00:00.000Z`
  - 美咲: `2026-06-16T03:00:00.000Z` - `2026-06-16T14:00:00.000Z`
  - いずれも `SCHEDULED`、セラピストstatusは `ACTIVE`
- `node scripts/verify-production-db-readiness.mjs` で次を確認。
  - `futureShiftDataPresent: true`
  - `schemaReadableForCheckedModels: true`
  - `prdCoreModelsReadable: true`
  - `queryErrors: []`
- 本番ナレッジ系APIは404ではなくなった。
  - `GET /api/knowledge`: 401
  - `GET /api/faq`: 401
  - `GET /api/talk-scripts`: 401
- 401は未ログイン状態での認証要求として扱う。認証後のpayload確認は未確認。

## 実装済み

- DB投入後の本番提出ブロック確認メモを追加した。
- DB投入、予約作成、SMS送信、LINE送信、電話発信はこの担当6作業では実施していない。

## 未確認

| ブロック | 状態 | 提出判定 |
| --- | --- | --- |
| Clerk権限別ログイン | 未確認。認証情報なし | 提出不可 |
| 認証後ナレッジAPI payload | 401まで確認。認証後200/内容は未確認 | 提出不可 |
| Web Chat HTTP確認 | 担当3結果未回収 | 提出不可 |
| LINE実Webhook | 未確認 | 提出不可 |
| 電話AI実通話 | 未確認 | 提出不可 |
| 実SMS callback | 未確認。実SMS送信は未実施 | 提出不可 |
| 予約1周 | 担当2結果未回収 | 提出不可 |
| 重複予約/シフト外/部屋不足/履歴保存 | 担当2結果未回収 | 提出不可 |
| 本番認証後PC/スマホUI | 未確認 | 提出不可 |

## 推測

- ナレッジ系APIが404から401に変わったため、本番デプロイまたはルーティング反映のブロックは解消した可能性が高い。
- ただし、認証後APIのpayloadとWeb Chat / LINE / 電話AIがactiveナレッジを実際に参照することは、まだ確認できていない。
- 未来シフトは入ったため、予約1周検証の前提データ不足は一部解消した可能性が高い。

## 実装上の判断

- 本番確認済みと言えるのは、DB読み取りと未ログインHTTPステータスまで。
- 認証後画面/API、外部連携、実予約E2Eは未確認のまま分離する。
- 未確認が残るため、提出不可を維持する。

## 要ユーザー対応

- Clerk権限別ログイン用の認証情報を提供する。
- 担当2の予約1周、重複予約、シフト外、部屋不足、履歴保存の実DB確認結果を共有する。
- 担当3の Web Chat / LINE / 電話AI のHTTP確認結果を共有する。
- 担当4の実SMS callback、LINE実Webhook、通知ログ確認結果を共有する。
- 担当5の本番認証後PC/スマホUI確認結果を共有する。

## 変更ファイル

- `docs/qa/production-submission-blockers-after-db-seed-2026-06-15.md`

## 他担当への影響

- 担当2: 未来シフト前提は確認済み。予約系E2E確認を開始可能。
- 担当3: activeナレッジ前提とAPIルート存在は確認済み。認証後/HTTP経由確認が必要。
- 担当4: 実SMS/LINEは未確認のまま。提出不可ブロック継続。
- 担当5: 本番認証後UIは未確認のまま。提出不可ブロック継続。
- 担当6: 外部連携と本番認証後UIの証跡が揃うまで提出不可を維持する。
