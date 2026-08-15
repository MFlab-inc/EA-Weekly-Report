#!/usr/bin/env python3
"""Create an empty, auditable evidence ledger for an FX/EA report."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")
WEEKDAYS_JA = ("月", "火", "水", "木", "金", "土", "日")


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"ISO日付（YYYY-MM-DD）で指定してください: {value}") from exc


def parse_timestamp(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"ISO 8601日時（例: 2026-07-18T11:00:00+09:00）で指定してください: {value}"
        ) from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("タイムゾーンオフセットを含む日時を指定してください")
    return parsed.astimezone(JST).isoformat()


def date_rows(start: date, end: date) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    cursor = start
    while cursor <= end:
        rows.append(
            {
                "date": cursor.isoformat(),
                "weekday_jst": WEEKDAYS_JA[cursor.weekday()],
            }
        )
        cursor += timedelta(days=1)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="FX・EAレポートの非公開根拠台帳を初期化します。"
    )
    parser.add_argument("--target-start", required=True, type=parse_date)
    parser.add_argument("--target-end", required=True, type=parse_date)
    parser.add_argument("--research-started-at", required=True, type=parse_timestamp)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--report-type",
        default="ea_weekly",
        choices=("ea_weekly", "fx_daily", "fx_weekly", "ea_calendar_update"),
    )
    parser.add_argument("--template-path", default=None)
    args = parser.parse_args()

    if args.target_end < args.target_start:
        parser.error("--target-end は --target-start 以後にしてください")

    ledger = {
        "schema_version": "1.0",
        "report": {
            "report_type": args.report_type,
            "target_start": args.target_start.isoformat(),
            "target_end": args.target_end.isoformat(),
            "target_dates_jst": date_rows(args.target_start, args.target_end),
            "display_timezone": "Asia/Tokyo",
            "research_started_at": args.research_started_at,
            "generated_at": None,
            "approved_template_path": args.template_path,
        },
        "events": [],
        "market_prices": [],
        "market_holidays": [],
        "report_event_ids": [],
        "source_checks": [],
        "open_issues": [],
        "instructions": {
            "do_not_infer_missing_values": True,
            "required_statuses_before_publish": ["verified", "not_applicable"],
            "note": "イベント・市況値・休日情報は一次情報で確認してから入力する。空欄を推測で埋めない。",
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"根拠台帳を作成しました: {args.output}")
    print(f"対象期間: {args.target_start.isoformat()}〜{args.target_end.isoformat()} (JST)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
