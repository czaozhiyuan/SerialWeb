requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const reject = (name, fn) => { let failed = false; try { fn(); } catch (error) { failed = true; } check(name, failed); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const hex = bytes => bytesToCompactHex(bytes);
  const config = (algorithm = 'sum8', extra = {}) => ({ enabled: true, algorithm, start: 0, length: 6, offset: 6, byteOrder: 'le', ...extra });
  try {
    closeVersionModal();
    state.layoutExpanded = true;
    state.settings.sendMode = 'hex';
    state.settings.appendNewline = false;
    state.settings.txChecksum = config('crc16-modbus');
    const vector = new TextEncoder().encode('123456789');
    // Fixed check values are independent of the application's frame encoder.
    check('CRC-16/MODBUS check value 4B37', computeProtocolChecksum(vector, 'crc16-modbus') === 0x4B37);
    check('SUM8 check value DD', computeProtocolChecksum(vector, 'sum8') === 0xDD);
    check('XOR8 check value 31', computeProtocolChecksum(vector, 'xor8') === 0x31);
    check('LRC8 check value 23', computeProtocolChecksum(vector, 'lrc8') === 0x23);
    check('SUM8 wraps on FF 01', computeProtocolChecksum([255, 1], 'sum8') === 0);
    check('LRC8 zero residue', computeProtocolChecksum([255, 1], 'lrc8') === 0);
    const payload = '01 03 00 00 00 0A 00 00';
    check('known RTU request CRC C5 CD', hex(buildPayloadFrame(payload).bytes) === '01030000000AC5CD');
    check('CRC big endian output', hex(buildPayloadFrame(payload, { ...state.settings, txChecksum: config('crc16-modbus', {byteOrder: 'be'}) }).bytes) === '01030000000ACDC5');
    check('disabled TX preserves bytes', hex(buildPayloadFrame(payload, { ...state.settings, txChecksum: config('crc16-modbus', {enabled: false}) }).bytes) === '01030000000A0000');
    reject('overlapping compute range rejected', () => buildPayloadFrame(payload, {...state.settings, txChecksum: config('sum8', {length: 7})}));
    reject('range beyond frame rejected', () => buildPayloadFrame(payload, {...state.settings, txChecksum: config('sum8', {start: 8, length: 1})}));
    reject('checksum field beyond frame rejected', () => buildPayloadFrame(payload, {...state.settings, txChecksum: config('crc16-modbus', {offset: 7})}));
    reject('fractional offsets rejected', () => buildPayloadFrame(payload, {...state.settings, txChecksum: config('sum8', {start: 0.5})}));
    reject('negative length rejected', () => buildPayloadFrame(payload, {...state.settings, txChecksum: config('sum8', {length: -1})}));
    const textOptions = {sendMode: 'ascii', textEncoding: 'utf-8', appendNewline: true, newlineMode: 'n', txChecksum: config('sum8', {start: 0, length: 1, offset: 1})};
    check('text encoded before checksum', hex(buildPayloadFrame('A\0', textOptions).bytes) === '41410A');
    check('appended newline can be in compute range', hex(buildPayloadFrame('\0A', {...textOptions, txChecksum: config('sum8', {start: 1, length: 2, offset: 0})}).bytes) === '4B410A');
    check('UTF8 offsets count actual bytes', hex(buildPayloadFrame('中\0', {...textOptions, appendNewline: false, txChecksum: config('sum8', {length: 3, offset: 3})}).bytes) === 'E4B8AD49');
    state.parserMode = 'binary';
    state.parser.binarySchema = [
      {kind: 'header', value: '01 03', name: ''},
      {kind: 'data', value: '', name: 'value', dataType: 'uint32le'},
      {kind: 'checksum', value: '', name: 'checksum', checksum: {enabled: true, algorithm: 'crc16-modbus', start: 0, length: 6, byteOrder: 'le'}}
    ].map(normalizeBinarySchemaRowFromConfig);
    const rows = state.parser.binarySchema;
    const good = [1, 3, 0, 0, 0, 10, 0xC5, 0xCD];
    const bad = [1, 3, 0, 0, 0, 11, 0xC5, 0xCD];
    check('CRC field has two-byte width', getBinarySchemaLayout(rows).frameLength === 8);
    check('RX known good frame accepted', parseBinarySchemaFrameAt(good, rows).status === 'ok');
    const bigEndianRows = clone(rows); bigEndianRows[2].checksum.byteOrder = 'be';
    check('RX CRC big endian accepted', parseBinarySchemaFrameAt([1, 3, 0, 0, 0, 10, 0xCD, 0xC5], bigEndianRows).status === 'ok');
    const earlyChecksum = [
      {kind: 'header', value: 'A5'},
      {kind: 'checksum', name: 'checksum', checksum: {enabled: true, algorithm: 'sum8', start: 2, length: 2, byteOrder: 'le'}},
      {kind: 'data', name: 'value', dataType: 'uint16le'}
    ];
    check('checksum can precede compute range', parseBinarySchemaFrameAt([0xA5, 5, 2, 3], earlyChecksum).status === 'ok');
    const failure = parseBinarySchemaFrameAt(bad, rows);
    check('RX invalid checksum reports actual and expected', failure.status === 'checksum-error' && failure.checks[0].actual === 'C5 CD' && failure.checks[0].expected !== 'C5 CD');
    const coalesced = extractBinarySchemaFramesFromBytes([...bad, ...good, ...good], rows);
    check('bad frame consumed; coalesced valid frames retained', coalesced.frames.length === 2 && coalesced.remainder.length === 0 && coalesced.checks.length === 3);
    for (let split = 1; split < good.length; split++) {
      const first = extractBinarySchemaFramesFromBytes(good.slice(0, split), rows);
      const second = extractBinarySchemaFramesFromBytes([...first.remainder, ...good.slice(split)], rows);
      check(`split frame boundary ${split}`, first.frames.length === 0 && second.frames.length === 1);
    }
    const runtime = createDerivedRuntimeSeed('binary', 'realtime');
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: good, timestamp: 1000}, rows);
    const lastCards = JSON.stringify(runtime.latestCards);
    const lastSeries = JSON.stringify(runtime.numericSeries['parsed.value']);
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: bad, timestamp: 1100}, rows);
    check('bad checksum preserves latest valid values and chart', JSON.stringify(runtime.latestCards) === lastCards && JSON.stringify(runtime.numericSeries['parsed.value']) === lastSeries && runtime.chartFrameCount === 1);
    check('bad checksum result retained for UI', runtime.checksumResult.some(entry => !entry.ok));
    const disabledRows = clone(rows); disabledRows[2].checksum.enabled = false;
    check('RX disabled keeps CRC width and accepts raw value', getBinarySchemaLayout(disabledRows).frameLength === 8 && parseBinarySchemaFrameAt(bad, disabledRows).status === 'ok');
    const legacy = [
      {kind: 'header', value: 'A5'}, {kind: 'data', dataType: 'uint8', name: 'a'},
      {kind: 'gap', length: 2, value: ''}, {kind: 'data', dataType: 'uint8', name: 'b'},
      {kind: 'checksum', name: 'checksum'}, {kind: 'footer', value: '5A'}
    ];
    check('legacy SUM8 skips header gap footer', parseBinarySchemaFrameAt([0xA5, 2, 0x11, 0x22, 3, 5, 0x5A], legacy).status === 'ok');
    for (const [algorithm, expected] of [['sum8', 0xA7], ['xor8', 0xA7], ['lrc8', 0x59]]) {
      const single = [{kind: 'header', value: 'A5'}, {kind: 'data', dataType: 'uint8', name: 'value'}, {kind: 'checksum', name: 'checksum', checksum: {enabled: true, algorithm, start: 0, length: 2, byteOrder: 'le'}}];
      check(`RX ${algorithm} includes configured header range`, parseBinarySchemaFrameAt([0xA5, 2, expected], single).status === 'ok');
    }
    syncUserConfigControls();
    refs.sendInput.value = payload;
    refs.sendInput.dataset.rawHex = '01030000000A0000';
    captureSendDraftFromInput();
    renderTransmitChecksumPreview();
    check('final HEX preview includes CRC', document.getElementById('tx-checksum-preview').textContent.includes('C5 CD'));
    check('RX controls show algorithm and range', refs.binarySchemaList.querySelector('[data-checksum-key="algorithm"]').value === 'crc16-modbus');
    const saved = buildDeviceConfigPayload();
    check('JSON saves independent RX and TX checksums', saved.config.settings.txChecksum.offset === 6 && saved.config.parser.binary.rows[2].checksum.algorithm === 'crc16-modbus');
    const corrupt = clone(saved); corrupt.config.parser.binary.rows[2].checksum.length = 7;
    reject('JSON RX overlapping range rejected before application', () => validateDeviceConfig(corrupt));
    const corruptTX = clone(saved); corruptTX.config.settings.txChecksum.algorithm = 'crc32';
    reject('JSON unsupported algorithm rejected', () => validateDeviceConfig(corruptTX));
    const old = clone(saved); delete old.config.settings.txChecksum; delete old.config.parser.binary.rows[2].checksum; delete old.config.parser.binary.frameLength; old.config.parser.binary.rows.forEach(row => delete row.offset);
    check('old device file without new checksum properties accepted', !!validateDeviceConfig(old));
    state.serial.connected = true;
    state.serial.disconnecting = false;
    const writes = [];
    state.serial.writer = {ready: Promise.resolve(), write: async bytes => {writes.push(hex(bytes));}};
    for (const source of ['manual', 'auto', 'condition', 'preset']) {
      const args = getSendRecordPayloadArgs({payload, payloadRawHex: '01030000000A0000'});
      check(`${source} shared send path writes final CRC`, await sendPayload(args.payload, source, args.sendOptions) && writes.at(-1) === '01030000000AC5CD');
    }
    refs.sendNowBtn.click();
    await wait(20);
    check('manual button uses final bytes', writes.at(-1) === '01030000000AC5CD' && state.session.liveEvents.at(-1).metadata.source === 'manual');
    state.autoSend.queue = [{id: 'checksum-auto', enabled: true, payload, payloadRawHex: '01030000000A0000'}];
    state.autoSend.intervalMs = 100;
    state.autoSend.enabled = true;
    startAutoSendTimer();
    await wait(120);
    stopAutoSendTimer(); state.autoSend.enabled = false;
    check('actual timer uses final bytes', writes.at(-1) === '01030000000AC5CD' && state.session.liveEvents.at(-1).metadata.source === 'auto');
    state.conditionSend.rules = [{id: 'checksum-condition', enabled: true, pattern: 'OK', patternRawHex: '4F4B', response: payload, responseRawHex: '01030000000A0000'}];
    state.conditionSend.enabled = true;
    captureEvent('rx', Uint8Array.of(0x4F, 0x4B), 'OK');
    await wait(20); state.conditionSend.enabled = false;
    check('actual receive trigger uses final bytes', writes.at(-1) === '01030000000AC5CD' && state.session.liveEvents.at(-1).metadata.source === 'condition');
    state.presetSend.items = [{id: 'checksum-preset', enabled: true, payload, payloadRawHex: '01030000000A0000', expected: '', expectedRawHex: '', description: 'CRC', shortcut: ''}];
    renderSendConfigLists('preset');
    document.querySelector('[data-preset-id="checksum-preset"] [data-send-preset]').click();
    await wait(20);
    check('actual preset button uses final bytes', writes.at(-1) === '01030000000AC5CD' && state.session.liveEvents.at(-1).metadata.source === 'preset');
    const beforeWrites = writes.length;
    state.settings.txChecksum.length = 7;
    check('invalid checksum never reaches serial writer', !await sendPayload(payload, 'manual') && writes.length === beforeWrites);
    state.settings.txChecksum = config('crc16-modbus');
    state.serial.connected = false; state.serial.writer = null;
    await openDeviceConfigText(JSON.stringify(saved));
    check('JSON restores checksums without connecting or enabling sends', state.settings.txChecksum.offset === 6 && state.parser.binarySchema[2].checksum.algorithm === 'crc16-modbus' && !state.serial.connected && !state.autoSend.enabled && !state.conditionSend.enabled);
    state.parserMode = 'binary';
    clearRealtimeHistoryData();
    state.recording.active = true;
    queueRxBytes(Uint8Array.from(bad.slice(0, 3)), nowPreciseMs());
    await wait(130);
    deriveData();
    check('monitor idle timeout does not complete a partial protocol frame', state.derivedRuntime.chartFrameCount === 0);
    queueRxBytes(Uint8Array.from(bad.slice(3)), nowPreciseMs());
    await wait(130);
    deriveData();
    check('failed frame raw chunks and recording retained', state.session.rawChunks.filter(chunk => chunk.direction === 'rx').length === 2 && state.recording.rawChunks.length === 2 && state.derivedRuntime.chartFrameCount === 0);
    renderDirty();
    check('receive failure visible with actual and expected', document.getElementById('rx-checksum-result').textContent.includes('实际 C5 CD'));
    const toggle = document.querySelector('#tx-checksum-controls [data-checksum-key="enabled"]');
    toggle.checked = false; toggle.dispatchEvent(new Event('change', {bubbles: true}));
    check('UI checkbox disables TX config', state.settings.txChecksum.enabled === false);
    state.recording.active = false;
    renderTransmitChecksumControls();
    document.getElementById('tx-checksum-panel').open = true;
    updateParserModeUI();
    state.layoutExpanded = false;
    applyLayout(false);
    await wait(100);
    const result = document.createElement('pre'); result.id = 'protocol-checksum-result'; result.hidden = true; result.textContent = JSON.stringify({status: 'passed', checks}); document.body.appendChild(result);
  } catch (error) {
    const result = document.createElement('pre'); result.id = 'protocol-checksum-result'; result.textContent = JSON.stringify({status: 'failed', error: String(error), stack: error.stack, checks}); document.body.appendChild(result);
  }
});
