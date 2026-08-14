#!/usr/bin/env python3
"""Run the evidence-ledger and WordPress HTML checks as a publish/hold gate."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPT_DIR = Path(__file__).resolve().parent
JST = ZoneInfo("Asia/Tokyo")


def run_check(command: list[str]) -> dict[str, object]:
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    return {
        "command": command,
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="FX・EAレポートの公開可否を自動判定します。"
    )
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--html", type=Path, required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--require-template", action="store_true")
    args = parser.parse_args()

    ledger_command = [
        sys.executable,
        str(SCRIPT_DIR / "validate_ledger.py"),
        str(args.ledger),
        "--strict",
    ]
    if args.require_template:
        ledger_command.append("--require-template")
    ledger_result = run_check(ledger_command)

    report_command = [
        sys.executable,
        str(SCRIPT_DIR / "validate_report.py"),
        str(args.html),
        "--ledger",
        str(args.ledger),
        "--year",
        str(args.year),
        "--require-sources",
        "--strict",
    ]
    report_result = run_check(report_command)

    publish_ready = ledger_result["exit_code"] == 0 and report_result["exit_code"] == 0
    decision = "PUBLISH_READY" if publish_ready else "HOLD"
    payload = {
        "schema_version": "1.0",
        "decision": decision,
        "checked_at_jst": datetime.now(JST).isoformat(),
        "ledger": ledger_result,
        "report": report_result,
        "rule": "ERRORが1件でもあればHOLD。HOLD時は完成版として配信・投稿しない。",
    }
    args.result.parent.mkdir(parents=True, exist_ok=True)
    args.result.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"判定: {decision}")
    print(f"監査記録: {args.result}")
    if not publish_ready:
        print("配信保留: 根拠台帳またはWordPress HTMLの監査エラーを解消してください。")
        return 2
    print("配信可: 監査エラーは検出されませんでした。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
