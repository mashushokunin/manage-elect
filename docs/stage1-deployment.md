# 第1段階のデプロイ手順

この手順で、iPhoneショートカットから送信した `ENTER` / `EXIT` をGoogleスプレッドシートへ記録できるようにします。

## 1. コードをApps Scriptへ反映する

提供済みのScript IDはルートの `.clasp.json` に設定済みです。

### claspを使う場合

Googleアカウントでの認証が必要なため、以下は利用者の端末で実行します。

```bash
npm run gas:login
npm run gas:status
npm run gas:push
```

`gas:push` が既存ファイルの上書き確認を表示した場合は、対象のApps Scriptプロジェクトが正しいことを確認してから進めてください。

### Apps Scriptエディタで手動反映する場合

1. 対象スプレッドシートから「拡張機能」→「Apps Script」を開く。
2. `gas/` 以下の各 `.gs` ファイルと同名のスクリプトファイルを作る。
3. 内容を貼り付ける。
4. `appsscript.json` を表示し、`gas/appsscript.json` の内容で更新する。

## 2. スプレッドシートを初期化する

1. Apps Scriptエディタ上部の関数選択で `setupProject` を選ぶ。
2. 「実行」を押す。
3. Googleスプレッドシートへのアクセスを許可する。
4. スプレッドシートに次の9シートが作られたことを確認する。
   - `在宅イベント`
   - `イベント修正`
   - `在宅集計`
   - `請求項目`
   - `請求履歴`
   - `按分結果`
   - `ユーザー`
   - `設定`
   - `監査ログ`
5. `ユーザー` シートの表示名を必要に応じて変更する。`user_id` はショートカットと一致させる。

既存データは消去しません。空の既定シートが1枚だけの場合は、そのシートを `在宅イベント` に改名して利用します。

## 3. ユーザー別トークンを登録する

Macのターミナルで2つ生成できます。

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」で次を追加します。

- プロパティ: `USER_TOKENS_JSON`
- 値:

```json
{"user_A":"1つ目のトークン","user_B":"2つ目のトークン"}
```

トークンはコード、Git、スプレッドシート、チャットへ貼らないでください。登録後、Apps Scriptで `checkProjectSetup` を実行し、`ready: true` になることを確認します。

## 4. Webアプリとしてデプロイする

1. Apps Script右上の「デプロイ」→「新しいデプロイ」を開く。
2. 種類に「ウェブアプリ」を選ぶ。
3. 「次のユーザーとして実行」は自分を選ぶ。
4. 「アクセスできるユーザー」は全員を選ぶ。
5. デプロイして、末尾が `/exec` のWebアプリURLを控える。

この設定は`gas/appsscript.json`にも`webapp`設定として保持しています。`clasp push --force`を実行しても匿名アクセス設定が消えないよう、`ANYONE_ANONYMOUS`と`USER_DEPLOYING`を削除しないでください。

iPhoneショートカットはGoogleログインを行わないため匿名アクセスが必要です。代わりに、リクエスト本文のユーザー別トークンを毎回検証します。

コード更新後は「デプロイを管理」から既存デプロイを編集し、新しいバージョンへ更新してください。エディタに保存しただけでは公開中のWebアプリへ反映されません。

## 5. 疎通確認

WebアプリURL、`user_A` のトークン、現在時刻を使ってPOSTします。`timestamp` は実行時点のタイムゾーン付きISO 8601に置き換えてください。

```bash
curl -sS -X POST "GAS_WEB_APP_URL" \
  -H "Content-Type: application/json" \
  --data '{
    "token": "USER_A_TOKEN",
    "user_id": "user_A",
    "event": "ENTER",
    "timestamp": "2026-11-13T18:00:00+09:00",
    "event_id": "manual-test-0001",
    "source": "manual_test"
  }'
```

成功時の例:

```json
{
  "ok": true,
  "duplicate": false,
  "event_id": "manual-test-0001",
  "record_status": "OK"
}
```

同じJSONを再送すると `duplicate: true` になり、`在宅イベント` に新しい行は追加されません。

Apps ScriptのWebアプリはアプリケーションエラーでもHTTPステータスを細かく制御できないため、ショートカット側ではHTTPコードだけでなくレスポンスJSONの `ok` を確認します。

## 6. iPhoneショートカットを作る

2人それぞれのiPhoneで、「到着」と「出発」のオートメーションを作ります。

### 共通アクション

1. 「現在の日付」を追加する。
2. 日付をISO 8601形式、タイムゾーン付きでフォーマットする。
3. 「UUIDを生成」を追加する。
4. 「URL」にWebアプリの `/exec` URLを設定する。
5. 「URLの内容を取得」を追加する。
6. メソッドを `POST`、本文を `JSON` にする。
7. 以下のキーを設定する。

| キー | 到着 | 出発 |
|---|---|---|
| `token` | そのiPhone専用トークン | 同じトークン |
| `user_id` | `user_A` または `user_B` | 同じID |
| `event` | `ENTER` | `EXIT` |
| `timestamp` | フォーマット済み現在日時 | フォーマット済み現在日時 |
| `event_id` | 生成したUUID | 生成したUUID |
| `source` | `ios_shortcut` | `ios_shortcut` |

8. レスポンスJSONの `ok` が `false` の場合だけ通知を表示する。
9. オートメーションを「すぐに実行」にする。

再試行用にイベントを再送する場合は、新しいUUIDを作らず、最初の実行と同じ `event_id` を使う必要があります。ショートカット単体で確実な再送キューを作るのは複雑なため、第1段階では監査ログと手動補正で検知し、必要に応じて専用iOSアプリへ移行します。

## 7. 受け入れ確認

- `user_A` の到着が1行追加される。
- 同じイベントを再送しても行が増えない。
- 誤ったトークンでは `ok: false` / `AUTH_FAILED` になる。
- 不正なトークンや未登録の組み合わせでは `AUTH_FAILED` になり、イベントが追加されない。
- `ENTER` を連続送信すると2件目が `NEEDS_REVIEW` になる。
- 日本時間で表示される。
- トークンや緯度・経度がシートに保存されていない。
