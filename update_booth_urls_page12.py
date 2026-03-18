#!/usr/bin/env python3
"""
BOOTH URLs from sasanoki page 12 を追加
"""

import csv
import json
from pathlib import Path

# CSV と JSON を更新するデータ
UPDATES = [
    {
        "id": "0199",
        "nickname": "アルパカ",
        "category": "akyo",
        "booth_url": "https://booth.pm/ja/items/2499808",
    },
    {
        "id": "0221",
        "nickname": "とうもろこし",
        "category": "akyo&畑",
        "booth_url": "https://booth.pm/ja/items/3145248",
    },
    {
        "id": "0211",
        "nickname": "さつまいも",
        "category": "akyo",
        "booth_url": "https://booth.pm/ja/items/3109079",
    },
    {
        "id": "0213",
        "nickname": "ししまい",
        "category": "akyo",
        "booth_url": "https://booth.pm/ja/items/2610875",
    },
    {
        "id": "0212",
        "nickname": "きつねコート",
        "category": "akyo",
        "booth_url": "https://booth.pm/ja/items/2573111",
    },
    {
        "id": "0207",
        "nickname": "足軽",
        "category": "akyo",
        "booth_url": "https://booth.pm/ja/items/2401546",
    },
]

def update_csv_files():
    """CSVファイルを更新"""
    csv_files = {
        "data/akyo-data-ja.csv": "ja",
        "data/akyo-data-en.csv": "en",
        "data/akyo-data-ko.csv": "ko",
    }

    for csv_path, lang in csv_files.items():
        path = Path(csv_path)
        if not path.exists():
            print(f"WARNING: {csv_path} not found")
            continue

        # 既存データを読み込み
        rows = []
        fieldnames = None
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        # BoothURL列がなければ追加
        if fieldnames and 'BoothURL' not in fieldnames:
            fieldnames = list(fieldnames) + ['BoothURL']

        # 対象のIDを更新
        for row in rows:
            for update in UPDATES:
                if row.get('ID') == update['id']:
                    row['BoothURL'] = update['booth_url']
                    # Category/Attribute列を更新
                    if 'Category' in row:
                        row['Category'] = update['category']
                    elif 'Attribute' in row:
                        row['Attribute'] = update['category']

        # 空のキーを削除
        cleaned_rows = []
        for row in rows:
            cleaned_row = {k: v for k, v in row.items() if k is not None}
            cleaned_rows.append(cleaned_row)

        # CSVに書き戻す
        with open(path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(cleaned_rows)

        print(f"OK: Updated {csv_path}")

def update_json_files():
    """JSONファイルを更新"""
    json_files = {
        "data/akyo-data-ja.json": "ja",
        "data/akyo-data-en.json": "en",
        "data/akyo-data-ko.json": "ko",
    }

    for json_path, lang in json_files.items():
        path = Path(json_path)
        if not path.exists():
            print(f"⚠️  {json_path} not found")
            continue

        # JSONを読み込み
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # データ配列を確認
        if isinstance(data, dict) and 'data' in data:
            items = data['data']
        elif isinstance(data, list):
            items = data
        else:
            print(f"WARNING: Unexpected JSON format in {json_path}")
            continue

        # 対象のIDを更新
        for item in items:
            for update in UPDATES:
                if item.get('id') == update['id']:
                    item['boothUrl'] = update['booth_url']
                    # category を更新（日本語版のみ）
                    if lang == 'ja':
                        item['category'] = update['category']

        # JSONに書き戻す
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"OK: Updated {json_path}")

def update_public_data_files():
    """開発用 public/data/ ファイルも更新"""
    public_json_files = {
        "public/data/akyo-data-ja.json": "ja",
        "public/data/akyo-data-en.json": "en",
        "public/data/akyo-data-ko.json": "ko",
    }

    for json_path, lang in public_json_files.items():
        path = Path(json_path)
        if not path.exists():
            print(f"WARNING: {json_path} not found (skipping)")
            continue

        # JSONを読み込み
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # データ配列を確認
        if isinstance(data, dict) and 'data' in data:
            items = data['data']
        elif isinstance(data, list):
            items = data
        else:
            print(f"WARNING: Unexpected JSON format in {json_path}")
            continue

        # 対象のIDを更新
        for item in items:
            for update in UPDATES:
                if item.get('id') == update['id']:
                    item['boothUrl'] = update['booth_url']
                    # category を更新（日本語版のみ）
                    if lang == 'ja':
                        item['category'] = update['category']

        # JSONに書き戻す
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"OK: Updated {json_path}")

if __name__ == '__main__':
    print("Adding BOOTH URLs from sasanoki page 12...\n")

    print("Updating CSV files:")
    update_csv_files()

    print("\nUpdating JSON files (data/):")
    update_json_files()

    print("\nUpdating JSON files (public/data/ for development):")
    update_public_data_files()

    print("\nAll files updated successfully!")
