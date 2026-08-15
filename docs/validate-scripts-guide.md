# 検証スクリプト（scripts/validate/・scripts/check/policy-lint.mjs）ガイド

task #13の成果物。SPEC.md §8「検証ゲート」の実装（移植5本＋新設3本）。`docs/ledger-schema.md`
（v4向けに改訂した根拠台帳スキーマ）とセットで参照すること。

## 構成

| ファイル | 種別 | 役割 |
|---|---|---|
| `scripts/validate/validate_ledger.py` | 移植 | 根拠台帳JSONの自己整合性検査（schema_version・日付整合・JST変換再計算・重複ID・open_issuesのフェールクローズ） |
| `scripts/validate/validate_report.py` | 移植 | HTML×台帳照合（禁止タグ・作成日/対象週の日付整合・event-id/importance集合突合・外部リンク形式） |
| `scripts/validate/validate_daily_event_layout.py` | 移植 | 「対象週の注目イベント」セクションの日付別カード監査（`.ea-date-group`/`.ea-event-card`の件数・ID・重要度・日付グループ順序） |
| `scripts/validate/validate_mobile_header.py` | 移植 | モバイル5幅（320/360/375/390/414px）でのPlaywright検証。横スクロール検出＋ヘッダー主要テキストのビューポート内収まり確認 |
| `scripts/validate/publish_gate.py` | 移植 | 上記4本＋policy-lint.mjsをオーケストレーションし、PUBLISH_READY/HOLDを判定・記録する |
| `scripts/check/policy-lint.mjs` | 新設 | 禁止語・禁止セクション・免責/出典文言の存在・外部リンクの許可ドメインホワイトリスト照合・到達性チェック（Node、`npm test`でユニットテスト済み） |

移植5本の期待HTML構造をv4（`templates/design-mock_v1.2.html`）へ更新した詳細・削除したフィールド
（market_prices/market_holidays・値オブジェクト等）の理由は`docs/ledger-schema.md`参照。

## セットアップ（Python）

```bash
pip install -r scripts/validate/requirements.txt
```

`validate_mobile_header.py`はPlaywright用のChromiumバイナリを必要とする。このセッションの環境では
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`にプリインストール済みのため`playwright install`は不要
（`--chromium`引数の既定値`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`を使用）。
別環境では`playwright install chromium`または`--chromium`引数でパスを指定すること。

## 手動実測結果（2026-08-15、実装時点）

`test/fixtures/validate/`にv4レイアウト向けの新規fixture（pass/hold各1組）を作成し、以下を確認済み:

- `pass_ledger.json` + `pass_report.html`: 4本の検証スクリプト（ledger/report/daily_event_layout/mobile_header）
  ＋policy-lint.mjsとも判定「配信可」・exit 0
- `hold_report.html`（同一ledgerに対し、script混入・曜日不一致・イベント欠落・重要度不一致・
  禁止語混入・許可外ドメインリンク・免責文言欠落を意図的に混入）: 4本＋policy-lintとも判定
  「配信保留」・非0 exit（フェールクローズが機能することを確認）
- `scripts/validate/publish_gate.py`をこの2組に対して実行し、pass→`PUBLISH_READY`（exit 0）、
  hold→`HOLD`（exit 2）を確認（`--skip-link-reachability`使用。理由は下記）
- `output/ea-weekly-20260810.html`（実際のレンダラー出力）に対し`validate_mobile_header.py`を実行し、
  5幅すべてで横スクロール無し・主要ヘッダーテキストがビューポート内に収まることを確認

### リンク到達性チェックはWARNING扱い（HOLDしない）

実測でcoinpost.jp（`config/btc-weekend-guide.json`のallowed_domains収録サイト）が、UA明示済みの
機械的なHEAD/GETリクエストに対しHTTP 403を返すことを確認した（ボット対策とみられる。ブラウザで
開けば正常に閲覧できる可能性が高い）。週次配信のたびにこの種の誤検知でHOLDになる実害の方が大きいと
判断し、到達性チェック（`checkLinkReachability`）はWARNING止まりとした。一方、許可ドメインホワイト
リスト照合（`lintLinkDomains`。類似ドメイン事故防止、rebuild-plan §13.4注意2）は実害が大きいためERROR
（HOLD対象）のまま維持した。

## npm test（CI）に含まれるもの・含まれないもの

- **含まれる**: `test/policy-lint.test.js`（`scripts/check/policy-lint.mjs`の純粋関数のユニットテスト。
  `checkLinkReachability`はfetchImplを注入しネットワークアクセス無しで検証）
- **含まれない**: `scripts/validate/*.py`（Python・bs4・Playwright依存）の自動テスト。
  `.github/workflows/ci.yml`は「npm testのみを実行する軽量ワークフロー」としょうさんから明示的に
  スコープ指定されており（ネットワークアクセスなし・Secrets不使用）、Python依存のインストール
  （`pip install`はネットワークアクセスを要する）はこのスコープ外と判断し、追加していない。
  上記「手動実測結果」がこのセッションでの動作確認の記録である。

**残課題（要相談）**: 本番運用（週次自動生成）ではこれらのPythonスクリプトを実際に実行する必要がある。
実行経路の選択肢:
1. `workflows-draft/weekly.yml`をPhase 2で有効化する際に、その中でPython依存をセットアップする
   （同ワークフローは元々`actions/setup-python@v5`を用意済みで、依存インストールはTODOのまま）
2. `.github/workflows/ci.yml`とは別に、Python検証専用のCIワークフローを新設する（この場合
   pip install等でネットワークアクセスが発生するため、しょうさんの「ネットワークアクセスなし」
   指定はci.yml限定の話だったのか、Python検証にも及ぶのかの確認が必要）

現時点では1（Phase 2でのweekly.yml配線時に対応）を既定路線と考えているが、Phase 2着手前に
Python検証の動作をCI上で先行確認したい場合はしょうさんの判断を仰ぐ。
