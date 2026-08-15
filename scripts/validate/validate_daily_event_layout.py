#!/usr/bin/env python3
"""「対象週の注目イベント」セクションの日付別カードを根拠台帳と照合する監査（v4レイアウト向け）。

task #13（移植）。reference/ea-weekly-report-skill/scripts/validate_daily_event_layout.py を移植し、
v4のHTML属性契約（`.ea-date-group[data-ea-date][data-ea-date-event-count]`・
`.ea-event-card[data-ea-event-id][data-ea-event-importance]`のみ）に合わせて期待構造を更新した。
旧スクリプトが要求していたdata-ea-event-date/event-time-jst/event-country/source-url、
時刻順序チェック、時刻未公表ラベルの存在チェックはv4のHTMLに時刻・国・出典URLの機械可読属性が
存在しないため削除している（docs/ledger-schema.md「v4での監査範囲の縮小について」参照。
時刻の並び順の正しさはレンダラー側のユニットテスト＝test/renderer.test.jsの責務とする）。
維持した観点: 日付グループの完全性・昇順・件数属性、イベントID・重要度の台帳照合、重複ID検出。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

JST = ZoneInfo("Asia/Tokyo")


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
    parser = argparse.ArgumentParser(description="EA週次レポートの日付別イベントカードを根拠台帳と照合します（v4レイアウト向け）。")
    parser.add_argument("html", type=Path, help="WordPress用またはプレビュー用HTML")
    parser.add_argument("ledger", type=Path, help="根拠台帳JSON")
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

    expected_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event_id in report_ids:
        event = events_by_id.get(event_id)
        if event is None:
            errors.append(f"report_event_idsにあるIDがeventsにありません: {event_id}")
            continue
        if event.get("status") != "verified":
            errors.append(f"掲載対象が確認済みではありません: {event_id} (status={event.get('status')!r})")
        if event.get("importance") not in (2, 3):
            errors.append(f"掲載対象の重要度が2または3ではありません: {event_id}")
        jst_date = event.get("jst_date")
        if not isinstance(jst_date, str):
            errors.append(f"JST日付を特定できません: {event_id}")
            continue
        try:
            date.fromisoformat(jst_date)
        except ValueError:
            errors.append(f"jst_dateの形式が不正です: {event_id} ({jst_date})")
            continue
        expected_by_date[jst_date].append(event)
    expected_dates = sorted(expected_by_date)
    expected_ids = set(report_ids)

    try:
        soup = BeautifulSoup(args.html.read_text(encoding="utf-8"), "html.parser")
    except OSError as exc:
        return emit(errors + [f"HTMLを読み込めません: {exc}"], warnings, checks, args.output)

    groups = soup.select('.ea-date-group[data-ea-date]')
    if not groups:
        return emit(errors + ["日付別グループ（.ea-date-group[data-ea-date]）がありません"], warnings, checks, args.output)

    group_dates: list[str] = []
    actual_ids: list[str] = []
    for group in groups:
        group_date = group.get("data-ea-date", "")
        group_dates.append(group_date)
        if group_date not in expected_by_date:
            errors.append(f"台帳にないJST日付グループがあります: {group_date}")

        cards = group.select('.ea-event-card[data-ea-event-id]')
        card_ids = [card.get("data-ea-event-id", "") for card in cards]
        actual_ids.extend(card_ids)

        if as_int(group.get("data-ea-date-event-count")) != len(cards):
            errors.append(f"日付グループの件数属性(data-ea-date-event-count)が実カード数と不一致です: {group_date}")
        if group_date in expected_by_date and len(cards) != len(expected_by_date[group_date]):
            errors.append(f"日付グループの件数が台帳と不一致です: {group_date}")

        for card in cards:
            event_id = card.get("data-ea-event-id", "")
            event = events_by_id.get(event_id)
            if event is None:
                errors.append(f"HTMLに台帳外のイベントIDがあります: {event_id}")
                continue
            if event_id not in expected_ids:
                continue
            if event.get("jst_date") != group_date:
                errors.append(f"イベントの親JST日付グループが台帳と不一致です: {event_id}")
            if card.get("data-ea-event-importance") != str(event.get("importance")):
                errors.append(f"重要度属性が台帳と不一致です: {event_id}")

    if group_dates != sorted(group_dates):
        errors.append("日付グループがJST日付順ではありません")
    if set(group_dates) != set(expected_dates):
        missing_dates = sorted(set(expected_dates) - set(group_dates))
        extra_dates = sorted(set(group_dates) - set(expected_dates))
        if missing_dates:
            errors.append("台帳にある掲載対象日がHTMLの日付グループにありません: " + ", ".join(missing_dates))
        if extra_dates:
            errors.append("HTMLに台帳が想定しない日付グループがあります: " + ", ".join(extra_dates))

    duplicate_ids = [item for item, count in Counter(actual_ids).items() if count > 1]
    if duplicate_ids:
        errors.append("HTML内のイベントIDが重複しています: " + ", ".join(sorted(duplicate_ids)))
    if set(actual_ids) != expected_ids:
        missing = sorted(expected_ids - set(actual_ids))
        extra = sorted(set(actual_ids) - expected_ids)
        if missing:
            errors.append("HTMLに未掲載の台帳イベントがあります: " + ", ".join(missing))
        if extra:
            errors.append("HTMLに台帳外のイベントがあります: " + ", ".join(extra))

    all_card_ids = [node.get("data-ea-event-id", "") for node in soup.select('.ea-event-card[data-ea-event-id]')]
    if Counter(all_card_ids) != Counter(actual_ids):
        errors.append("日付別グループ外にイベントカードが存在するか、イベントが重複しています")

    if not errors:
        checks.extend([
            "台帳の掲載対象ID・確認済み状態・重要度(2/3)を確認",
            "JST日付グループの完全性・昇順・件数属性(data-ea-date-event-count)を確認",
            "子カードのイベントID・重要度・親JST日付を台帳と照合",
            "全体のイベント数・日付グループ集合を台帳と照合",
        ])

    return emit(errors, warnings, checks, args.output)


if __name__ == "__main__":
    sys.exit(main())
