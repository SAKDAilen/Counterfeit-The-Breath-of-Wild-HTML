# -*- coding: utf-8 -*-
"""Extract clean, translatable Chinese UI strings from main.html."""
import re
import pathlib

src = pathlib.Path('main.html').read_text(encoding='utf-8')
lits = re.findall(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"|`([^`\\]*)`", src)
texts = [a or b or c for a, b, c in lits]
texts += re.findall(r'>([^<>]+)<', src)

cjk = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]')

parts = set()
for t in texts:
    segs = re.split(r'\$\{[^}]*\}|<[^>]*>|===|&&|\|\||=>|;|\breturn\b|\bconst\b|\bif\b|\belse\b', t)
    for seg in segs:
        if not cjk.search(seg):
            continue
        seg = seg.replace('\\n', ' ')
        for s in re.split(r'[{}<>]|\s{3,}', seg):
            s = re.sub(r'\s+', ' ', s).strip(' \t\n')
            s = s.strip('\'"')
            if not s or not cjk.search(s):
                continue
            if len(s) > 90:
                s = s[:90]
            parts.add(s)

bad = re.compile(
    r'(toast\(|Math\.|querySelector|\.style|addEventListener|=>|class=|style=|'
    r'function|document\.|window\.|\$\(|\.push\(|\.forEach\(|===|!==)'
)
parts = {p for p in parts if not bad.search(p) and cjk.search(p)}
lst = sorted(parts, key=lambda s: (len(s), s))
pathlib.Path('tools/strings-source.txt').write_text('\n'.join(lst), encoding='utf-8')
print('count', len(lst))
for s in lst:
    print(repr(s))
