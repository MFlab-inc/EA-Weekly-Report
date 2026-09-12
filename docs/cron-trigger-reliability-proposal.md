# 土曜cronの発火遅延対策（実装済み・デプロイは判断待ち）

**ステータス**: ツール本体（`ops/external-cron-trigger/`）は実装・テスト済みでmainにマージ済みです。
**VPS側への実際の配置・スケジュール登録はまだ行っていません**（しょうさんがVPSのOS・
スケジューラを確認してから着手する方針、2026-09-12）。

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
リポジトリ側の設定では解消できない既知の制約です。しょうさんの他リポジトリ（EA-Risk-Monitor）
でも「実行の大半がdrop」という実測報告があり、EA-Weekly-Report固有の問題ではなく、
GitHub Actions全体の既知の制約です。冪等ガード（task #92/#94で修正済み）自体は正しく
機能しており、二重生成のリスクは無くなりましたが、「配信予定時刻に間に合わない」
「最悪ケースでは土曜中に生成が終わらない」という別のリスクは残ったままです。

## 対策: 外部トリガー（VPSタスクスケジューラ→workflow_dispatch API）＋GitHub cronの併存

しょうさんが24/7稼働させているVPSのタスクスケジューラから、土曜08:05頃JST
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

## 実装: 複数リポジトリへの展開を見越した設計（2026-09-12、しょうさん指摘）

GitHub Actionsのcron遅延はEA-Weekly-Report固有の問題ではなく、しょうさんの他リポジトリ
（EA-Risk-Monitor等）でも同様の症状が出ています。そのため、本ツールは**最初から複数
リポジトリへ展開できる形で実装**しました。実体は`ops/external-cron-trigger/`にあります:

- `trigger.mjs` — 汎用スクリプト本体（対象ごとに複製しない、1本のみ）
- `targets.json` — 起動対象の設定ファイル。**対象を増やす場合はここへ1エントリ追記するだけ**で
  よく、`trigger.mjs`自体の変更は不要（現時点ではEA-Weekly-Report 1件のみ登録）
- `README.md` — ツールの設計・設定項目・PAT運用方針（リポジトリごとに別PAT vs 複数リポジトリを
  1本のfine-grained PATでカバー、の比較と推奨）の詳細
- `test/external-cron-trigger.test.js` — cron式マッチング・タイムゾーン変換・重複起動排除
  ロジックの単体テスト（このリポジトリの`npm test`に含まれる。598件全てパス確認済み）

**実際の展開は段階的に行う方針です**（しょうさん指示2026-09-12）: まずEA-Weekly-Report
1本でVPSへ実配置し、2〜3週間の実績を見てから他リポジトリへ広げます。本ドキュメントの
以下の設定手順もEA-Weekly-Report 1本を対象にした内容です。複数リポジトリへ広げる際の
手順・PAT設定の詳細は`ops/external-cron-trigger/README.md`を参照してください。

## PATの運用方針（要点。詳細比較はREADME参照）

**推奨: fine-grained PAT 1本で、対象リポジトリを個別選択してカバーする方式**です。GitHubの
fine-grained PATは「Repository access」で複数リポジトリを個別選択できるため、「全リポジトリに
権限を持つ1本」にはならず、被害範囲は「このツールが管理すると明示的に選択したリポジトリ」に
限定されます。トークンの発行・保管・期限管理は1本で済むため、リポジトリを増やすたびに
別トークンを発行する方式（より安全だが運用の手間が増える）と比べて実務上のバランスが良いと
判断しました。新しいリポジトリを追加する際は、`targets.json`への追記に加えて、GitHub側の
PAT設定画面で「Repository access」にそのリポジトリを追加する一手間が必要です（トークンの
再発行は不要）。

- **権限（Repository permissions）**: `Actions` を **Read and write** に設定（workflow_dispatchの
  API呼び出しに必要な権限はこれだけです。それ以外の権限は不要です）
- **有効期限**: 1年程度を推奨（無期限は避ける。期限が近づくとGitHubからメール通知が来ます）

### トークンの保存場所

**リポジトリには絶対に保存しません**（GitHub Secretsにも登録不要です。これはGitHub Actions側から
GitHubを呼ぶためではなく、VPS側からGitHubを呼ぶためのトークンのため）。VPS側のみで保持します:

- VPSのタスクスケジューラが実行するスクリプトの中で、環境変数`EXTERNAL_TRIGGER_PAT`として渡す
  （例: systemdの`EnvironmentFile`、cronの`crontab`に直接書かず別ファイルから`source`する等）
- ファイルに保存する場合はパーミッションを`600`（所有者のみ読み書き可）に設定する
- ログに平文で出力しない（本ツールは`Authorization`ヘッダー経由でのみトークンを使う設計で、
  コマンドライン引数やログへの出力は行わない）

## 設定手順（しょうさん作業、EA-Weekly-Report 1本のみ対象）

1. **PATの発行**: GitHub右上のアイコン → `Settings` → 左メニュー最下部 `Developer settings` →
   `Personal access tokens` → `Fine-grained tokens` → `Generate new token`。
   - `Repository access`で`Only select repositories`を選び`EA-Weekly-Report`を指定（将来
     他リポジトリを追加する際はここへ追加していく）
   - `Permissions` → `Repository permissions` → `Actions`を`Read and write`に設定
   - 有効期限を設定して発行（発行直後しか表示されないので必ずコピーして保管）
2. **VPS側にトークンを保存**: 上記「トークンの保存場所」のとおり、環境変数
   `EXTERNAL_TRIGGER_PAT`としてVPS上にのみ保存する
3. **ツールの配置**: このリポジトリをVPS上にクローンし、`ops/external-cron-trigger/`
   ディレクトリを使う（`node`が必要。VPS上のNode.jsの有無を確認してほしい。無ければ
   別ランタイムへの移植を検討する）
4. **`targets.json`の確認**: 現状のままEA-Weekly-Report 1件が`enabled: true`で登録されている
   ので、変更は不要（内容は`ops/external-cron-trigger/README.md`参照）
5. **スケジュール登録**: VPSのタスクスケジューラへ、`node trigger.mjs`を**毎分**実行する
   エントリを1つだけ登録する（対象を増やしてもこのエントリ自体は変更不要。実際に
   GitHub APIを叩くのはtargets.jsonのcron条件に一致した分だけ）。VPSのシステム時刻の
   タイムゾーンは気にする必要がない（`targets.json`側で対象ごとにタイムゾーンを指定する設計）
6. **動作確認**: 手動で一度`node trigger.mjs`を実行し（現在時刻がtargets.jsonのcron条件に
   一致しない場合は何も起きないのが正常。強制的に試すにはtargets.jsonのcronを一時的に
   現在時刻に合わせて実行後、元に戻す）、GitHubの`Actions`タブに新しいrunが
   `workflow_dispatch`イベントとして現れることを確認する

## しょうさん側の作業量の見込み

- PAT発行: 約5分（一度きり）
- ツールの配置・スケジュール登録: 約15分（一度きり。VPSのOS・スケジューラが分かれば、
  こちらで具体的なコマンド例を用意します）
- 動作確認: 約5分
- **合計: 約25分の初期設定、以後の定常的な作業はほぼ無し**（トークン有効期限が近づいたら
  更新が必要。GitHubからのメール通知が目安になります。将来リポジトリを追加する際は
  `targets.json`への1エントリ追記＋PATのRepository access追加）

## 実装しない部分（今回の対応に含まれないこと）

- `weekly.yml`自体の変更は不要（`workflow_dispatch`は既に存在するトリガーのため）
- GitHub側の`schedule:`cronは削除しない（フォールバックとして残す）
- VPS側への実際の配置・スケジュール登録はしょうさんのVPS環境確認後に着手する
  （ツール本体の実装・テストは完了済みだが、実際にVPS上で動かすのはまだ）
- EA-Risk-Monitor等、他リポジトリへの展開は今回のスコープに含まない（ツールの設計自体は
  対応済みだが、`targets.json`への追加は行っていない）
