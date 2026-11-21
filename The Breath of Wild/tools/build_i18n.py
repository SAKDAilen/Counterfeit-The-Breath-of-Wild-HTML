import json
import pathlib

dicts = json.loads(pathlib.Path('locales/dictionary.json').read_text(encoding='utf-8'))
langs = [
    {"id": "zh-CN", "name": "简体中文", "nativeName": "简体中文"},
    {"id": "zh-TW", "name": "繁體中文", "nativeName": "繁體中文"},
    {"id": "en", "name": "English", "nativeName": "English"},
    {"id": "ja", "name": "日本語", "nativeName": "日本語"},
]
payload = {
    "version": 1,
    "langs": langs,
    "dict": {
        "en": dicts["en"],
        "ja": dicts["ja"],
        "zh-TW": dicts["zh-TW"],
    },
}
runtime = pathlib.Path('tools/i18n_runtime.js').read_text(encoding='utf-8')
out = runtime.replace('__DATA__', json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
pathlib.Path('locales/i18n.js').write_text(out, encoding='utf-8')
print('i18n.js bytes:', len(out.encode('utf-8')))
print('entries:', {k: len(v) for k, v in payload['dict'].items()})
