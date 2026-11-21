import pathlib
import re
import subprocess
import sys

NODE = r"C:\Users\12858\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
html = pathlib.Path('main.html').read_text(encoding='utf-8')
m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
if not m:
    print('module script not found')
    sys.exit(1)
js = m.group(1)
pathlib.Path('tools/_check_module.mjs').write_text(js, encoding='utf-8')
r = subprocess.run([NODE, '--check', 'tools/_check_module.mjs'], capture_output=True, text=True)
print('main.html module node --check exit', r.returncode)
print(r.stdout)
print(r.stderr)
rc = r.returncode
for extra in ['js/physics.js', 'js/adventure.js', 'js/api.js']:
    rr = subprocess.run([NODE, '--check', extra], capture_output=True, text=True)
    print(extra, 'node --check exit', rr.returncode)
    if rr.stdout: print(rr.stdout)
    if rr.stderr: print(rr.stderr)
    rc = max(rc, rr.returncode)
sys.exit(rc)
