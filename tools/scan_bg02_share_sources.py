#!/usr/bin/env python3
"""Read-only source triage for JieLi AC707 wallpaper/share support.

This identifies likely *source files* for review, not Bluetooth commands.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SKIP = {'.git', '.venv', 'node_modules', 'build', 'output', 'target', '__pycache__'}
SUFFIXES = {'.c', '.cc', '.cpp', '.h', '.hpp', '.java', '.kt', '.py', '.md', '.txt', '.map'}
PATTERNS = {
    'wallpaper-symbol': re.compile(r'\b(?:TCFG_JL_WALLPAPER_ENABLE|TCFG_JL_WALLPAPER_TEST_ENABLE|jl_wallpaper_[A-Za-z_]+|WALLPAPER_(?:CONFIG_FILE_NAME|NUMBER_MAX|PATH_LENGTH))\b'),
    'peer-entry': re.compile(r'\b(?:ble_client_module_enable|jl_wallpaper_sharing_send|wallpaper_sharing_send|TCFG_JL_WALLPAPER_ADV_NAME)\b', re.I),
    'peer-advert': re.compile(r'(?:wallpaper_adv|(?:scan|advertis|adv_|name_filter|target_name).{0,45}(?:wallpaper|peer|badge))', re.I),
    'peer-sharing': re.compile(r'(?:share[_ -]?pic(?:ture)?|recv[_ -]?pic(?:ture)?|receive[_ -]?pic(?:ture)?|互传|传图|碰一碰|壁纸互传)', re.I),
    'peer-ble-role': re.compile(r'(?:BLE_CENTRAL|BLE_MASTER|BT_ROLE_MASTER|ble_client|ble_central|gatt_client|scan_match|scan_target|target_name)', re.I),
    'media-path': re.compile(r'(?:bgp_wa%d\.avi|\.ru50|\.vie|\.gif|\.avi)', re.I),
    'wallpaper-generic': re.compile(r'\bwallpaper\b|壁纸', re.I),
    'file-transfer': re.compile(r'(?:rcsp.{0,35}(?:file|transfer)|(?:file|transfer).{0,35}rcsp|file_send|file_receive)', re.I),
    'file-read-sdk': re.compile(r'\b(?:readBigFile|ReadFileParam|listFiles|getOnlineStorage|FileBrowseManager|FileOpImpl)\b'),
}
WEIGHTS = {'wallpaper-symbol': 12, 'peer-entry': 20, 'peer-advert': 13, 'peer-sharing': 9, 'peer-ble-role': 5, 'media-path': 2, 'wallpaper-generic': 2, 'file-transfer': 3, 'file-read-sdk': 10}


def inspect(root: Path, max_bytes: int, max_matches: int) -> list[dict]:
    reports = []
    for file in root.rglob('*'):
        if not file.is_file() or file.suffix.lower() not in SUFFIXES:
            continue
        if any(part in SKIP for part in file.relative_to(root).parts):
            continue
        try:
            if file.stat().st_size > max_bytes:
                continue
            source = file.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        found = []
        totals = {name: 0 for name in PATTERNS}
        for line_number, line in enumerate(source.splitlines(), 1):
            matched = [name for name, pattern in PATTERNS.items() if pattern.search(line)]
            if matched:
                for name in matched:
                    totals[name] += 1
                if len(found) < max_matches:
                    found.append({'line': line_number, 'kinds': matched, 'text': line.strip()[:220]})
        rel = file.relative_to(root).as_posix()
        name_match = file.name.lower() in {'wallpaper_sharing_main.c', 'wallpaper_sharing.h', 'lcd_ui_api.c', 'board_ac707n_demo_cfg.h'}
        if found or name_match:
            score = sum(WEIGHTS[kind] * min(count, 12) for kind, count in totals.items()) + (15 if name_match else 0)
            reports.append({'file': rel, 'score': score, 'source_name_hint': name_match, 'totals': {k: v for k, v in totals.items() if v}, 'matches': found})
    return sorted(reports, key=lambda item: (-item['score'], item['file']))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source_root', type=Path, help='unpacked SDK or decompiled APK source directory')
    ap.add_argument('--limit', type=int, default=30, help='maximum ranked files to show')
    ap.add_argument('--max-file-mb', type=int, default=4)
    ap.add_argument('--max-matches', type=int, default=10)
    ap.add_argument('--json', type=Path, help='write matching source lines as JSON')
    args = ap.parse_args()
    if not args.source_root.is_dir():
        ap.error(f'not a source directory: {args.source_root}')
    results = inspect(args.source_root, max(1, args.max_file_mb) * 1024 * 1024, max(1, args.max_matches))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps({'source_root': str(args.source_root), 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Ranked candidate source files: {len(results)} (showing {min(args.limit,len(results))})')
    for result in results[:max(0,args.limit)]:
        print(f"\n[{result['score']:>3}] {result['file']}  {result['totals']}")
        for match in result['matches']:
            print(f"    {match['line']:>5}  {','.join(match['kinds'])}: {match['text']}")
    print('\nRead-only text search. A match is not proof of a firmware opcode or BG02 support.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
