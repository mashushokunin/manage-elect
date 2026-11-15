# 第2段階の運用手順

第2段階では、在宅イベントから月単位の在宅時間を集計し、元イベントを変更せずに手動修正できます。

## 初回反映

1. `npm run gas:push`でコードをApps Scriptへ反映する。
2. 既存のWebアプリデプロイを新しいバージョンへ更新する。
3. Apps Scriptで`setupProject`を再実行する。
4. 次の2シートが追加されたことを確認する。
   - `イベント修正`
   - `在宅集計`
5. `refreshCurrentMonthPresenceSummary`を実行する。

`setupProject`は既存のイベントを削除せず、不足しているシートだけを追加します。

## 在宅集計

`refreshCurrentMonthPresenceSummary`は、Asia/Tokyo基準の当月1日0時から実行時点までを集計します。過去月を指定した場合は、その月の月末までを集計します。

- `present_minutes`: 有効な在宅時間
- `away_minutes`: 有効な外出時間
- `unknown_minutes`: イベント欠落や要確認イベントにより判定できない時間
- `period_minutes`: 対象期間全体
- `calculation_status`: 判定不能時間がなければ`OK`、あれば`NEEDS_REVIEW`

正常なイベントを受信すると、そのイベントが属する月の集計は自動更新されます。集計更新に失敗しても、受信したイベント自体は失われず、監査ログにエラーが記録されます。

## イベント修正

修正は`イベント修正`シートの末尾へ追記します。`在宅イベント`の元行は変更しません。

| action | 用途 | target_event_id | user_id / event_type / occurred_at |
|---|---|---|---|
| `ADD` | 欠落イベントを追加 | 空欄 | 必須 |
| `REPLACE` | 誤ったイベントを置換 | 必須 | 必須 |
| `VOID` | イベントを集計対象外にする | 必須 | 空欄可 |

`correction_id`には重複しない8文字以上のIDを指定します。`reason`、`corrected_by`、`corrected_at`も必ず残してください。修正後に`refreshCurrentMonthPresenceSummary`を実行すると集計へ反映されます。

## 判定方針

- 対象期間前の最後の正常イベントから期間開始時の状態を復元する。
- `ENTER`から次の`EXIT`までを在宅時間とする。
- 期間境界をまたぐ区間は、対象期間と重なる部分だけを集計する。
- 最初のイベントより前の状態が分からない時間は`unknown_minutes`とする。
- `NEEDS_REVIEW`イベントの前後や、同種イベントが連続する区間は推測せず`unknown_minutes`とする。
