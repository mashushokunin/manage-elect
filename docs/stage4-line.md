# 第4段階: LINE Bot接続

LINE Messaging APIからのWebhookをSupabase Edge Functionで受け、署名検証に成功したイベントだけをApps Scriptへ転送します。Apps Scriptが作った返信内容はEdge FunctionからLINE Reply APIへ送信します。

## 接続先

- Supabase project ref: `rzfbkjimiqppoveyzihc`
- Edge Function: `line-webhook`
- LINE Webhook URL:

```text
https://rzfbkjimiqppoveyzihc.supabase.co/functions/v1/line-webhook
```

## シークレット

値そのものはリポジトリへ保存しません。

### Supabase Edge Function Secrets

| 名前 | 用途 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINEから届くWebhookの署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Reply APIによる返信 |
| `APPS_SCRIPT_WEB_APP_URL` | 検証済みイベントの転送先 |
| `LINE_GATEWAY_SECRET` | SupabaseからApps Scriptへの内部認証 |

### Apps Scriptのスクリプトプロパティ

| 名前 | 用途 |
| --- | --- |
| `LINE_GATEWAY_SECRET` | Supabaseからの転送だけを許可する内部認証 |

`LINE_GATEWAY_SECRET`はSupabaseとApps Scriptへ同じ値を設定します。

## LINE側の設定

1. LINE Developersコンソールで対象のMessaging APIチャネルを開く。
2. ［Messaging API設定］で長期のチャネルアクセストークンを発行する。
3. Channel secretとChannel access tokenをSupabase Secretsへ登録する。
4. Webhook URLへ上記のEdge Function URLを設定する。
5. ［検証］を実行し、成功を確認する。
6. ［Webhookの利用］を有効にする。
7. LINE Official Account Managerの応答設定で、重複返信を避けるため自動応答を無効にする。

## 疎通確認

Botを友だち追加し、次のテキストを送ります。

```text
接続テスト
```

成功時は次の返信が届きます。

```text
接続できています。
LINE → Supabase → Apps Script → LINE の通信に成功しました。
```

## セキュリティ

- `x-line-signature`と受信した本文を変更せず、HMAC-SHA256で検証してからJSONとして解釈します。
- Edge FunctionはLINEからSupabase JWTを受け取れないため`verify_jwt = false`ですが、LINE署名が一致しないリクエストは拒否します。
- Apps Scriptは任意のLINE形式リクエストを直接信用せず、`LINE_GATEWAY_SECRET`を照合します。
- Channel secret、Channel access token、Gateway secretをログ、Git、スプレッドシートへ保存しません。
