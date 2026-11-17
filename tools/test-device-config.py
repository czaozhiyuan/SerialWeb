from pathlib import Path
import json
import re
import subprocess
from html import unescape

root = Path(__file__).resolve().parents[1]
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
label = 'fixed'
target = root / 'index.html'
source = target.read_bytes()
injection = (root / 'tools' / 'test-device-config.browser.js').read_bytes()
marker = b'      tryInitialSerialConnectPrompt();'
assert source.count(marker) == 1
results = []
for name, size in [('desktop', '1440,1000'), ('narrow', '600,900')]:
    fixture = artifacts / f'device-config-{name}-fixture.html'
    fixture.write_bytes(source.replace(marker, injection))
    try:
        result = subprocess.run([
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            '--headless', '--disable-gpu', '--no-first-run',
            '--no-default-browser-check', '--disable-background-networking',
            f'--user-data-dir={artifacts / "device-config-chrome-profile"}',
            f'--window-size={size}', '--virtual-time-budget=8000', '--dump-dom',
            f'--screenshot={artifacts / f"device-config-{label}-{name}.png"}', fixture.as_uri(),
        ], capture_output=True, timeout=45)
        (artifacts / f'device-config-{label}-{name}-stderr.log').write_bytes(result.stderr)
        dom = result.stdout.decode('utf-8', errors='replace')
        match = re.search(r'<pre id="device-config-result"[^>]*>(.*?)</pre>', dom, re.S)
        if not match:
            raise RuntimeError(f'No report: {name}, exit={result.returncode}')
        report = {'viewport': name, **json.loads(unescape(match.group(1)))}
        results.append(report)
        print(json.dumps(report))
    finally:
        fixture.unlink(missing_ok=True)
(artifacts / f'device-config-{label}-result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
assert all(report['status'] == 'passed' for report in results)
