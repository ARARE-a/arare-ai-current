# Genspark 残り2回用プロンプト final ZIP後

## 1回目に貼る: build / 起動 / 画面確認を通す

```text
確認不要です。続行してください。
このターンの目的は「最終ZIPの検証・build修正・ローカル起動確認」です。

前回納品した `arare-ai-p0-skeleton-v2-final.zip` を土台にしてください。
新機能追加、P1着手、外部API接続、長文説明は禁止です。

実行してください:
1. ZIPを展開
2. pnpm install
3. npx prisma validate --schema=prisma/schema.prisma
4. pnpm -r typecheck
5. pnpm -r build
6. build失敗時は、P0スケルトンを壊さない最小修正だけ適用
7. 可能ならローカル起動して以下の画面を確認
   - PC: /admin/dashboard
   - PC: /admin/holds
   - PC: /admin/platform
   - スマホ: /mobile/home
   - スマホ: /mobile/holds
   - スマホ: /mobile/urgent
8. 画面表示で致命的な崩れやランタイムエラーがあれば最小修正
9. ZIP化してダウンロードURLを提示

禁止:
- P0b/P1の新モデル追加
- 外部API実接続
- 本番キー使用
- UIの大幅デザイン変更
- 仕様外機能追加
- 長文説明
- 「実行してよいか」と聞き返すこと

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / 次にやること
```

## 2回目に貼る: 引き継ぎ可能な最終納品にする

```text
確認不要です。続行してください。
このターンの目的は「Manus/Codexへ引き継げる最終納品パッケージ化」です。

前回のbuild確認済みZIPを土台にしてください。
新機能追加、外部API接続、長文説明は禁止です。

実装・作成してください:

1. docs/HANDOFF.md を作成
以下を必ず含める:
- プロジェクト概要
- 技術スタック
- ディレクトリ構成
- 起動手順
- 検証コマンド
- P0制約
- AIは独断で予約確定しない
- ReservationHold -> スタッフ承認 -> Reservation(CONFIRMED)
- storeId必須のマルチテナント設計
- aiIngressPhoneNumberによる店舗電話ルーティング
- VoiceProviderAdapterの位置づけ
- 本番キー未使用
- 実装済み
- 未実装
- 未検証
- 次にやる作業順序

2. docs/STATUS_REPORT.md を最新化
以下を表で整理:
- 実装済み
- 未実装
- 未検証
- 検証結果
- 既知の問題

3. docs/TODO_NEXT.md を作成
次の担当者が迷わないよう、優先順で書く:
1. 実PostgreSQLで prisma migrate dev
2. seed実行
3. 承認フローE2E
4. PC/スマホ画面の実データ接続強化
5. shadcn/uiで本デザイン化
6. Twilio/LINE/OpenAIはmock維持のまま設定画面だけ整理

4. README.md を更新
- install
- validate
- typecheck
- build
- dev起動
- 主要URL
- env説明

5. 最終検証
- npx prisma validate --schema=prisma/schema.prisma
- pnpm -r typecheck
- pnpm -r build

6. ZIP化してダウンロードURLを提示

禁止:
- 新機能追加
- 外部API実接続
- 本番キー使用
- P1着手
- 長文説明

報告は以下だけ:
実装済み / 確認済み / 修正ファイル / 未実装 / 未検証 / 納品URL / Manusへの引き継ぎ一言
```
