#!/usr/bin/env python3
"""Validate a WordPress HTML fragment (v4 layout) against an EA weekly evidence ledger.

task #13（移植）。reference/fx-ea-report-auditor-skill/scripts/validate_report.py を移植し、
v4のHTML属性契約（SPEC.md §6: ルートはreport-meta/layout-version/target-start/section-count/
reader-time-term/halt-guidance、イベントカードはevent-id/event-importanceのみ）に合わせて
期待構造を全面的に更新した。旧スクリプトが要求していたdata-ea-event-date/event-time-jst/
event-country/source-url/canonical/値オブジェクト属性はv4のHTMLに存在しないため削除している
（docs/ledger-schema.md「v4での監査範囲の縮小について」参照）。
維持した検証観点: 禁止タグ・イベントハンドラ・img src検証、プレースホルダー文字列検出、
日付・曜日整合性（対象週の日付集合と突合）、外部リンク形式検証、
HTML×台帳のevent-id集合・重要度突合。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup

WEEKDAYS_JA = ("月", "火", "水", "木", "金", "土", "日")
FORBIDDEN_TAGS = {
    "html", "head", "body", "script", "style", "form",
    "input", "button", "iframe", "object", "embed", "link", "meta",
}
CREATED_DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日[（(]([月火水木金土日])[）)]")
# (?<!年): 「YYYY年M月D日（曜）」形式（作成日等、年付き表記）はCREATED_DATE_REで別途検証するため、
# ここでは年が直前に無い（＝年を伴わない対象週内の日付表記）のみを対象とする
MD_WEEKDAY_RE = re.compile(r"(?<!年)(\d{1,2})月(\d{1,2})日[（(]([月火水木金土日])[）)]")
PLACEHOLDER_PATTERN = re.compile(r"\b(?:TBD|TODO|N/?A)\b", re.IGNORECASE)
EXPECTED_LAYOUT_VERSION = "ea-only-v4"
EXPECTED_SECTION_COUNT = "4"
EXPECTED_READER_TIME_TERM = "日本時間"
EXPECTED_HALT_GUIDANCE = "pre4to12h"


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


def validate_root_meta(soup: BeautifulSoup, report: dict[str, Any], findings: Findings) -> None:
    root = soup.find(attrs={"data-ea-report-meta": True})
    if root is None:
        findings.error("ROOT_META_MISSING", "data-ea-report-meta属性を持つルート要素がありません")
        return
    target_start = report.get("target_start")
    if isinstance(target_start, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", target_start):
        expected_report_meta = f"ea-weekly-{target_start.replace('-', '')}"
        if root.get("data-ea-report-meta") != expected_report_meta:
            findings.error("ROOT_REPORT_META_MISMATCH", f"data-ea-report-metaが期待値と一致しません（期待: {expected_report_meta}）")
    if root.get("data-ea-layout-version") != EXPECTED_LAYOUT_VERSION:
        findings.error("LAYOUT_VERSION_MISMATCH", f"data-ea-layout-versionは{EXPECTED_LAYOUT_VERSION}である必要があります")
    if root.get("data-ea-target-start") != target_start:
        findings.error("ROOT_TARGET_START_MISMATCH", "data-ea-target-startが台帳のtarget_startと一致しません")
    if root.get("data-ea-section-count") != EXPECTED_SECTION_COUNT:
        findings.error("SECTION_COUNT_MISMATCH", f"data-ea-section-countは{EXPECTED_SECTION_COUNT}である必要があります")
    if root.get("data-ea-reader-time-term") != EXPECTED_READER_TIME_TERM:
        findings.error("READER_TIME_TERM_MISMATCH", f"data-ea-reader-time-termは「{EXPECTED_READER_TIME_TERM}」である必要があります")
    if root.get("data-ea-halt-guidance") != EXPECTED_HALT_GUIDANCE:
        findings.error("HALT_GUIDANCE_MISMATCH", f"data-ea-halt-guidanceは{EXPECTED_HALT_GUIDANCE}である必要があります")


def validate_created_date(text: str, report: dict[str, Any], findings: Findings) -> None:
    created_date_ja = report.get("created_date_ja")
    if not isinstance(created_date_ja, str) or not created_date_ja.strip():
        findings.error("CREATED_DATE_MISSING", "台帳にreport.created_date_jaがありません")
        return
    if created_date_ja not in text:
        findings.error("CREATED_DATE_TEXT_MISSING", f"作成日の表示テキストがHTMLに見つかりません: {created_date_ja}")
    match = CREATED_DATE_RE.fullmatch(created_date_ja)
    if not match:
        findings.error("CREATED_DATE_FORMAT_INVALID", f"report.created_date_jaの形式が不正です: {created_date_ja}")
        return
    year, month, day, weekday = match.groups()
    try:
        actual = date(int(year), int(month), int(day))
    except ValueError:
        findings.error("CREATED_DATE_INVALID", f"存在しない日付です: {created_date_ja}")
        return
    expected_weekday = WEEKDAYS_JA[actual.weekday()]
    if weekday != expected_weekday:
        findings.error("CREATED_DATE_WEEKDAY_MISMATCH", f"作成日の曜日が不一致です: {created_date_ja}。正しくは{expected_weekday}曜日です")


def validate_target_week_dates(text: str, ledger: dict[str, Any], findings: Findings) -> None:
    target_dates = ledger.get("target_dates_jst")
    if not isinstance(target_dates, list) or not target_dates:
        findings.error("TARGET_DATES_MISSING", "台帳にtarget_dates_jstがありません")
        return
    expected: dict[tuple[int, int], str] = {}
    for entry in target_dates:
        if not isinstance(entry, dict):
            continue
        try:
            d = date.fromisoformat(str(entry.get("date")))
        except ValueError:
            continue
        expected[(d.month, d.day)] = entry.get("weekday_jst")

    matches = list(MD_WEEKDAY_RE.finditer(text))
    if not matches:
        findings.warning("NO_WEEKDAY_TEXT", "曜日付きの日付を検出できません。対象週の表示を確認してください")
        return
    for match in matches:
        month, day, weekday = match.groups()
        key = (int(month), int(day))
        if key not in expected:
            findings.error("DATE_OUT_OF_TARGET_WEEK", f"対象週外の日付がHTMLに含まれています: {match.group(0)}")
            continue
        if expected[key] != weekday:
            findings.error("WEEKDAY_MISMATCH", f"曜日が不一致です: {match.group(0)}。正しくは{expected[key]}曜日です")


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
        findings.error("HTML_EVENT_MARKERS_MISSING", "イベントのdata-ea-event-id属性がHTMLにありません")
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
        if event is None:
            continue
        importance = event.get("importance")
        if importance is not None and tag.get("data-ea-event-importance") != str(importance):
            findings.error("EVENT_IMPORTANCE_MISMATCH", f"{event_id} の重要度が台帳と一致しません")


def validate_sources(soup: BeautifulSoup, findings: Findings) -> None:
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
    if len(valid_links) != len(set(valid_links)):
        findings.warning("SOURCE_LINK_DUPLICATE", "重複した外部リンクがあります")


def main() -> int:
    parser = argparse.ArgumentParser(description="EA週次レポートのWordPress HTML断片を監査します（v4レイアウト向け）。")
    parser.add_argument("html", type=Path)
    parser.add_argument("--ledger", type=Path, required=True)
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

    ledger = load_ledger(args.ledger)
    report = ledger.get("report") if isinstance(ledger.get("report"), dict) else {}
    validate_root_meta(soup, report, findings)
    text = soup.get_text(" ", strip=True)
    validate_created_date(text, report, findings)
    validate_target_week_dates(text, ledger, findings)
    validate_sources(soup, findings)
    validate_events(soup, ledger, findings)

    findings.print()
    return 2 if findings.errors else 0


if __name__ == "__main__":
    sys.exit(main())
