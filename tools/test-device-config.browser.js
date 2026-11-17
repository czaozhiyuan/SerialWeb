requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const reject = (name, fn) => { let failed = false; try { fn(); } catch (error) { failed = true; } check(name, failed); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    closeVersionModal();
    state.layoutExpanded = true;
    state.parserMode = 'binary';
    state.deviceName = '温控器';
    state.parser.binarySchema = [
      { kind: 'header', value: 'A5', name: '', dataType: 'int8' },
      { kind: 'gap', value: '', length: 4, name: '', dataType: 'int8' },
      { kind: 'data', value: '', dataType: 'uint16le', name: 'status', nameAuto: false },
      { kind: 'footer', value: '5A', name: '', dataType: 'int8' }
    ].map(normalizeBinarySchemaRowFromConfig);
    state.charts = [createChart('time')];
    state.charts[0].bindings = ['parsed.status'];
    state.autoSend.queue = [{id: 'test', enabled: true, payload: 'PING', payloadRawHex: '50494E47'}];
    state.conditionSend.rules = [{id: 'test', enabled: true, pattern: 'OK', patternRawHex: '4F4B', response: 'ACK', responseRawHex: '41434B'}];
    state.presetSend.items = [{id: 'test', enabled: true, payload: 'RESET', payloadRawHex: '5245534554', expected: '', expectedRawHex: '', description: '复位', shortcut: 'R'}];
    syncUserConfigControls();
    const rows = state.parser.binarySchema;
    const frame = [0xA5, 0x11, 0x22, 0x33, 0x44, 0x34, 0x12, 0x5A];
    const layout = getBinarySchemaLayout(rows);
    check('fixed length includes all sections', layout.frameLength === 8 && layout.offsets.join(',') === '0,1,5,7');
    check('UI exposes n-byte gap and frame length', refs.binarySchemaList.querySelector('[data-binary-length]').value === '4' && refs.binaryFrameLayout.textContent.includes('8 bytes'));
    check('n-byte gap aligns next numeric value', parseBinarySchemaFrameAt(frame, rows).frame.values.status === 0x1234);
    const partial = extractBinarySchemaFramesFromBytes(frame.slice(0, 4), rows);
    check('partial gap waits for next bytes', !partial.frames.length && partial.remainder.length === 4);
    check('fragmented frame completes', extractBinarySchemaFramesFromBytes([...partial.remainder, ...frame.slice(4)], rows).frames[0].values.status === 0x1234);
    check('coalesced frames parse independently', extractBinarySchemaFramesFromBytes([...frame, ...frame], rows).frames.length === 2);
    check('bad footer resynchronizes', extractBinarySchemaFramesFromBytes([...frame.slice(0, -1), 0, ...frame], rows).frames.length === 1);
    check('header value inside gap does not truncate frame', extractBinarySchemaFramesFromBytes([0xA5, 0xA5, 0, 0, 0, 0x34, 0x12, 0x5A], rows).frames.length === 1);
    const runtime = createDerivedRuntimeSeed('binary', 'realtime');
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: frame.slice(0, 4), timestamp: 100000}, rows);
    check('real derived pipeline waits for complete frame', !runtime.numericSeries['parsed.status']);
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: [...frame.slice(4), ...frame], timestamp: 100010}, rows);
    check('real derived pipeline decodes fragmented and coalesced frames', runtime.numericSeries['parsed.status'].map(point => point.v).join(',') === '4660,4660');
    clearRealtimeHistoryData();
    const rawFrame = [0xA5, 0x0D, 0x0A, 0, 1, 0x34, 0x12, 0x5A];
    queueRxBytes(Uint8Array.from(rawFrame), nowPreciseMs());
    invalidateDerivedCaches();
    deriveData();
    check('binary frame survives monitor CRLF segmentation', state.derived.numericSeries['parsed.status'][0].v === 4660);
    check('receive pipeline preserves skipped bytes', state.session.rawChunks[0].bytes.join(',') === rawFrame.join(','));
    check('old empty gap defaults to one byte', getBinaryRowLength(normalizeBinarySchemaRowFromConfig({kind: 'gap', value: ''})) === 1);
    check('old literal gap retains exact matching', parseBinarySchemaFrameAt([0xA5, 0xAA, 0xBB, 0x34, 0x12, 0x5A], [rows[0], {kind: 'gap', value: 'AA BB'}, rows[2], rows[3]]).frame.values.status === 0x1234);
    check('old literal mismatch remains rejected', parseBinarySchemaFrameAt([0xA5, 0, 0xBB, 0x34, 0x12, 0x5A], [rows[0], {kind: 'gap', value: 'AA BB'}, rows[2], rows[3]]).status === 'mismatch');
    [0, -1, 1.5, 65537].forEach(length => reject('invalid gap length rejected: ' + length, () => getBinaryRowLength({kind: 'gap', length})));
    const gapInput = refs.binarySchemaList.querySelector('[data-binary-length]');
    gapInput.value = '5'; gapInput.dispatchEvent(new Event('input', {bubbles: true}));
    check('UI length edit changes schema', rows[1].length === 5 && refs.binaryFrameLayout.textContent.includes('9 bytes'));
    gapInput.value = '4'; gapInput.dispatchEvent(new Event('input', {bubbles: true}));

    state.session.rawChunks = [{id: 'not-exported', direction: 'rx', bytes: frame, timestamp: nowPreciseMs()}];
    state.session.liveEvents = [{direction: 'rx', text: 'not-exported', bytes: frame}];
    const payload = buildDeviceConfigPayload();
    check('JSON envelope is named and versioned', payload.type === 'PortScopeDeviceConfig' && payload.version === 1 && payload.name === '温控器');
    check('JSON contains frame length and offsets', payload.config.parser.binary.frameLength === 8 && payload.config.parser.binary.rows[2].offset === 5);
    check('JSON preserves send rules and chart binding', payload.config.presetSend.items[0].description === '复位' && payload.config.charts[0].channels.bindings[0] === 'parsed.status');
    check('JSON excludes data and runtime activation', !JSON.stringify(payload).includes('not-exported') && !('enabled' in payload.config.autoSend) && !('manualConnectRequired' in payload.config));
    check('validation accepts serialized round trip', validateDeviceConfig(JSON.parse(JSON.stringify(payload))).parser.binary.rows[1].length === 4);
    const invalidCases = [
      ['future version', p => p.version = 2],
      ['unknown config property', p => p.config.unimplemented = {}],
      ['bad frame length', p => p.config.parser.binary.frameLength = 9],
      ['bad offset', p => p.config.parser.binary.rows[2].offset = 4],
      ['bad type', p => p.config.parser.binary.rows[2].dataType = 'unknown'],
      ['bad gap', p => p.config.parser.binary.rows[1].length = -1],
      ['bad hex', p => p.config.parser.binary.rows[0].value = 'GG'],
      ['bad baud', p => p.config.settings.baudRate = 'abc'],
      ['bad binding', p => p.config.charts[0].channels.bindings = ['parsed.missing']],
      ['invalid coordinate range', p => {p.config.charts[0].view.baseXMin = 10; p.config.charts[0].view.baseXMax = 1;}]
    ];
    invalidCases.forEach(([name, change]) => {const copy = clone(payload); change(copy); reject(name, () => validateDeviceConfig(copy));});
    const beforeName = state.deviceName;
    let closes = 0, writes = 0;
    state.serial.port = {close: async () => {closes++;}};
    state.serial.connected = true;
    state.serial.writer = {ready: Promise.resolve(), write: async () => {writes++;}, releaseLock: () => {}};
    try { await openDeviceConfigText('{broken'); } catch (error) {}
    check('invalid JSON preserves current connection and settings', state.serial.connected && closes === 0 && state.deviceName === beforeName);
    state.autoSend.enabled = true;
    state.conditionSend.enabled = true;
    state.presetSend.enabled = true;
    state.autoSend.timerId = setInterval(() => {writes++;}, 10000);
    const validImport = openDeviceConfigText(JSON.stringify(payload));
    check('send is blocked during import', await sendPayload('PING') === false);
    await validImport;
    check('valid import closes old port before application', closes === 1 && !state.serial.connected);
    check('import keeps all send tasks disabled', !state.autoSend.enabled && !state.conditionSend.enabled && !state.presetSend.enabled && !state.autoSend.timerId && writes === 0);
    check('import requires manual connection without changing preference', state.serial.requireManualConnect && state.settings.autoReconnect === payload.config.settings.autoReconnect && !shouldScheduleReconnect());
    check('late automatic connect is blocked', await connectSerial('auto-initial', {open: async () => {throw new Error('must not open');}}) === false);
    const restored = buildDeviceConfigPayload();
    check('rules and layout round trip', restored.config.parser.binary.frameLength === 8 && restored.config.parser.binary.rows[1].length === 4 && restored.config.charts[0].channels.bindings[0] === 'parsed.status');
    check('local preferences persist manual connection requirement', JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY)).manualConnectRequired === true);

    const textProfile = clone(payload);
    textProfile.name = '文本设备';
    textProfile.config.parser.mode = 'text';
    textProfile.config.parser.text.rule = '/name0=/int0';
    textProfile.config.charts[0].channels.bindings = ['parsed.temperature'];
    await openDeviceConfigText(JSON.stringify(textProfile));
    await delay(100);
    check('text protocol and dynamic field binding restore: ' + JSON.stringify({mode: state.parserMode, rule: state.parser.textRule, bindings: state.charts[0].bindings}), state.parserMode === 'text' && state.parser.textRule === '/name0=/int0' && state.charts[0].bindings[0] === 'parsed.temperature');
    await openDeviceConfigText(JSON.stringify(payload));
    const otherBinary = clone(payload);
    otherBinary.config.parser.binary.rows[2].name = 'power';
    otherBinary.config.charts[0].channels.bindings = ['parsed.power'];
    await openDeviceConfigText(JSON.stringify(otherBinary));
    await delay(100);
    check('switching binary protocols retains new field bindings', state.charts[0].bindings[0] === 'parsed.power');
    await openDeviceConfigText(JSON.stringify(payload));
    startRecording();
    queueRxBytes(Uint8Array.from(frame), nowPreciseMs());
    const timelineCount = state.timelines.length;
    await openDeviceConfigText(JSON.stringify(payload));
    check('active recording is archived before config changes', !state.recording.active && state.timelines.length === timelineCount + 1 && state.timelines.at(-1).rawChunks[0].bytes.join(',') === frame.join(','));

    const old = buildUserConfigExportPayload();
    old.userConfig.autoSend.enabled = true;
    delete old.userConfig.parser.binary.rows[1].length;
    old.userConfig.parser.binary.rows[1].value = 'AA BB';
    const importedLegacy = validateDeviceConfig(old);
    check('legacy clipboard format migrates without activating tasks', importedLegacy.parser.binary.rows[1].length === 2 && importedLegacy.autoSend.enabled === false);

    const originalDownload = downloadFile;
    let download;
    downloadFile = (name, blob) => {download = {name, blob};};
    document.getElementById('save-device-config-btn').click();
    check('save button generates readable JSON file', download.name === '温控器.json' && JSON.parse(await download.blob.text()).config.parser.binary.frameLength === 8);
    downloadFile = originalDownload;
    const filePayload = clone(payload); filePayload.name = '本地打开测试';
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(filePayload)], 'device.json', {type: 'application/json'}));
    refs.deviceConfigFileInput.files = transfer.files;
    refs.deviceConfigFileInput.dispatchEvent(new Event('change', {bubbles: true}));
    await delay(100);
    check('file input opens JSON and restores name', state.deviceName === '本地打开测试' && refs.deviceConfigName.value === '本地打开测试');
    check('file input resets for reopening same file', refs.deviceConfigFileInput.value === '');

    const originalSupported = state.serial.supported;
    state.serial.supported = true;
    state.serial.requireManualConnect = false;
    let finishOpen, raceCloses = 0;
    const pendingPort = {open: () => new Promise(resolve => {finishOpen = resolve;}), close: async () => {raceCloses++;}};
    const connection = connectSerial('auto-initial', pendingPort);
    const importing = openDeviceConfigText(JSON.stringify(payload));
    finishOpen();
    await connection;
    await importing;
    check('pending connection cannot survive import', raceCloses >= 1 && !state.serial.connected && state.serial.requireManualConnect);
    state.serial.supported = originalSupported;
    check('runtime import guard released', state.ui.deviceConfigImporting === false);
    await delay(100);
    const report = {status: 'passed', checks};
    const result = document.createElement('pre'); result.id = 'device-config-result'; result.hidden = true; result.textContent = JSON.stringify(report); document.body.appendChild(result);
  } catch (error) {
    const result = document.createElement('pre'); result.id = 'device-config-result'; result.textContent = JSON.stringify({status: 'failed', error: String(error), stack: error.stack, checks}); document.body.appendChild(result);
  }
});
