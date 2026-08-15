#!/usr/bin/env python3
"""Run all EA weekly report checks as a publish/hold gate (v4 layout).

task #13（移植）。reference/fx-ea-report-auditor-skill/scripts/publish_gate.py を移植。
旧スクリプトはvalidate_ledger.py・validate_report.pyのみを呼んでいたが、SPEC.md §8の
検証ゲート表（移植5本＋新設3本、1件でも不合格→HOLD）に合わせて
validate_daily_event_layout.py・validate_mobile_header.py・新設のpolicy-lint.mjs（Node）も
オーケストレーションに加えた。--skip-mobileでモバイル検証（Playwrightブラウザ起動）を省略できる
（CI高速化・環境未整備時の一時回避用。本番の週次runでは省略しないこと）。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
JST = ZoneInfo("Asia/Tokyo")


def run_check(command: list[str]) -> dict[str, object]:
    completed = subprocess.run(command, capture_output=True, text=True, check=False, cwd=REPO_ROOT)
    return {
        "command": command,
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="EA週次レポートの公開可否を自動判定します（v4レイアウト向け）。")
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--html", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--btc-guide-config", type=Path, default=Path("config/btc-weekend-guide.json"))
    parser.add_argument("--skip-mobile", action="store_true", help="モバイル多幅検証（Playwright）を省略する")
    parser.add_argument("--skip-link-reachability", action="store_true", help="外部リンク到達性チェック（実ネットワークアクセス）を省略する")
    args = parser.parse_args()

    checks: dict[str, dict[str, object]] = {}

    checks["ledger"] = run_check([sys.executable, str(SCRIPT_DIR / "validate_ledger.py"), str(args.ledger), "--strict"])
    checks["report"] = run_check([sys.executable, str(SCRIPT_DIR / "validate_report.py"), str(args.html), "--ledger", str(args.ledger)])
    checks["daily_event_layout"] = run_check([sys.executable, str(SCRIPT_DIR / "validate_daily_event_layout.py"), str(args.html), str(args.ledger)])

    if args.skip_mobile:
        checks["mobile_layout"] = {"command": [], "exit_code": 0, "stdout": "(skipped: --skip-mobile)", "stderr": ""}
    else:
        checks["mobile_layout"] = run_check([
            sys.executable, str(SCRIPT_DIR / "validate_mobile_header.py"), str(args.html), "--no-screenshots",
        ])

    policy_lint_command = ["node", str(REPO_ROOT / "scripts" / "check" / "policy-lint.mjs"), str(args.html), "--btc-guide-config", str(args.btc_guide_config)]
    if args.skip_link_reachability:
        policy_lint_command.append("--skip-link-reachability")
    checks["policy_lint"] = run_check(policy_lint_command)

    publish_ready = all(c["exit_code"] == 0 for c in checks.values())
    decision = "PUBLISH_READY" if publish_ready else "HOLD"
    payload = {
        "schema_version": "1.0",
        "decision": decision,
        "checked_at_jst": datetime.now(JST).isoformat(),
        "checks": checks,
        "rule": "いずれかの検査でERRORが1件でもあればHOLD。HOLD時は完成版として配信・投稿しない（SPEC.md §8）。",
    }
    args.result.parent.mkdir(parents=True, exist_ok=True)
    args.result.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"判定: {decision}")
    print(f"監査記録: {args.result}")
    for name, c in checks.items():
        print(f"  - {name}: exit_code={c['exit_code']}")
    if not publish_ready:
        print("配信保留: いずれかの検査エラーを解消してください。")
        return 2
    print("配信可: 監査エラーは検出されませんでした。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
