# 土曜cronの発火遅延対策（提案・未実装）

**ステータス: 提案段階です。しょうさんの判断待ちで、まだ何も実装していません。**

## 背景・問題

`weekly.yml`のSaturday cron（primary 08:06 JST・insurance 08:41 JST）は、GitHub Actions側の
スケジュール実行の仕組み上、予定時刻どおりに発火しないことがあります。これまでの実測:

| 週 | primary遅延 | insurance遅延 |
|---|---|---|
| 8/21週 | 約29分 | 約18分 |
| 8/29週 | **約5時間1分** | 約4時間39分 |
| 9/5週 | 約1時間47分 | 約1時間44分 |
| 9/12週 | 約1時間58分 | 約1時間52分 |

GitHub公式も「scheduled workflowは高負荷時に遅延・スキップされることがある」と明記しており、
リポジトリ側の設定では解消できない既知の制約です。冪等ガード（task #92/#94で修正済み）自体は
正しく機能しており、二重生成のリスクは無くなりましたが、「配信予定時刻に間に合わない」
「最悪ケースでは土曜中に生成が終わらない」という別のリスクは残ったままです。

## 対策案: 外部トリガー（VPSタスクスケジューラ→workflow_dispatch API）＋GitHub cronの併存

しょうさんが24/7稼働させているVPSのタスクスケジューラから、土曜08:06 JST頃に
GitHub ActionsのAPIを直接叩いて`weekly.yml`を起動する方式です（EA-Risk-Monitorで検討した
「対策B」と同じ考え方）。GitHub側の`schedule:`によるcronは**削除せず、そのままフォールバックとして
併存**させます。

### なぜ安全に併存できるか

`weekly.yml`は`workflow_dispatch`を既にトリガーとして持っており、コード変更は一切不要です。
どちらが先に発火しても、冪等ガード（`generated_from_code_hash`によるスキップ判定、task #92/#94で
本番検証済み）が正しく機能するため、二重生成は起きません。VPS起動が成功していれば、その後の
GitHub cronは「対象週は生成済み」として正しくスキップします。逆にVPS側が何らかの理由で
失敗しても、GitHub cronがこれまでどおり動きます。つまり**片方が失敗してももう片方が保険になる**
構成です。

## 必要なもの

### 1. Fine-grained Personal Access Token（PAT）

- **スコープ**: `MFlab-inc/EA-Weekly-Report`リポジトリのみに限定（Organization全体・他リポジトリへは付与しない）
- **権限（Repository permissions）**: `Actions` を **Read and write** に設定（workflow_dispatchのAPI呼び出しに必要な権限はこれだけです。それ以外の権限は不要です）
- **有効期限**: 1年程度を推奨（無期限は避ける。期限が近づくとGitHubからメール通知が来ます）

### 2. トークンの保存場所

**リポジトリには絶対に保存しません**（GitHub Secretsにも登録不要です。これはGitHub Actions側から
GitHubを呼ぶためではなく、VPS側からGitHubを呼ぶためのトークンのため）。VPS側のみで保持します:

- VPSのタスクスケジューラが実行するスクリプトの中で、環境変数として渡す（例: systemdの
  `EnvironmentFile`、cronの`crontab`に直接書かず別ファイルから`source`する等）
- ファイルに保存する場合はパーミッションを`600`（所有者のみ読み書き可）に設定する
- ログに平文で出力しない（`curl`のコマンドライン引数ではなく、`Authorization`ヘッダー経由で渡す）

## 設定手順（しょうさん作業）

1. **PATの発行**: GitHub右上のアイコン → `Settings` → 左メニュー最下部 `Developer settings` →
   `Personal access tokens` → `Fine-grained tokens` → `Generate new token`。
   - `Repository access`で`Only select repositories`を選び`EA-Weekly-Report`を指定
   - `Permissions` → `Repository permissions` → `Actions`を`Read and write`に設定
   - 有効期限を設定して発行（発行直後しか表示されないので必ずコピーして保管）
2. **VPS側にトークンを保存**: 上記「トークンの保存場所」のとおり、VPS上にのみ保存する
3. **起動スクリプトの設置**: 以下のような内容をVPSのタスクスケジューラから実行するスクリプトとして設置する（OSがLinuxで`cron`を使う想定の例。VPSのOS・スケジューラが分かれば、その環境に合わせた具体的な手順を別途用意します）

   ```bash
   #!/bin/bash
   curl -sS -X POST \
     -H "Accept: application/vnd.github+json" \
     -H "Authorization: Bearer ${EA_WEEKLY_REPORT_PAT}" \
     -H "X-GitHub-Api-Version: 2022-11-28" \
     https://api.github.com/repos/MFlab-inc/EA-Weekly-Report/actions/workflows/weekly.yml/dispatches \
     -d '{"ref":"main"}'
   ```

4. **スケジュール登録**: 土曜08:05 JST頃（GitHub側の08:06予定より少し早め。これによりVPS起動が
   「先着」しやすくなり、GitHub cronは実質的にフォールバック専任になる）に上記スクリプトが
   実行されるよう、VPSのタスクスケジューラへ登録する。VPSのシステム時刻がJSTかUTCかで
   cron式の書き方が変わるため、事前に`date`コマンド等でVPSのタイムゾーンを確認してほしい
5. **動作確認**: 手動で一度スクリプトを実行し、GitHubの`Actions`タブに新しいrunが
   `workflow_dispatch`イベントとして現れることを確認する（レスポンスがHTTP 204なら成功）

## しょうさん側の作業量の見込み

- PAT発行: 約5分（一度きり）
- スクリプト設置・スケジュール登録: 約15分（一度きり。VPSのOS・スケジューラが分かれば、こちらで具体的なコマンド例を用意します）
- 動作確認: 約5分
- **合計: 約25分の初期設定、以後の定常的な作業はほぼ無し**（トークン有効期限が近づいたら更新が必要。GitHubからのメール通知が目安になります）

## 実装しない部分（今回の提案に含まれないこと）

- `weekly.yml`自体の変更は不要（`workflow_dispatch`は既に存在するトリガーのため）
- GitHub側の`schedule:`cronは削除しない（フォールバックとして残す）
- この提案自体はドキュメント化のみで、VPS側のスクリプト設置・スケジュール登録はしょうさんの
  判断・作業待ちとする
