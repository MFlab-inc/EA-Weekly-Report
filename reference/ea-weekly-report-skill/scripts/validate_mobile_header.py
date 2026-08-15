#!/usr/bin/env python3
"""EA週次レポートのスマホ用サイトヘッダーを複数幅で検証する。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

WIDTHS = (320, 360, 375, 390, 414)
EXPECTED = {
    "title": "EAユーザー向け週次レポート",
    "subtitle_line_1": "WEEKLY ECONOMIC CALENDAR",
    "subtitle_line_2": "EA STOP GUIDE",
    "report_type": "WEEKLY REPORT",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path, help="検証対象HTML")
    parser.add_argument("--output-dir", type=Path, default=Path("mobile_header_validation"))
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    return parser.parse_args()


def text_metrics(locator) -> dict:
    return locator.evaluate(
        """el => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = Array.from(range.getClientRects());
          const rect = range.getBoundingClientRect();
          return {
            text: el.textContent.trim(),
            line_count: rects.length,
            left: +rect.left.toFixed(2),
            right: +rect.right.toFixed(2),
            top: +rect.top.toFixed(2),
            bottom: +rect.bottom.toFixed(2)
          };
        }"""
    )


def main() -> int:
    args = parse_args()
    html = args.html.resolve()
    if not html.exists():
        raise FileNotFoundError(html)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=args.chromium,
            args=["--no-sandbox"],
        )
        for width in WIDTHS:
            page = browser.new_page(
                viewport={"width": width, "height": 844}, device_scale_factor=2
            )
            page.goto(html.as_uri(), wait_until="domcontentloaded")
            page.wait_for_timeout(250)
            header = page.locator("header.site-header").first
            subtitle = header.locator(".header-subtitle span")
            if subtitle.count() < 2:
                subtitle = header.locator(".logo-text p span")

            locators = {
                "title": header.get_by_text(EXPECTED["title"], exact=True),
                "subtitle_line_1": subtitle.nth(0),
                "subtitle_line_2": subtitle.nth(1),
                "report_type": header.get_by_text("Weekly Report", exact=True),
                "report_date": header.locator(".report-date"),
            }
            items = {key: text_metrics(locator) for key, locator in locators.items()}
            header_rect = header.evaluate(
                "el => {const r=el.getBoundingClientRect(); return {left:r.left,right:r.right}}"
            )

            checks = {}
            for key, item in items.items():
                checks[f"{key}_one_line"] = item["line_count"] == 1
                checks[f"{key}_in_viewport"] = item["left"] >= 0 and item["right"] <= width
            checks["title_exact"] = items["title"]["text"] == EXPECTED["title"]
            checks["subtitle_line_1_exact"] = (
                items["subtitle_line_1"]["text"] == EXPECTED["subtitle_line_1"]
            )
            checks["subtitle_line_2_exact"] = (
                items["subtitle_line_2"]["text"] == EXPECTED["subtitle_line_2"]
            )
            checks["report_type_exact"] = (
                items["report_type"]["text"].upper() == EXPECTED["report_type"]
            )
            checks["date_has_full_suffix"] = items["report_date"]["text"].endswith("）")
            checks["two_distinct_subtitle_rows"] = (
                items["subtitle_line_1"]["bottom"] <= items["subtitle_line_2"]["top"]
            )
            checks["title_no_overlap_right"] = (
                items["title"]["right"] <= items["report_type"]["left"]
            )
            checks["subtitle_1_no_overlap_right"] = (
                items["subtitle_line_1"]["right"] <= items["report_date"]["left"]
            )
            checks["subtitle_2_no_overlap_right"] = (
                items["subtitle_line_2"]["right"] <= items["report_date"]["left"]
            )
            checks["header_in_viewport"] = (
                header_rect["left"] >= 0 and header_rect["right"] <= width
            )
            checks["all_pass"] = all(checks.values())
            results.append({"viewport_width": width, "items": items, "checks": checks})
            page.screenshot(
                path=str(args.output_dir / f"mobile_header_{width}px.png"),
                full_page=False,
            )
            page.close()
        browser.close()

    output = {
        "html": str(html),
        "widths": list(WIDTHS),
        "all_widths_pass": all(row["checks"]["all_pass"] for row in results),
        "results": results,
    }
    result_path = args.output_dir / "validation.json"
    result_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output["all_widths_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
