#!/usr/bin/env python3
"""Bundle Inkling into one self-contained HTML file.

Inlines the stylesheets, the scripts, and the woff2 faces as data URIs, so the
result is a single file that opens from disk and needs no network at all.

    python3 build.py                  -> dist/inkling.html   (whole document)
    python3 build.py --fragment PATH  -> body content only, for hosts that
                                         supply their own document skeleton
"""

import argparse
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'index.html'


def font_data_uri(match, css_dir):
    """Rewrite url("../fonts/x.woff2") to a base64 data: URI."""
    url = match.group(1).strip('\'"')
    if url.startswith('data:'):
        return match.group(0)
    raw = (css_dir / url).resolve().read_bytes()
    return 'url("data:font/woff2;base64,%s")' % base64.b64encode(raw).decode()


def read_css(path):
    css = path.read_text(encoding='utf-8')
    return re.sub(r'url\((["\'][^)]+["\'])\)',
                  lambda m: font_data_uri(m, path.parent), css)


def build():
    html = SRC.read_text(encoding='utf-8')

    def inline_css(match):
        href = match.group(1)
        return '<style>\n%s\n</style>' % read_css(ROOT / href)

    def inline_js(match):
        src = match.group(1)
        return '<script>\n%s\n</script>' % (ROOT / src).read_text(encoding='utf-8')

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    return html


def fragment(html):
    """Strip the document skeleton, keeping the title, the styles that were
    inlined into <head>, and everything in <body>."""
    head = re.search(r'<head>(.*?)</head>', html, re.S)
    body = re.search(r'<body>(.*)</body>', html, re.S)
    title = re.search(r'<title>(.*?)</title>', html, re.S)

    parts = []
    if title:
        parts.append('<title>%s</title>' % title.group(1))
    if head:
        parts += re.findall(r'<style>.*?</style>', head.group(1), re.S)
    parts.append(body.group(1).strip() if body else html)
    return '\n'.join(parts) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fragment', metavar='PATH',
                    help='write body content only to PATH')
    args = ap.parse_args()

    html = build()

    if args.fragment:
        out = pathlib.Path(args.fragment)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(fragment(html), encoding='utf-8')
    else:
        out = ROOT / 'dist' / 'inkling.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding='utf-8')

    print('%s  %.0f KB' % (out, out.stat().st_size / 1024))


if __name__ == '__main__':
    main()
