import datetime
import pytz
import json

def get_next_week_dates():
    # JSTの現在時刻を取得
    jst = pytz.timezone('Asia/Tokyo')
    now = datetime.datetime.now(jst)
    
    # 本日の曜日を取得（0:月曜, ..., 5:土曜, 6:日曜）
    weekday = now.weekday()
    
    # 翌週の月曜日を計算
    # スケジュールが土曜（5）または日曜（6）に実行される場合、
    # 翌週月曜はそれぞれ2日後、1日後となる。
    # 汎用的に: 次の月曜までの日数は (7 - weekday)
    days_to_next_monday = 7 - weekday
    next_monday = now + datetime.timedelta(days=days_to_next_monday)
    
    # 翌週の金曜日を計算（月曜の4日後）
    next_friday = next_monday + datetime.timedelta(days=4)
    
    # 結果をフォーマット
    result = {
        "collection_date": now.strftime("%Y年%m月%d日（%a）").replace("Mon", "月").replace("Tue", "火").replace("Wed", "水").replace("Thu", "木").replace("Fri", "金").replace("Sat", "土").replace("Sun", "日"),
        "target_week_start": next_monday.strftime("%Y年%m月%d日（%a）").replace("Mon", "月"),
        "target_week_end": next_friday.strftime("%m月%d日（%a）").replace("Fri", "金"),
        "dates_yyyymmdd": [
            (next_monday + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(5)
        ],
        "dates_short": [
            (next_monday + datetime.timedelta(days=i)).strftime("%-m/%-d") for i in range(5)
        ]
    }
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # シェルスクリプト等で使いやすいように環境変数用のファイルも出力
    with open('/home/ubuntu/next_week_env.sh', 'w') as f:
        f.write(f'export TARGET_WEEK_START="{result["target_week_start"]}"\n')
        f.write(f'export TARGET_WEEK_END="{result["target_week_end"]}"\n')
        f.write(f'export COLLECTION_DATE="{result["collection_date"]}"\n')
        f.write(f'export TARGET_DATES_STR="{" ".join(result["dates_yyyymmdd"])}"\n')

if __name__ == "__main__":
    get_next_week_dates()
