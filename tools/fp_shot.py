"""Headless Chromium harness for the burger mini-game (dev tool, not shipped).

usage (from any cwd):
    python3 tools/fp_shot.py <html> <out_dir> [--w 1536] [--h 1024] [--script steps.json]

steps.json is a list of steps, each one of:
    {"wait": 800}
    {"eval": "FP.something()"}            # result is printed
    {"shot": "name.png"}                   # screenshot of the page
    {"click": [x, y]}                      # mouse click in page coordinates
    {"move": [x, y]}
Console messages and uncaught page errors are always printed.
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html')
    ap.add_argument('out')
    ap.add_argument('--w', type=int, default=1536)
    ap.add_argument('--h', type=int, default=1024)
    ap.add_argument('--script', default=None)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    steps = json.load(open(a.script, encoding='utf-8')) if a.script else [{'wait': 1200}, {'shot': 'shot.png'}]
    url = 'file:///' + os.path.abspath(a.html).replace('\\', '/').lstrip('/')
    errors = 0
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'])
        pg = br.new_page(viewport={'width': a.w, 'height': a.h})

        def on_console(m):
            print('[console.%s] %s' % (m.type, m.text))

        def on_error(e):
            nonlocal errors
            errors += 1
            print('[pageerror] %s' % e)

        pg.on('console', on_console)
        pg.on('pageerror', on_error)
        pg.goto(url)
        for s in steps:
            if 'wait' in s:
                pg.wait_for_timeout(s['wait'])
            elif 'eval' in s:
                print('[eval] ->', json.dumps(pg.evaluate(s['eval']), ensure_ascii=False))
            elif 'shot' in s:
                pg.screenshot(path=os.path.join(a.out, s['shot']))
                print('[shot]', s['shot'])
            elif 'click' in s:
                pg.mouse.click(*s['click'])
            elif 'move' in s:
                pg.mouse.move(*s['move'])
        br.close()
    print('page errors: %d' % errors)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
