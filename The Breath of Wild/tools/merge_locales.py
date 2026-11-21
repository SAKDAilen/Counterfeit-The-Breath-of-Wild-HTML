import json
import pathlib

parts = sorted(pathlib.Path('locales/parts').glob('part-*.json'))
langs = ['zh-CN', 'en', 'ja', 'zh-TW']
merged = {l: {} for l in langs}
for p in parts:
    data = json.loads(p.read_text(encoding='utf-8'))
    for l in langs:
        merged[l].update(data[l])
    print('merged', p.name, {l: len(data[l]) for l in langs})

# remove fragments that would corrupt text when used as bare substitutions:
# comments/code leftovers that slipped through extraction
import re
codeish = re.compile(r'(//|=>|===|!==|\$\(|\.push|\.forEach|toast\(|startDialog\(|textContent|querySelector|class=|style=|defEl|armor\)|riding\?)')
for l in langs:
    for k in list(merged[l].keys()):
        if codeish.search(k):
            del merged[l][k]
# keys that are pure code punctuation or meaningless
for l in langs:
    for k in list(merged[l].keys()):
        if len(k.strip()) == 0 or k.strip() in {'—', '·', '//'}:
            del merged[l][k]

base = set(merged['zh-CN'])
for l in langs:
    missing = base - set(merged[l])
    extra = set(merged[l]) - base
    print(l, 'keys', len(merged[l]), 'missing', len(missing), 'extra', len(extra))
    if missing:
        print('  missing sample', list(missing)[:10])
    if extra:
        print('  extra sample', list(extra)[:10])

pathlib.Path('locales/dictionary.json').write_text(
    json.dumps(merged, ensure_ascii=False, indent=1), encoding='utf-8')
for l in langs:
    pathlib.Path('locales', l + '.json').write_text(
        json.dumps(merged[l], ensure_ascii=False, indent=1), encoding='utf-8')
print('total keys', len(base))
