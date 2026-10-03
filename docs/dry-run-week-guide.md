# 日付境界バグ事前点検ツール（dry-run-week）の使い方

対象: `scripts/check/dry-run-week.mjs` と、そのGitHub Actionsエントリポイント `.github/workflows/dry-run-week.yml`。

2026-10-03、しょうさん指摘（10/5週HOLDインシデントのフォローアップitem3「日付まわりの潜在バグの事前点検」）で新設。collect→build-ledger→render→gateの全パイプラインを任意の対象週に対して試験実行できる。`data/ledger/`・`output/` 配下の本番パスには一切書き込まない（スクラッチ領域にのみ出力するため、本番にコミットされる心配なく安全に試験実行できる）。

## 2つのモード（使い分けが重要）

本ツールは `--now` と `--target-week-start` の2つの指定方法を持つが、**検証したい対象によって使い分ける必要がある**。これを取り違えると、結果の解釈を誤る（実際に2026-10-03のitem3調査で12/28週・1/4週がHOLDになったのは、この取り違えが原因だった。詳細は後述）。

### モードA: `--now <YYYY-MM-DD>` — 日付計算ロジック自体の検証

`scripts/lib/dates.js` の `getTargetWeek()` をそのまま使い、「生成日（土曜）が`<日付>`だったら対象週はどこになるか」を実際の本番ロジックで算出する。2桁月・年またぎ・閏年など、**日付の計算パターン自体**（曜日判定・月またぎ・年またぎの境界条件）にバグが無いかを検証するためのモード。

ただし外部サイトへのフェッチは常に**実行時点の実際のインターネット内容**に対して行われる（過去の実際のサイト内容を再現することはできない）。そのため、対象週が実行時点から遠い未来（目安3ヶ月以上先）の場合、BOE予定表・FRB/MOF月別カレンダー・NZ Stats「最新リリース」ポインタ等、掲載horizonが近視眼的なソースは軒並み「まだ掲載されていない」状態になり、2〜4ソース同時失敗によるフェールクローズHOLDが機械的に発生する。**これはツールの既知の限界であり、日付計算バグではない**（2026-10-03のitem3調査で2026-12-28週・2027-01-04週がHOLDになったのはこのケース。au_abs自体は実際に11月・12月分を正しく検出できており、同じ調査で2026-11-02週はPUBLISH_READYだった）。

→ **モードAの結果でHOLD/ERRORが出た場合、まず「対象週が実行時点から何ヶ月先か」を確認し、各ソースの実測済み掲載horizon（`docs/phase1-official-sources.md`参照）と照らして、horizon起因の既知の限界なのか、それとも日付計算自体のバグなのかを切り分けること。**

### モードB: `--target-week-start <YYYY-MM-DD>` — 実際に迫った週の「今、生成したら成功するか」の検証

`--now` を指定せず対象週を直接指定するため、`getTargetWeek()`の曜日計算は経由しない。**外部フェッチは実行した「今日」の実際のサイト内容**に対して行われるため、対象週が実行時点から2〜4週間後程度まで近づいていれば、各ソースの掲載horizonに実際に入っている可能性が高く、モードAのような構造的HOLDを避けつつ「本番が実際に成功するか」を事前に確認できる。

→ 「来月のこの週、ちゃんと生成できそうか」を知りたい通常の事前点検には**こちらを使う**。

## 実行方法（GitHub Actions）

`.github/workflows/dry-run-week.yml` が `workflow_dispatch` で用意されている。GitHub ActionsのUI（Actions → dry-run-week → Run workflow）から、`now` または `target_week_start` のどちらか一方を入力して実行する。結果（台帳・HTML・gate-result.json）はworkflow実行のartifactとしてダウンロードできる（保存期間30日）。

ローカル/CLIから直接実行する場合:

```
node scripts/check/dry-run-week.mjs --target-week-start 2026-12-28 --out-dir phase1-out/dry-run
# または
node scripts/check/dry-run-week.mjs --now 2026-10-31 --out-dir phase1-out/dry-run
```

## 2026-12-28週・2027-01-04週の再試験手順（2026年12月中旬に実施）

2026-10-03時点のitem3調査では、この2週をモードA（`--now`）で試験したため、上記の「horizon起因の構造的HOLD」が発生し、新規の日付計算バグが無いことまでは確認できたが、「本番が実際に成功するか」の確認にはならなかった。**2026年12月12日〜12月19日ごろ**（各ソースの掲載horizonに両週が十分入ってくる時期。実測上ABS等は1〜2ヶ月先まで掲載されるため、年末年始週・新年最初の週もこの時期なら通常は掲載範囲内）に、**モードB（`--target-week-start`）で再試験**し、今度こそ「本物の日付バグだけ」を見分ける。

手順:

1. GitHub Actions → `dry-run-week` → Run workflow を2回実行する
   - 1回目: `target_week_start` = `2026-12-28`
   - 2回目: `target_week_start` = `2027-01-04`
   （`now` は空欄のままにする）
2. 各実行のartifact（`dry-run-result`）をダウンロードし、`gate-result-<週>.json` の `decision` を確認する
3. 判定がHOLD/REVIEW_REQUIREDだった場合、`checks[].errors` を確認し、以下のいずれかに分類する
   - **構造的HOLD（既知の限界）**: 特定ソースの掲載horizonが依然として足りていない場合。この時期（本番実行の1〜2週間前）でも起きるようなら、該当ソースのhorizon自体をdocs/phase1-official-sources.mdに追記し、しょうさんへ個別に報告する（コード修正は不要な場合が多い）
   - **本物の日付バグ**: 上記以外の理由（日付変換・候補のロールオーバー・曜日判定ミス等）でERRORが出ている場合。こちらは「問題が見つかったら修正はPRで」の対象
4. 両週ともPUBLISH_READYまたは問題なしを確認できたら完了。問題が見つかった場合はPRで修正し、再度このツールで確認してからマージする

## 低イベント件数週（祝日週等）に関する注意

`config/volume-check-policy.json` の下限チェック（掲載対象4件未満、または★★★0件）に抵触した場合の判定は **HOLDではなくREVIEW_REQUIRED** である（`scripts/check/gate.mjs`の`decideGateOutcome()`参照。監査エラー[ERROR]が1件でもあれば最優先でHOLD、無ければ下限抵触時のみREVIEW_REQUIRED）。年末年始週のように正当に件数が少ない週でも、監査エラー自体が無ければHOLDにはならない。

ただしREVIEW_REQUIRED・HOLDいずれの場合も`weekly.yml`の`pipeline`ステップは非ゼロ終了コードで失敗する（`bash -e`のため）ため、`commit outputs`ステップはスキップされ、出力は自動では配信されない。2026-10-03追加の失敗時Issue自動作成（`scripts/check/create-pipeline-failure-issue.mjs`）はHOLD・REVIEW_REQUIREDいずれでも発火し、gate判定とvolume_checkの詳細をIssue本文に含めるため、しょうさんは気づける設計になっている。

現状、REVIEW_REQUIRED確認後に「この内容で確定配信してよい」と判断した場合、`gate.mjs`の`--acknowledge-low-volume`相当をGitHub Actions側から実行する手段が無い（`weekly.yml`の`workflow_dispatch`には`force_regenerate`しか無い）。この手動公開経路の追加は別途しょうさんへ提案・確認予定。
