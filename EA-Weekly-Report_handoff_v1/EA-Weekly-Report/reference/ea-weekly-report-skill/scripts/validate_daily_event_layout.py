#!/usr/bin/env python3
"""EA週次レポートSECTION 04の日付別カードを根拠台帳と照合する汎用監査。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

JST = ZoneInfo("Asia/Tokyo")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def normalized_url(value: str | None) -> str:
    if not value:
        return ""
    parts = urlsplit(value.strip())
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), parts.query, ""))


def as_int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"台帳を読み込めません: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("台帳のルートはJSONオブジェクトである必要があります")
    return data


def jst_schedule(event: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    """台帳からJSTの日付と、確定済みなら時刻を返す。未公表時刻はNoneを返す。"""
    time_status = str(event.get("time_status", ""))
    raw_jst_datetime = event.get("jst_datetime")
    if raw_jst_datetime:
        try:
            parsed = datetime.fromisoformat(str(raw_jst_datetime).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None, None, "jst_datetimeにタイムゾーン情報がありません"
            jst_value = parsed.astimezone(JST)
        except ValueError:
            return None, None, "jst_datetimeの形式が不正です"
        return jst_value.date().isoformat(), jst_value.strftime("%H:%M"), None

    explicit_date = str(event.get("jst_date", ""))
    if DATE_RE.fullmatch(explicit_date):
        explicit_time = str(event.get("jst_time", ""))
        if time_status == "verified":
            if not TIME_RE.fullmatch(explicit_time):
                return None, None, "確定時刻イベントにはjst_datetimeまたはjst_date+jst_timeが必要です"
            return explicit_date, explicit_time, None
        return explicit_date, None, None

    # 日本時間で開催され、時刻が未公表のイベントだけはevent_dateをJST日付として扱う。
    if event.get("official_timezone") == "Asia/Tokyo" and DATE_RE.fullmatch(str(event.get("event_date", ""))):
        local_time = str(event.get("event_time", ""))
        if time_status == "verified" and TIME_RE.fullmatch(local_time):
            return str(event["event_date"]), local_time, None
        return str(event["event_date"]), None, None

    return None, None, "海外イベントにはjst_datetimeまたはjst_dateが必要です"


def emit(errors: list[str], warnings: list[str], checks: list[str], output: Path | None) -> int:
    result = {
        "status": "PASS" if not errors else "FAIL",
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "generated_at_jst": datetime.now(JST).isoformat(timespec="seconds"),
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if output:
        output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if not errors else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="EA週次レポートの日付別イベントカードを根拠台帳と照合します。"
    )
    parser.add_argument("html", type=Path, help="WordPress用またはプレビュー用HTML")
    parser.add_argument("ledger", type=Path, help="ea_weekly_evidence_ledger.json")
    parser.add_argument("--output", type=Path, help="JSON監査結果の保存先（任意）")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    checks: list[str] = []

    try:
        ledger = load_json(args.ledger)
    except ValueError as exc:
        return emit([str(exc)], warnings, checks, args.output)

    event_list = ledger.get("events")
    report_ids = ledger.get("report_event_ids")
    if not isinstance(event_list, list) or not isinstance(report_ids, list) or not report_ids:
        return emit(["台帳にevents配列またはreport_event_ids配列がありません"], warnings, checks, args.output)

    events_by_id: dict[str, dict[str, Any]] = {}
    for event in event_list:
        event_id = event.get("id") if isinstance(event, dict) else None
        if not event_id:
            errors.append("IDのないイベントが台帳にあります")
        elif event_id in events_by_id:
            errors.append(f"台帳のイベントIDが重複しています: {event_id}")
        else:
            events_by_id[event_id] = event

    if len(set(report_ids)) != len(report_ids):
        errors.append("report_event_idsに重複があります")

    expected_events: list[dict[str, Any]] = []
    jst_by_id: dict[str, tuple[str, str | None]] = {}
    for event_id in report_ids:
        event = events_by_id.get(event_id)
        if event is None:
            errors.append(f"report_event_idsにあるIDがeventsにありません: {event_id}")
            continue
        if event.get("status") != "verified":
            errors.append(f"掲載対象が確認済みではありません: {event_id} (status={event.get('status')!r})")
        if event.get("importance") != 3:
            errors.append(f"掲載対象の重要度が★★★ではありません: {event_id}")
        source = event.get("source") or {}
        if not normalized_url(source.get("url")):
            errors.append(f"一次情報URLがありません: {event_id}")
        jst_date, jst_time, schedule_error = jst_schedule(event)
        if schedule_error or not jst_date:
            errors.append(f"JST日時を特定できません: {event_id} ({schedule_error or '不明'})")
        else:
            jst_by_id[event_id] = (jst_date, jst_time)
        expected_events.append(event)

    try:
        soup = BeautifulSoup(args.html.read_text(encoding="utf-8"), "html.parser")
    except OSError as exc:
        return emit(errors + [f"HTMLを読み込めません: {exc}"], warnings, checks, args.output)

    groups = soup.select('[data-ea-date-group="true"]')
    if not groups:
        return emit(errors + ["日付別親カード[data-ea-date-group=true]がありません"], warnings, checks, args.output)

    expected_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in expected_events:
        event_id = str(event["id"])
        if event_id in jst_by_id:
            expected_by_date[jst_by_id[event_id][0]].append(event)
    expected_dates = sorted(expected_by_date)

    root = soup.select_one('[data-ea-date-group-count]')
    if root is None:
        errors.append("全体の日付グループ数属性[data-ea-date-group-count]がありません")
    else:
        if as_int(root.get("data-ea-date-group-count")) != len(expected_dates):
            errors.append("data-ea-date-group-countが台帳のJST日付数と一致しません")
        if as_int(root.get("data-ea-event-count")) != len(expected_events):
            errors.append("data-ea-event-countが台帳の掲載対象件数と一致しません")
        if as_int(root.get("data-ea-important-count")) != len(expected_events):
            errors.append("data-ea-important-countが★★★掲載対象件数と一致しません")

    group_dates: list[str] = []
    actual_ids: list[str] = []
    for group in groups:
        date = group.get("data-ea-date", "")
        group_dates.append(date)
        if date not in expected_by_date:
            errors.append(f"台帳にないJST日付グループがあります: {date}")
        cards = group.select('[data-ea-event-id]')
        card_ids = [card.get("data-ea-event-id", "") for card in cards]
        actual_ids.extend(card_ids)

        if as_int(group.get("data-ea-date-event-count")) != len(cards):
            errors.append(f"日付グループの件数属性が実カード数と不一致です: {date}")
        if date in expected_by_date and len(cards) != len(expected_by_date[date]):
            errors.append(f"日付グループの件数が台帳と不一致です: {date}")

        heading = group.select_one('.ea-date-heading')
        if heading is None or not heading.get_text(" ", strip=True):
            errors.append(f"日付グループ見出しがありません: {date}")
        count_badge = group.select_one('.ea-date-count')
        if count_badge is None or "★★★" not in count_badge.get_text(" ", strip=True):
            errors.append(f"★★★件数バッジがありません: {date}")

        known_time_positions: list[tuple[int, str, str]] = []
        unknown_time_positions: list[tuple[int, str]] = []
        for index, card in enumerate(cards):
            event_id = card.get("data-ea-event-id", "")
            event = events_by_id.get(event_id)
            if event is None:
                errors.append(f"HTMLに台帳外のイベントIDがあります: {event_id}")
                continue
            if event_id not in jst_by_id:
                continue
            expected_date, expected_time = jst_by_id[event_id]
            if expected_date != date:
                errors.append(f"イベントの親JST日付グループが台帳と不一致です: {event_id}")
            if card.get("data-ea-event-importance") != str(event.get("importance")):
                errors.append(f"重要度属性が台帳と不一致です: {event_id}")
            expected_url = normalized_url((event.get("source") or {}).get("url"))
            if normalized_url(card.get("data-ea-source-url")) != expected_url:
                errors.append(f"一次情報URL属性が台帳と不一致です: {event_id}")
            if card.select_one('.ea-event-date-label') is not None:
                errors.append(f"子カード内に重複する日付ラベルがあります: {event_id}")

            html_time = card.get("data-ea-event-time-jst")
            time_label = card.select_one('.ea-event-time')
            if expected_time:
                if html_time != expected_time:
                    errors.append(f"確定JST時刻が台帳と不一致です: {event_id}")
                known_time_positions.append((index, expected_time, event_id))
            else:
                if html_time:
                    errors.append(f"時刻未公表イベントに固定JST時刻属性があります: {event_id}")
                if time_label is None or not time_label.get_text(" ", strip=True):
                    errors.append(f"時刻未公表イベントの時刻注記がありません: {event_id}")
                unknown_time_positions.append((index, event_id))

        known_times = [item[1] for item in known_time_positions]
        if known_times != sorted(known_times):
            errors.append(f"確定JST時刻のイベントがJST時刻順ではありません: {date}")
        if known_time_positions and unknown_time_positions:
            last_known = max(item[0] for item in known_time_positions)
            if any(item[0] < last_known for item in unknown_time_positions):
                errors.append(f"時刻未公表イベントが確定時刻イベントより前にあります: {date}")

    if group_dates != sorted(group_dates):
        errors.append("日付グループがJST日付順ではありません")
    if set(group_dates) != set(expected_dates):
        errors.append("日付グループの集合が台帳の掲載対象JST日と一致しません")

    duplicate_ids = [item for item, count in Counter(actual_ids).items() if count > 1]
    if duplicate_ids:
        errors.append("HTML内のイベントIDが重複しています: " + ", ".join(sorted(duplicate_ids)))
    if set(actual_ids) != set(report_ids):
        missing = sorted(set(report_ids) - set(actual_ids))
        extra = sorted(set(actual_ids) - set(report_ids))
        if missing:
            errors.append("HTMLに未掲載の台帳イベントがあります: " + ", ".join(missing))
        if extra:
            errors.append("HTMLに台帳外のイベントがあります: " + ", ".join(extra))

    all_card_ids = [node.get("data-ea-event-id", "") for node in soup.select('[data-ea-event-id]')]
    if Counter(all_card_ids) != Counter(actual_ids):
        errors.append("日付別グループ外にイベントカードが存在するか、イベントが重複しています")

    if not errors:
        checks.extend([
            "台帳の掲載対象ID・確認済み状態・★★★重要度・一次情報URLを確認",
            "JST日付グループの完全性・昇順・件数属性を確認",
            "子カードのイベントID・重要度・一次情報URL・親JST日付を台帳と照合",
            "確定JST時刻の昇順と時刻未公表イベントの安全な表示を確認",
            "全体のイベント数・重要度数・日付グループ数を台帳と照合",
        ])

    return emit(errors, warnings, checks, args.output)


if __name__ == "__main__":
    sys.exit(main())
