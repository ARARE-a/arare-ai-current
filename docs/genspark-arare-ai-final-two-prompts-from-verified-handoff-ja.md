# Genspark 残り2回用プロンプト: verified handoff後

前提:

- 土台は `arare-ai-p0-v2-verified-handoff.zip`
- こちらで `prisma validate` / `typecheck` / `build` / 主要ページHTTP確認は通過済み
- 次は「本実装に近づける」ための2回だけ使う
- 長文説明、追加設計、質問返しは禁止

---

## 1回目に貼る: 実DB・seed・承認フローE2E

```text
確認不要です。実行してください。
このターンの目的は「実DB migration / seed / ReservationHold承認フローE2E」です。

添付した `arare-ai-p0-v2-verified-handoff.zip` を土台にしてください。
もし添付ZIPに `docs/HANDOFF.md` / `docs/TODO_NEXT.md` / `apps/web/next.config.mjs` が無い場合は、まずそれらを補完してください。

禁止:
- P1着手
- 外部API実接続
- 本番Supabase/Twilio/LINE/Clerk/OpenAIキー使用
- SNS/広告/自動投稿
- 大幅UI改修
- 新しい仕様提案
- 長文説明
- 「実行してよいか」と聞き返すこと

実装すること:

1. 実DB開発環境を用意
- PostgreSQL前提
- 可能なら docker-compose.yml を追加
- DATABASE_URLの例を .env.example に明記
- 本番キーは不要

2. Prisma migration / seed を実行可能にする
- `prisma migrate dev` が実行できる状態にする
- `prisma/seed/seed.ts` を Prisma Client 実行形式にする
- demo store / courses / rooms / therapists / shifts / knowledge / ngRules / phoneRoutingSetting をseedする

3. ReservationHold承認フローE2Eを作る
- mockまたは軽量テストでよい
- 以下を確認できること:
  - ReservationHold作成
  - AIはCONFIRMEDを直接作れない
  - approve APIでのみ Reservation(CONFIRMED) が作成される
  - double booking が拒否される
  - shift外予約が拒否される
  - room不足が拒否される
  - AuditLogが残る
  - NotificationLog dedupe が storeId + dedupeKey で効く

4. APIの実DB接続を最低限確認
- GET /health
- POST /stores/:storeId/reservation-holds
- POST /stores/:storeId/reservation-holds/:id/approve
- GET /stores/:storeId/reservations
- POST /stores/:storeId/ai/mock-message

5. 検証
- pnpm install
- pnpm exec prisma validate --schema=prisma/schema.prisma
- pnpm exec prisma generate --schema=prisma/schema.prisma
- pnpm -r typecheck
- pnpm -r build
- 可能なら prisma migrate dev + seed + E2E

優先順位:
1. 既存buildを壊さない
2. Prisma migrate/seed
3. ReservationHold承認E2E
4. ZIP納品

時間が足りない場合:
- UIは触らない
- E2Eはmock DBではなく、できるだけPrisma + PostgreSQLで確認
- できない項目は未検証として明記

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / 次にやること

最後にZIP化してダウンロードURLを提示してください。
```

---

## 2回目に貼る: UI実データ接続・最終納品

```text
確認不要です。実行してください。
このターンが最終想定です。
目的は「PC/スマホUIの実データ接続 + 最終検証 + Manus引き継ぎ納品」です。

前回のDB/migration/seed/E2E対応済みZIPを土台にしてください。

禁止:
- P1着手
- 外部API実接続
- 本番Supabase/Twilio/LINE/Clerk/OpenAIキー使用
- SNS/広告/自動投稿
- 新仕様追加
- 長文説明
- 質問返し

実装すること:

1. PC管理画面を実API/seedデータに接続
- /admin/dashboard
- /admin/holds
- /admin/reservations
- /admin/knowledge
- /admin/ai-logs
- /admin/platform

必須:
- 仮予約キューにseed/DBのReservationHoldが表示される
- approve/reject操作がAPIへ流れる
- approve後にReservation(CONFIRMED)が見える
- AI独断確定不可の表示を維持
- Escalation / 通知失敗 / 100店舗監視のmockまたはseedデータが見える

2. スマホ運用画面を実API/seedデータに接続
- /mobile/home
- /mobile/urgent
- /mobile/holds
- /mobile/conversation

必須:
- 今すぐ対応が見える
- 仮予約の詳細が見える
- 承認/却下ができる
- 会話ログとAI抽出情報が見える
- 390x844基準で大きな崩れがない

3. 最終引き継ぎdocsを更新
- README.md
- docs/HANDOFF.md
- docs/STATUS_REPORT.md
- docs/TODO_NEXT.md

docsには以下を必ず反映:
- 実装済み
- 未実装
- 未検証
- 検証コマンド結果
- 起動手順
- 主要URL
- Manusに次にやらせる順番
- P0制約
- 本番外部API未接続であること

4. 最終検証
- pnpm install
- pnpm exec prisma validate --schema=prisma/schema.prisma
- pnpm -r typecheck
- pnpm -r build
- 可能ならローカル起動で主要ページHTTP 200確認
  - /admin/dashboard
  - /admin/holds
  - /admin/platform
  - /mobile/home
  - /mobile/holds
  - /mobile/urgent

優先順位:
1. build/typecheckを通す
2. 仮予約承認UIを実APIへ接続
3. PCダッシュボード
4. スマホ今すぐ対応
5. HANDOFF更新
6. ZIP納品

時間が足りない場合:
- shadcn/uiの本格デザイン化は後回し
- 業務導線と引き継ぎ性を優先

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / Manusへの引き継ぎ一言

最後にZIP化してダウンロードURLを提示してください。
```
