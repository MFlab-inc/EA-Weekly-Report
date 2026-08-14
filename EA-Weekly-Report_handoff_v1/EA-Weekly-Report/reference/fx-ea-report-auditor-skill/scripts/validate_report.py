#!/usr/bin/env python3
"""Validate a WordPress HTML fragment against an FX/EA evidence ledger."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup

WEEKDAYS_JA = ("月", "火", "水", "木", "金", "土", "日")
FORBIDDEN_TAGS = {
    "html",
    "head",
    "body",
    "script",
    "style",
    "form",
    "input",
    "button",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
}
DATE_WITH_WEEKDAY = re.compile(r"(20\d{2})年(\d{1,2})月(\d{1,2})日[（(]([月火水木金土日])[）)]")
PLACEHOLDER_PATTERN = re.compile(r"\b(?:TBD|TODO|N/?A)\b", re.IGNORECASE)


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
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def normalize_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().replace("−", "-").replace("％", "%")


def load_ledger(path: Path) -> dict[str, Any]:
    try:
        ledger = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"根拠台帳を読み込めません: {exc}")
    if not isinstance(ledger, dict):
        raise SystemExit("根拠台帳の最上位はJSONオブジェクトである必要があります")
    return ledger


def validate_forbidden_tags(soup: BeautifulSoup, findings: Findings) -> None:
    for tag in soup.find_all(list(FORBIDDEN_TAGS)):
        findings.error("FORBIDDEN_HTML_TAG", f"WordPress断片に<{tag.name}>は使用できません")
    for tag in soup.find_all(True):
        for attr in tag.attrs:
            if attr.lower().startswith("on"):
                findings.error("INLINE_EVENT_HANDLER", f"<{tag.name}>にイベントハンドラ属性{attr}があります")
    for img in soup.find_all("img"):
        src = img.get("src")
        if not is_http_url(src):
            findings.error("IMAGE_SOURCE_INVALID", "imgのsrcは公開されたhttp(s) URLである必要があります")


def validate_dates(text: str, year: int, findings: Findings) -> None:
    matches = list(DATE_WITH_WEEKDAY.finditer(text))
    if not matches:
        findings.warning("NO_WEEKDAY_TEXT", "曜日付きの日付を検出できません。作成日・対象期間の表示を確認してください")
        return
    for match in matches:
        found_year, month, day, found_weekday = match.groups()
        if int(found_year) != year:
            findings.error("YEAR_MISMATCH", f"表示年が指定年と一致しません: {match.group(0)}")
            continue
        try:
            actual = date(int(found_year), int(month), int(day))
        except ValueError:
            findings.error("DATE_INVALID", f"存在しない日付です: {match.group(0)}")
            continue
        expected = WEEKDAYS_JA[actual.weekday()]
        if found_weekday != expected:
            findings.error("WEEKDAY_MISMATCH", f"曜日が不一致です: {match.group(0)}。正しくは{expected}曜日です")


def event_map(ledger: dict[str, Any], findings: Findings) -> dict[str, dict[str, Any]]:
    events = ledger.get("events")
    if not isinstance(events, list):
        findings.error("LEDGER_EVENTS_INVALID", "根拠台帳のeventsが配列ではありません")
        return {}
    result: dict[str, dict[str, Any]] = {}
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("id"), str):
            findings.error("LEDGER_EVENT_INVALID", "根拠台帳に不正なイベントがあります")
            continue
        event_id = event["id"]
        if event_id in result:
            findings.error("LEDGER_EVENT_ID_DUPLICATE", f"根拠台帳にイベントIDの重複があります: {event_id}")
        result[event_id] = event
    return result


def expected_jst_parts(event: dict[str, Any]) -> tuple[str | None, str | None]:
    jst_datetime = event.get("jst_datetime")
    if not isinstance(jst_datetime, str) or "T" not in jst_datetime:
        return None, None
    date_part, time_part = jst_datetime.split("T", 1)
    return date_part, time_part[:5]


def validate_event_occurrence(tag: Any, event: dict[str, Any], findings: Findings) -> None:
    event_id = event["id"]
    expected_date, expected_time = expected_jst_parts(event)
    actual_date = tag.get("data-ea-event-date")
    actual_time = tag.get("data-ea-event-time-jst")
    if expected_date:
        if actual_date != expected_date:
            findings.error("EVENT_DATE_MISMATCH", f"{event_id} のJST日付が台帳と一致しません")
        if actual_time != expected_time:
            findings.error("EVENT_TIME_MISMATCH", f"{event_id} のJST時刻が台帳と一致しません")
    elif actual_date or actual_time:
        findings.error("EVENT_UNPUBLISHED_TIME", f"{event_id} は公式時刻未確認ですがHTMLに日時が設定されています")
    country = event.get("country_or_region")
    if country and tag.get("data-ea-event-country") != country:
        findings.error("EVENT_COUNTRY_MISMATCH", f"{event_id} の国・地域が台帳と一致しません")
    importance = event.get("importance")
    if importance is not None and tag.get("data-ea-event-importance") != str(importance):
        findings.error("EVENT_IMPORTANCE_MISMATCH", f"{event_id} の重要度が台帳と一致しません")
    source = event.get("source")
    expected_source = source.get("url") if isinstance(source, dict) else None
    if expected_source and tag.get("data-ea-source-url") != expected_source:
        findings.error("EVENT_SOURCE_MISMATCH", f"{event_id} の一次情報URLが台帳と一致しません")


def validate_canonical_values(tag: Any, event: dict[str, Any], findings: Findings) -> None:
    event_id = event["id"]
    fields = {field.get("data-ea-field"): field for field in tag.find_all(attrs={"data-ea-field": True})}
    for field_name in ("previous", "revised", "forecast", "result"):
        field = fields.get(field_name)
        if field is None:
            findings.error("EVENT_VALUE_FIELD_MISSING", f"{event_id} の{field_name}欄がcanonicalイベント要素にありません")
            continue
        expected_obj = event.get(field_name)
        if not isinstance(expected_obj, dict):
            findings.error("LEDGER_VALUE_INVALID", f"台帳の{event_id}.{field_name}が不正です")
            continue
        expected_value = normalize_value(expected_obj.get("value"))
        expected_status = expected_obj.get("value_status")
        if normalize_value(field.get("data-ea-value")) != expected_value:
            findings.error("EVENT_VALUE_MISMATCH", f"{event_id} の{field_name}値が台帳と一致しません")
        if field.get("data-ea-value-status") != expected_status:
            findings.error("EVENT_VALUE_STATUS_MISMATCH", f"{event_id} の{field_name}値の状態が台帳と一致しません")


def validate_events(soup: BeautifulSoup, ledger: dict[str, Any], findings: Findings) -> None:
    expected_events = event_map(ledger, findings)
    report_ids = ledger.get("report_event_ids")
    if not isinstance(report_ids, list) or not all(isinstance(item, str) for item in report_ids):
        findings.error("LEDGER_REPORT_IDS_INVALID", "台帳のreport_event_idsが不正です")
        return
    expected_ids = set(report_ids)
    event_tags = soup.find_all(attrs={"data-ea-event-id": True})
    found_ids = {tag.get("data-ea-event-id") for tag in event_tags}
    if expected_ids and not event_tags:
        findings.error("HTML_EVENT_MARKERS_MISSING", "重要イベントのdata-ea-event-id属性がHTMLにありません")
        return
    missing_ids = sorted(expected_ids - found_ids)
    unknown_ids = sorted(found_ids - set(expected_events))
    if missing_ids:
        findings.error("HTML_EVENT_MISSING", f"HTMLに未掲載の台帳イベントがあります: {', '.join(missing_ids)}")
    if unknown_ids:
        findings.error("HTML_EVENT_UNKNOWN", f"HTMLに台帳未登録イベントがあります: {', '.join(unknown_ids)}")

    for tag in event_tags:
        event_id = tag.get("data-ea-event-id")
        event = expected_events.get(event_id)
        if event:
            validate_event_occurrence(tag, event, findings)
            if tag.get("data-ea-canonical") == "true":
                validate_canonical_values(tag, event, findings)

    canonical_ids = {
        tag.get("data-ea-event-id")
        for tag in event_tags
        if tag.get("data-ea-canonical") == "true"
    }
    if expected_ids - canonical_ids:
        findings.error("CANONICAL_EVENT_MISSING", "各掲載イベントにdata-ea-canonical=\"true\"の詳細要素が必要です")

    expected_important = sum(
        1
        for event_id in expected_ids
        if isinstance(expected_events.get(event_id), dict)
        and expected_events[event_id].get("importance") in {2, 3}
    )
    expected_high = sum(
        1
        for event_id in expected_ids
        if isinstance(expected_events.get(event_id), dict)
        and expected_events[event_id].get("importance") == 3
    )
    count_markers = soup.find_all(attrs={"data-ea-report-meta": True})
    if not count_markers:
        findings.error("EVENT_COUNT_MARKER_MISSING", "data-ea-report-meta属性を持つ件数マーカーがありません")
    else:
        for marker in count_markers:
            if marker.get("data-ea-event-count") != str(len(expected_ids)):
                findings.error("EVENT_COUNT_MISMATCH", "data-ea-event-countがreport_event_ids件数と一致しません")
            if marker.get("data-ea-important-count") != str(expected_important):
                findings.error("IMPORTANT_COUNT_MISMATCH", "data-ea-important-countが★★以上の実数と一致しません")
            if marker.get("data-ea-high-importance-count") != str(expected_high):
                findings.error("HIGH_IMPORTANCE_COUNT_MISMATCH", "data-ea-high-importance-countが★★★の実数と一致しません")


def validate_sources(soup: BeautifulSoup, findings: Findings, require_sources: bool) -> None:
    links = soup.find_all("a", href=True)
    valid_links = []
    for link in links:
        href = link.get("href")
        if not is_http_url(href):
            findings.error("SOURCE_LINK_INVALID", f"外部リンクがhttp(s) URLではありません: {href}")
            continue
        if ".invalid" in urlparse(href).netloc:
            findings.error("SOURCE_LINK_PLACEHOLDER", f"仮URLが残っています: {href}")
        valid_links.append(href)
    if require_sources and not valid_links:
        findings.error("SOURCE_LINKS_MISSING", "出典リンクが1件もありません")
    if len(valid_links) != len(set(valid_links)):
        findings.warning("SOURCE_LINK_DUPLICATE", "重複した出典リンクがあります")


def main() -> int:
    parser = argparse.ArgumentParser(description="FX・EAレポートのWordPress HTML断片を監査します。")
    parser.add_argument("html", type=Path)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--require-sources", action="store_true")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    try:
        html = args.html.read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"HTMLを読み込めません: {exc}")
    findings = Findings()
    if PLACEHOLDER_PATTERN.search(html):
        findings.error("PLACEHOLDER_TEXT", "TBD、TODO、N/Aなどの未解決プレースホルダーが残っています")
    soup = BeautifulSoup(html, "html.parser")
    validate_forbidden_tags(soup, findings)
    validate_dates(soup.get_text(" ", strip=True), args.year, findings)
    validate_sources(soup, findings, args.require_sources)
    ledger = load_ledger(args.ledger)
    validate_events(soup, ledger, findings)
    if args.strict and not soup.find_all(attrs={"data-ea-event-id": True}):
        findings.error("STRICT_MARKERS_REQUIRED", "strictモードではイベント監査属性が必須です")
    findings.print()
    return 2 if findings.errors else 0


if __name__ == "__main__":
    sys.exit(main())
