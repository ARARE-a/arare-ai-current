# Genspark投入用: P0a修正を実行

自己レビュー結果に基づき、次は **P0a修正だけ** 実行してください。

長い説明、再設計、追加提案、設計書作成は不要です。

## 実行内容

以下3件を実際にファイルへ適用してください。

1. `ReservationHoldStatus` に `CANCELLED` を追加
2. `NotificationLog.dedupeKey` の制約を `dedupeKey String @unique` から `@@unique([storeId, dedupeKey])` に変更
3. `PhoneRoutingSetting` モデルを `prisma/schema.prisma` に追加

## PhoneRoutingSetting 必須フィールド

```prisma
model PhoneRoutingSetting {
  id String @id @default(cuid())
  storeId String
  publicPhoneNumber String
  aiIngressPhoneNumber String @unique
  forwardingMode String
  forwardingStatus String
  lastForwardingTestAt DateTime?
  lastForwardingTestResult String?
  callerIdPreserved String?
  routingMode String
  enabled Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  store Store @relation(fields: [storeId], references: [id])

  @@index([storeId])
  @@index([aiIngressPhoneNumber])
}
```

`Store` 側にも relation を追加してください。

```prisma
phoneRoutingSettings PhoneRoutingSetting[]
```

## 検証

修正後、必ず以下を実行してください。

1. `npx prisma validate`
2. `pnpm -r typecheck`

`pnpm -r typecheck` が `tsc: not found` で落ちる場合は、機能追加せず、構成だけ直してください。

候補:

- `.npmrc` に `node-linker=hoisted` を追加
- または各 package の typecheck script を `pnpm exec tsc --noEmit` に変更

どちらか最小変更で通るようにしてください。

## 禁止

- P0b / P1 モデル追加に進まない
- UI追加に進まない
- 新機能追加しない
- 外部API接続しない
- 本番キーを使わない
- 長文説明しない

## 報告形式

完了後は以下だけ短く報告してください。

```text
実装済み:
- ...

確認済み:
- npx prisma validate: pass / fail
- pnpm -r typecheck: pass / fail

修正ファイル:
- ...

未実装:
- ...

未検証:
- ...

次にやること:
- ...
```

ファイルをZIP化して、ダウンロードURLも提示してください。
