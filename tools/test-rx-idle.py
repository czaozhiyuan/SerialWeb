from pathlib import Path
import json
import re
import subprocess
import sys
from html import unescape

root = Path(__file__).resolve().parents[1]
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
label = 'baseline' if '--baseline' in sys.argv else 'fixed'
target = root / 'release' / 'PortScope-v2.2.0-20261116' / 'index.html' if label == 'baseline' else root / 'index.html'
source = target.read_bytes()
injection = (root / 'tools' / 'test-rx-idle.browser.js').read_bytes()
marker = b'      tryInitialSerialConnectPrompt();'
assert source.count(marker) == 1
results = []
for name, size in [('desktop', '1440,1000'), ('narrow', '600,900')]:
    fixture = artifacts / f'rx-idle-{name}-fixture.html'
    fixture.write_bytes(source.replace(marker, injection))
    try:
        result = subprocess.run([
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            '--headless', '--disable-gpu', '--no-first-run',
            '--no-default-browser-check', '--disable-background-networking',
            f'--user-data-dir={artifacts / "rx-idle-chrome-profile"}',
            f'--window-size={size}', '--virtual-time-budget=5000', '--dump-dom',
            f'--screenshot={artifacts / f"rx-idle-{label}-{name}.png"}', fixture.as_uri(),
        ], capture_output=True, timeout=45)
        (artifacts / f'rx-idle-{label}-{name}-stderr.log').write_bytes(result.stderr)
        dom = result.stdout.decode('utf-8', errors='replace')
        match = re.search(r'<pre id="rx-idle-result"[^>]*>(.*?)</pre>', dom, re.S)
        if not match:
            raise RuntimeError(f'No report: {name}, exit={result.returncode}')
        report = {'viewport': name, **json.loads(unescape(match.group(1)))}
        results.append(report)
        print(json.dumps(report))
    finally:
        fixture.unlink(missing_ok=True)
(artifacts / f'rx-idle-{label}-result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
assert all(report['status'] == 'passed' for report in results)
