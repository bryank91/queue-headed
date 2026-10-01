#!/usr/bin/env python3
"""Probe Kmart product in manually launched real Chrome before Playwright attaches."""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
PRODUCT = 'https://www.kmart.com.au/product/4m-trees-gift-wrapping-paper-43768202/'
EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
run = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
profile = ROOT / f'chrome-cdp-probe-{run}'


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def get_json(url, timeout=2):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def main():
    port = free_port()
    log = open(EVIDENCE / f'{run}_chrome-probe.log', 'w')
    cmd = [str(CHROME), f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
           '--no-first-run', '--no-default-browser-check', PRODUCT]
    print('launch', cmd)
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
    try:
        version_url = f'http://127.0.0.1:{port}/json/version'
        for _ in range(60):
            try:
                version = get_json(version_url)
                break
            except Exception:
                time.sleep(.5)
        else:
            raise RuntimeError('CDP endpoint did not start')
        print('version', version)
        print('waiting before any CDP client attaches...')
        time.sleep(15)
        targets = get_json(f'http://127.0.0.1:{port}/json/list')
        print('targets-before-attach', [(x.get('title'), x.get('url')) for x in targets if x.get('type') == 'page'])
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
            pages = [p for c in browser.contexts for p in c.pages]
            page = next((p for p in pages if 'kmart.com.au' in p.url), pages[-1])
            page.wait_for_timeout(3000)
            body = page.locator('body').inner_text(timeout=10000)
            print('url', page.url)
            print('title', page.title())
            print('webdriver', page.evaluate('navigator.webdriver'))
            print('blocked', 'access denied' in body.lower())
            print('product', '4m Trees Gift Wrapping Paper' in body)
            print('button', page.locator('[data-testid="product-button"]').count())
            out = EVIDENCE / f'{run}_chrome-product-probe.png'
            page.screenshot(path=str(out))
            print('shot', out)
            browser.close()
    finally:
        proc.terminate()
        try: proc.wait(10)
        except subprocess.TimeoutExpired: proc.kill()
        log.close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
