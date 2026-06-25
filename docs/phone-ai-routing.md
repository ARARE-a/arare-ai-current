# 電話AI 店舗別ルーティング

## 管理画面

```text
https://arare-ai-three.vercel.app/phone-ai
```

## 実装済みの流れ

1. 店舗ごとに `StorePhoneSetting` へAI受付番号を登録
2. Twilio着信Webhook `/api/twilio/voice` が `To` 番号を受け取る
3. `To` 番号を正規化して `StorePhoneSetting.normalizedAiReceptionPhoneNumber` で店舗判定
4. `CallLog.storeId` と `CallLog.storePhoneSettingId` に正しい店舗情報を保存
5. `VOICE_RELAY_WS_URL` または店舗別 `voiceRelayWsUrl` があれば ConversationRelay へ接続
6. 未登録番号はデモ店舗へ流さず、設定未登録としてTwiMLを返す

## 複数店舗ルーティング検証

```bash
npm run verify:phone-routing -- https://arare-ai-three.vercel.app
```

この検証は2つの一時店舗と2つのAI受付番号を作成し、擬似Twilio着信を本番URLへPOSTします。

成功条件:

- 各 `CallLog` がそれぞれ正しい `storeId` に保存される
- `CallLog.toNumber` に着信先のAI受付番号が保存される
- `CallLog.storePhoneSettingId` が登録済みAI受付番号に紐づく
- 未登録番号では `CallLog` が作成されない

## 店舗側の運用

1. 店舗の既存電話番号は変更しない
2. Twilioで店舗ごとのAI受付番号を用意する
3. 店舗の既存電話番号からAI受付番号へ転送設定する
4. ARARE AIの電話AI設定画面へ既存番号、AI受付番号、転送先番号、Twilio SIDを登録する
5. Twilio Voice Webhook に `https://arare-ai-three.vercel.app/api/twilio/voice` を `POST` で設定する

## 100店舗前提の考え方

100店舗でもTwilioのWebhook入口は共通です。店舗判定はTwilioアカウントではなく、着信Webhookの `To` 番号で行います。

そのため、店舗数が増えても以下の条件を守れば既存ダッシュボードや予約APIを壊さずに拡張できます。

- AI受付番号は店舗ごとに一意にする
- `StorePhoneSetting.normalizedAiReceptionPhoneNumber` を一意キーにする
- CallLog、Conversation、Reservationなどの保存時は必ず解決済み `storeId` を使う
- 未登録番号はデモ店舗に流さない
- 実運用前に `npm run verify:phone-routing -- <本番URL>` を通す
