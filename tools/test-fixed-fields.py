from pathlib import Path
import json
import subprocess
import base64
import time
from urllib.request import urlopen
from html import escape
from websockets.sync.client import connect

root = Path(__file__).resolve().parents[1]
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
source = (root / 'index.html').read_text(encoding='utf-8')
injection = (root / 'tools' / 'test-fixed-fields.browser.js').read_text(encoding='utf-8')
marker = '      tryInitialSerialConnectPrompt();'
assert source.count(marker) == 1
test_page = source.replace(marker, injection)
results = []
for name, size in [('desktop', '1440,1000'), ('small-window', '600,900')]:
    fixture = artifacts / f'fixed-fields-{name}-fixture.html'
    fixture.write_text('<!doctype html><html><body style="margin:0;background:#101c21">'
                       '<iframe style="display:block;border:0;width:100vw;height:100vh" srcdoc="'
                       + escape(test_page, quote=True) + '"></iframe></body></html>', encoding='utf-8')
    profile = artifacts / f'fixed-fields-{name}-chrome-profile'
    profile.mkdir(exist_ok=True)
    port_file = profile / 'DevToolsActivePort'
    port_file.unlink(missing_ok=True)
    process = None
    log = (artifacts / f'fixed-fields-{name}-stderr.log').open('wb')
    try:
        process = subprocess.Popen([
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            '--headless', '--disable-gpu', '--no-first-run',
            '--no-default-browser-check', '--disable-background-networking',
            f'--user-data-dir={profile}', f'--window-size={size}',
            '--remote-debugging-port=0', fixture.as_uri(),
        ], stdout=subprocess.DEVNULL, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 15
        while not port_file.exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Chrome debugging port unavailable')
            time.sleep(0.05)
        port = port_file.read_text().splitlines()[0]
        pages = json.load(urlopen(f'http://127.0.0.1:{port}/json/list', timeout=5))
        page = next(page for page in pages if page['type'] == 'page')
        with connect(page['webSocketDebuggerUrl'], max_size=None) as socket:
            request_id = 0
            def cdp(method, params=None):
                global request_id
                request_id += 1
                current_id = request_id
                socket.send(json.dumps({'id': current_id, 'method': method, 'params': params or {}}))
                while True:
                    response = json.loads(socket.recv(timeout=10))
                    if response.get('id') == current_id:
                        if 'error' in response:
                            raise RuntimeError(response['error'])
                        return response.get('result', {})
            deadline = time.monotonic() + 30
            while True:
                result = cdp('Runtime.evaluate', {'expression': 'document.getElementById("fixed-fields-result")?.textContent', 'returnByValue': True})
                text = result.get('result', {}).get('value')
                if text:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError(f'No report: {name}')
                time.sleep(0.05)
            report = {'viewport': name, **json.loads(text)}
            screenshot = cdp('Page.captureScreenshot', {'format': 'png'})
            (artifacts / f'fixed-fields-{name}.png').write_bytes(base64.b64decode(screenshot['data']))
            cdp('Browser.close')
        results.append(report)
        print(json.dumps({**report, 'checks': len(report['checks'])} if report['status'] == 'passed' else report))
    finally:
        if process is not None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
        log.close()
        fixture.unlink(missing_ok=True)
(artifacts / 'fixed-fields-result.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
assert all(report['status'] == 'passed' for report in results)
