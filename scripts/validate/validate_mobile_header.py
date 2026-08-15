#!/usr/bin/env python3
"""EA週次レポートをスマホ幅5種で検証する（v4レイアウト向け・横スクロール検出中心）。

task #13（移植）。reference/ea-weekly-report-skill/scripts/validate_mobile_header.py を移植。
旧スクリプトはヘッダーの`header.site-header`・`.header-subtitle span`・`.logo-text p span`・
`.report-date`等のクラスセレクタに依存していたが、v4レイアウト（templates/design-mock_v1.2.html）の
ヘッダーは全てインラインスタイルの<div>でクラス名を持たないため、これらのセレクタは存在しない
（実測確認2026-08-15）。本スクリプトはテキストベースのロケータへ全面的に置き換え、検証観点を
HANDOFF.md §1検収基準3「モバイル幅320/360/375/390/414pxで横スクロールが発生しない」に合わせて
ページ全体の水平スクロール検出を主眼に据えた（ヘッダーだけでなく全セクションが対象になるため、
旧スクリプトより広い範囲を検証する）。ヘッダーの主要テキスト（タイトル・サブタイトル・作成日）が
各幅でビューポート内に収まっていることも合わせて確認する。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

WIDTHS = (320, 360, 375, 390, 414)
HEADER_TITLE_TEXT = "EAユーザー向け週次レポート"
HEADER_SUBTITLE_LINE1 = "WEEKLY ECONOMIC CALENDAR"
HEADER_REPORT_TYPE_TEXT = "WEEKLY REPORT"
HEADER_DATE_PREFIX = "作成日："


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path, help="検証対象HTML")
    parser.add_argument("--output-dir", type=Path, default=Path("mobile_layout_validation"))
    parser.add_argument("--chromium", default="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
    parser.add_argument("--no-screenshots", action="store_true", help="スクリーンショット保存を省略する（CI高速化用）")
    return parser.parse_args()


def rect_of(locator) -> dict | None:
    if locator.count() == 0:
        return None
    box = locator.first.bounding_box()
    if box is None:
        return None
    return {"left": box["x"], "right": box["x"] + box["width"], "top": box["y"], "bottom": box["y"] + box["height"]}


def main() -> int:
    args = parse_args()
    html = args.html.resolve()
    if not html.exists():
        raise FileNotFoundError(html)
    if not args.no_screenshots:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=args.chromium, args=["--no-sandbox"])
        for width in WIDTHS:
            page = browser.new_page(viewport={"width": width, "height": 900}, device_scale_factor=2)
            page.goto(html.as_uri(), wait_until="domcontentloaded")
            page.wait_for_timeout(200)

            scroll_width = page.evaluate("document.documentElement.scrollWidth")
            client_width = page.evaluate("document.documentElement.clientWidth")
            no_horizontal_scroll = scroll_width <= client_width + 1  # 1pxの丸め誤差を許容

            checks = {"no_horizontal_scroll": no_horizontal_scroll}
            items = {}
            for key, text in (
                ("title", HEADER_TITLE_TEXT),
                ("subtitle_line1", HEADER_SUBTITLE_LINE1),
                ("report_type", HEADER_REPORT_TYPE_TEXT),
            ):
                locator = page.get_by_text(text, exact=False)
                rect = rect_of(locator)
                items[key] = rect
                checks[f"{key}_found"] = rect is not None
                checks[f"{key}_in_viewport"] = bool(rect and rect["left"] >= 0 and rect["right"] <= width + 1)

            date_locator = page.locator(f"text=/{HEADER_DATE_PREFIX}/")
            date_rect = rect_of(date_locator)
            items["report_date"] = date_rect
            checks["report_date_found"] = date_rect is not None
            checks["report_date_in_viewport"] = bool(date_rect and date_rect["left"] >= 0 and date_rect["right"] <= width + 1)

            checks["all_pass"] = all(checks.values())
            results.append({"viewport_width": width, "scroll_width": scroll_width, "client_width": client_width, "items": items, "checks": checks})
            if not args.no_screenshots:
                page.screenshot(path=str(args.output_dir / f"mobile_{width}px.png"), full_page=True)
            page.close()
        browser.close()

    output = {
        "html": str(html),
        "widths": list(WIDTHS),
        "all_widths_pass": all(row["checks"]["all_pass"] for row in results),
        "results": results,
    }
    if not args.no_screenshots:
        result_path = args.output_dir / "validation.json"
        result_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output["all_widths_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
