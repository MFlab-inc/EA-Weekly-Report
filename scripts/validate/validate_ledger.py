#!/usr/bin/env python3
"""Validate the evidence ledger used for EA weekly reports (v4 layout).

task #13（移植）。reference/fx-ea-report-auditor-skill/scripts/validate_ledger.py を移植し、
docs/ledger-schema.md のv4向け簡素化スキーマ（market_prices/market_holidays・値オブジェクト・
approved_template_pathを削除、event_typeをevent_kindへ統一）に合わせて期待構造を更新した。
検証観点（台帳整合・JST変換の再計算一致・重複ID検出・掲載対象の状態検査・open_issuesのフェールクローズ）
は旧スクリプトから維持している。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

JST = ZoneInfo("Asia/Tokyo")
WEEKDAYS_JA = ("月", "火", "水", "木", "金", "土", "日")
TIME_STATUSES = {"verified", "not_published"}
EVENT_STATUSES = {"verified", "pending", "conflict"}
IMPORTANCE_VALUES = {2, 3}


class Findings:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []

    def error(self, code: str, message: str) -> None:
        self.errors.append((code, message))

    def warning(self, code: str, message: str) -> None:
        self.warnings.append((code, message))

    def print(self) -> None:
        for code, message in self.errors:
            print(f"ERROR [{code}] {message}")
        for code, message in self.warnings:
            print(f"WARNING [{code}] {message}")
        status = "配信保留" if self.errors else "配信可"
        print(f"判定: {status}")
        print(f"ERROR: {len(self.errors)} / WARNING: {len(self.warnings)}")


def is_http_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    from urllib.parse import urlparse

    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def parse_iso_date(value: Any, findings: Findings, field: str) -> date | None:
    if not isinstance(value, str):
        findings.error("DATE_MISSING", f"{field} がISO日付ではありません")
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        findings.error("DATE_INVALID", f"{field} がISO日付ではありません: {value}")
        return None


def parse_iso_datetime(value: Any, findings: Findings, field: str) -> datetime | None:
    if not isinstance(value, str):
        findings.error("DATETIME_MISSING", f"{field} がISO日時ではありません")
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        findings.error("DATETIME_INVALID", f"{field} がISO日時ではありません: {value}")
        return None
    if parsed.tzinfo is None:
        findings.error("TIMEZONE_MISSING", f"{field} にタイムゾーンオフセットがありません")
        return None
    return parsed


def expected_dates(start: date, end: date) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    cursor = start
    while cursor <= end:
        result.append({"date": cursor.isoformat(), "weekday_jst": WEEKDAYS_JA[cursor.weekday()]})
        cursor += timedelta(days=1)
    return result


def validate_source(item_id: str, source: Any, findings: Findings) -> None:
    if not isinstance(source, dict):
        findings.error("SOURCE_MISSING", f"{item_id} にsourceがありません")
        return
    if not isinstance(source.get("publisher"), str) or not source.get("publisher").strip():
        findings.error("SOURCE_PUBLISHER_MISSING", f"{item_id}.source.publisher がありません")
    if not is_http_url(source.get("url")):
        findings.error("SOURCE_URL_INVALID", f"{item_id}.source.url が有効なhttp(s) URLではありません")
    parse_iso_datetime(source.get("checked_at"), findings, f"{item_id}.source.checked_at")


def validate_event(event: Any, findings: Findings) -> str | None:
    if not isinstance(event, dict):
        findings.error("EVENT_OBJECT_INVALID", "events内にオブジェクト以外が含まれています")
        return None
    event_id = event.get("id")
    if not isinstance(event_id, str) or not event_id.strip():
        findings.error("EVENT_ID_MISSING", "events内にidがないイベントがあります")
        return None
    for key in ("event_name", "country_or_region", "currency", "event_kind", "official_timezone", "time_status", "status"):
        if key not in event:
            findings.error("EVENT_FIELD_MISSING", f"{event_id}.{key} がありません")

    time_status = event.get("time_status")
    if time_status not in TIME_STATUSES:
        findings.error("TIME_STATUS_INVALID", f"{event_id}.time_status が不正です: {time_status}")

    local_dt_value = event.get("official_local_datetime")
    jst_dt_value = event.get("jst_datetime")
    timezone_name = event.get("official_timezone")
    if time_status == "verified":
        official_zone: ZoneInfo | None = None
        try:
            official_zone = ZoneInfo(timezone_name)
        except (TypeError, ZoneInfoNotFoundError):
            findings.error("TIMEZONE_INVALID", f"{event_id}.official_timezone が無効です: {timezone_name}")
        local_dt = parse_iso_datetime(local_dt_value, findings, f"{event_id}.official_local_datetime")
        jst_dt = parse_iso_datetime(jst_dt_value, findings, f"{event_id}.jst_datetime")
        if local_dt and jst_dt and official_zone:
            converted = local_dt.astimezone(JST)
            if converted != jst_dt.astimezone(JST):
                findings.error(
                    "JST_CONVERSION_MISMATCH",
                    f"{event_id} のJST変換が一致しません: 期待 {converted.isoformat()} / 台帳 {jst_dt.astimezone(JST).isoformat()}",
                )
            expected_weekday = WEEKDAYS_JA[converted.date().weekday()]
            if event.get("weekday_jst") != expected_weekday:
                findings.error("WEEKDAY_MISMATCH", f"{event_id}.weekday_jst は {expected_weekday} である必要があります")
            if event.get("jst_date") != converted.date().isoformat():
                findings.error("JST_DATE_MISMATCH", f"{event_id}.jst_date がjst_datetimeの日付と一致しません")
    else:
        if local_dt_value is not None or jst_dt_value is not None:
            findings.error("UNPUBLISHED_TIME_HAS_VALUE", f"{event_id} は時刻未公表ですが日時値が設定されています")
        if not isinstance(event.get("jst_date"), str):
            findings.error("EVENT_FIELD_MISSING", f"{event_id}.jst_date がありません（時刻未公表でも対象週内の日付は必須）")
        if not isinstance(event.get("weekday_jst"), str):
            findings.error("EVENT_FIELD_MISSING", f"{event_id}.weekday_jst がありません")

    if event.get("status") not in EVENT_STATUSES:
        findings.error("EVENT_STATUS_INVALID", f"{event_id}.status が不正です: {event.get('status')}")
    importance = event.get("importance")
    if importance not in IMPORTANCE_VALUES:
        findings.error("IMPORTANCE_INVALID", f"{event_id}.importance は2または3である必要があります（0=非掲載は台帳に載せない）")
    if importance is not None and not event.get("importance_source"):
        findings.error("IMPORTANCE_SOURCE_MISSING", f"{event_id} はimportance_sourceがありません")
    validate_source(event_id, event.get("source"), findings)
    if event.get("status") in {"pending", "conflict"}:
        findings.error("EVENT_NOT_PUBLISHABLE", f"{event_id} はstatus={event.get('status')}のため配信できません")
    return event_id


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"台帳を読み込めません: {exc}")
    if not isinstance(data, dict):
        raise SystemExit("台帳JSONの最上位はオブジェクトである必要があります")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="EA週次レポート根拠台帳を検証します（v4レイアウト向け）。")
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--strict", action="store_true", help="警告を出力し、公開前の必須検査を強化します")
    args = parser.parse_args()

    ledger = load_json(args.ledger)
    findings = Findings()
    if ledger.get("schema_version") != "1.0":
        findings.error("SCHEMA_VERSION", "schema_version は1.0である必要があります")
    report = ledger.get("report")
    if not isinstance(report, dict):
        findings.error("REPORT_MISSING", "reportオブジェクトがありません")
        findings.print()
        return 2
    start = parse_iso_date(report.get("target_start"), findings, "report.target_start")
    end = parse_iso_date(report.get("target_end"), findings, "report.target_end")
    if start and end and end < start:
        findings.error("TARGET_RANGE_INVALID", "対象終了日は対象開始日以後である必要があります")
    if report.get("display_timezone") != "Asia/Tokyo":
        findings.error("DISPLAY_TIMEZONE_INVALID", "表示基準タイムゾーンはAsia/Tokyoである必要があります")
    if not isinstance(report.get("created_date_ja"), str) or not report.get("created_date_ja").strip():
        findings.error("CREATED_DATE_MISSING", "report.created_date_ja がありません")
    parse_iso_datetime(report.get("research_started_at"), findings, "report.research_started_at")
    if start and end:
        if ledger.get("target_dates_jst") != expected_dates(start, end):
            findings.error("TARGET_WEEKDAY_MISMATCH", "target_dates_jstの日付または曜日がプログラム再計算結果と一致しません")

    events = ledger.get("events")
    if not isinstance(events, list):
        findings.error("EVENTS_INVALID", "eventsは配列である必要があります")
        events = []
    event_ids = [event_id for event_id in (validate_event(event, findings) for event in events) if event_id]
    duplicates = [item for item, count in Counter(event_ids).items() if count > 1]
    for event_id in duplicates:
        findings.error("EVENT_ID_DUPLICATE", f"events内でIDが重複しています: {event_id}")

    report_ids = ledger.get("report_event_ids")
    if not isinstance(report_ids, list) or not all(isinstance(item, str) and item for item in report_ids):
        findings.error("REPORT_EVENT_IDS_INVALID", "report_event_idsは空でない文字列の配列である必要があります")
        report_ids = []
    if len(report_ids) != len(set(report_ids)):
        findings.error("REPORT_EVENT_IDS_DUPLICATE", "report_event_idsに重複があります")
    missing_events = sorted(set(report_ids) - set(event_ids))
    if missing_events:
        findings.error("REPORT_EVENT_ID_UNKNOWN", f"report_event_idsに台帳未登録IDがあります: {', '.join(missing_events)}")

    open_issues = ledger.get("open_issues")
    if not isinstance(open_issues, list):
        findings.error("OPEN_ISSUES_INVALID", "open_issuesは配列である必要があります")
    else:
        for issue in open_issues:
            if not isinstance(issue, dict):
                findings.error("OPEN_ISSUE_OBJECT_INVALID", "open_issues内にオブジェクト以外があります")
                continue
            severity = issue.get("severity")
            if severity in {"error", "blocker"}:
                findings.error("OPEN_ISSUE_BLOCKING", f"未解決の{severity}: {issue.get('message', '(説明なし)')}")
            elif severity not in {"warning", "info"}:
                findings.error("OPEN_ISSUE_SEVERITY_INVALID", "open_issues.severityが不正です")

    if args.strict and not events:
        findings.warning("NO_EVENTS", "eventsが空です。経済カレンダー更新を必要とするレポートでは内容を確認してください")
    findings.print()
    return 2 if findings.errors else 0


if __name__ == "__main__":
    sys.exit(main())
