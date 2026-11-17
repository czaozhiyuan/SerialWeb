requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const reject = (name, fn) => { let failed = false; try { fn(); } catch (error) { failed = true; } check(name, failed); };
  const field = (name, offset, dataType, byteOrder = 'le') => ({id: uid('schema'), name, offset, dataType, byteOrder});
  const schema = [
    {kind: 'header', value: 'A5', name: ''}, {kind: 'gap', value: '', length: 26, name: ''},
    {kind: 'checksum', value: '', name: 'checksum', checksum: {enabled: true, algorithm: 'sum8', start: 0, length: 27, byteOrder: 'le'}},
    {kind: 'footer', value: '5A', name: ''}
  ].map(normalizeBinarySchemaRowFromConfig);
  // Literal IEEE-754 and signed-integer byte patterns, independent of application encoders.
  const good = [0xA5, 0xFF, 0, 0x80, 0xFF, 0xFF, 0, 0, 0, 0x80, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0xC0, 0x3F, 0x3F, 0xC0, 0, 0, 0x96, 0xC0, 0x20, 0, 0, 0x12, 0x5A];
  const definitions = [
    field('header', 0, 'uint8'), field('signed8', 1, 'int8'), field('unsigned8', 1, 'uint8'),
    field('signed16min', 2, 'int16'), field('wordBE', 2, 'uint16', 'be'), field('wordLE', 2, 'uint16'),
    field('signed16minus1', 4, 'int16', 'be'), field('unsigned16max', 4, 'uint16'),
    field('signed32min', 6, 'int32'), field('dwordBE', 6, 'uint32', 'be'),
    field('unsigned32max', 10, 'uint32'), field('signed32minus1', 10, 'int32', 'be'),
    field('floatLE', 14, 'float32'), field('floatBE', 18, 'float32', 'be'), field('floatNegative', 23, 'float32', 'be'),
    ...Array.from({length: 8}, (_, bit) => field(`bit${bit}`, 22, `bit${bit}`))
  ];
  const expected = {header: 165, signed8: -1, unsigned8: 255, signed16min: -32768, wordBE: 128, wordLE: 32768, signed16minus1: -1, unsigned16max: 65535, signed32min: -2147483648, dwordBE: 128, unsigned32max: 4294967295, signed32minus1: -1, floatLE: 1.5, floatBE: 1.5, floatNegative: -2.5, bit0: 0, bit1: 1, bit2: 1, bit3: 0, bit4: 1, bit5: 0, bit6: 0, bit7: 1};
  const text = (panel, key) => refs.chartList.querySelector(`[data-chart-id="${panel.id}"] [data-numeric-value="parsed.${key}"] strong`)?.textContent;
  const refresh = async () => {scheduleRefresh(); await paint(); await wait(30);};
  try {
    closeVersionModal();
    state.theme = 'dark';
    state.layoutExpanded = true;
    state.parserMode = 'binary';
    state.deviceName = '状态设备';
    state.parser.binarySchema = schema;
    state.parser.binaryFields = clone(definitions);
    validateBinaryFields(state.parser.binaryFields, schema);
    const parsed = parseBinarySchemaFrameAt(good, schema, 0, definitions);
    check('known full-frame SUM8 accepted', parsed.status === 'ok');
    Object.entries(expected).forEach(([key, value]) => check(`literal vector ${key} = ${value}`, parsed.frame.values[key] === value));
    for (const [dataType, order, hex, value] of [
      ['int8', 'le', '80', -128], ['int8', 'le', '7F', 127], ['uint8', 'le', '00', 0],
      ['int16', 'le', 'FF 7F', 32767], ['int16', 'be', '80 00', -32768], ['uint16', 'be', '00 00', 0],
      ['int32', 'le', 'FF FF FF 7F', 2147483647], ['int32', 'be', '80 00 00 00', -2147483648], ['uint32', 'be', '00 00 00 00', 0],
      ['float32', 'le', '00 00 00 00', 0], ['float32', 'be', '3F 80 00 00', 1]
    ]) {
      const result = decodeBinaryFields(Uint8Array.from(hex.split(' ').map(byte => parseInt(byte, 16))), [field('edge', 0, dataType, order)]);
      check(`boundary ${dataType} ${order} ${hex}`, result[0].value === value);
    }
    const bitFields = Array.from({length: 8}, (_, bit) => field(`bit${bit}`, 0, `bit${bit}`));
    const walkingBits = ['10000000', '01000000', '00100000', '00010000', '00001000', '00000100', '00000010', '00000001'];
    [1, 2, 4, 8, 16, 32, 64, 128].forEach((byte, index) => check(`walking bit ${index}`, decodeBinaryFields(Uint8Array.of(byte), bitFields).map(item => item.value).join('') === walkingBits[index]));
    check('nonzero buffer index still uses frame-relative offset', parseBinarySchemaFrameAt([0, 0, ...good], schema, 2, definitions).frame.values.floatBE === 1.5);
    check('shared decoder does not rewrite input', good[1] === 255 && good[27] === 0x12);
    const first = createChart('numeric'); first.name = '状态'; first.bindings = ['parsed.signed8', 'parsed.floatLE', 'parsed.bit7'];
    const second = createChart('numeric'); second.name = '重复绑定'; second.bindings = ['parsed.signed8', 'parsed.bit0'];
    const curve = createChart('time'); curve.bindings = ['parsed.signed8', 'parsed.floatLE'];
    state.charts = [first, curve, second];
    clearRealtimeHistoryData();
    invalidateDerivedCaches();
    deriveData();
    syncUserConfigControls();
    await refresh();
    check('multiple numeric panels and chart share one ordered container', [...refs.chartList.children].map(node => node.dataset.chartId).join(',') === state.charts.map(item => item.id).join(','));
    check('numeric panel waits before first valid frame', text(first, 'signed8') === '等待' && text(second, 'signed8') === '等待');
    queueRxBytes(Uint8Array.from(good.slice(0, 12)), nowPreciseMs());
    await wait(130); await refresh();
    check('partial frame remains waiting after monitor idle timeout', text(first, 'signed8') === '等待' && !state.derived.numericSeries['parsed.signed8']);
    queueRxBytes(Uint8Array.from(good.slice(12)), nowPreciseMs());
    await wait(130); await refresh();
    check('fragmented frame updates multiple values and panels', text(first, 'signed8') === '-1' && text(second, 'signed8') === '-1' && text(first, 'floatLE') === '1.5');
    check('bit values display numeric 0 and 1', text(first, 'bit7') === '1' && text(second, 'bit0') === '0');
    check('curve and numeric panel consume identical decoded value', state.derived.numericSeries['parsed.signed8'].at(-1).v === -1 && state.derived.numericSeries['parsed.floatLE'].at(-1).v === 1.5);
    const next = [...good]; next[1] = 0xFE; next[27] = 0x11;
    queueRxBytes(Uint8Array.from(next), nowPreciseMs());
    await wait(130); await refresh();
    check('continuous reports update latest value', text(first, 'signed8') === '-2' && text(second, 'signed8') === '-2');
    const seriesBefore = clone(state.derived.numericSeries['parsed.signed8']);
    const bad = [...next]; bad[1] = 0xFD;
    state.recording.active = true;
    const rawBefore = state.session.rawChunks.length;
    queueRxBytes(Uint8Array.from(bad), nowPreciseMs());
    await wait(130); await refresh();
    check('bad checksum preserves latest valid values and curves', text(first, 'signed8') === '-2' && JSON.stringify(seriesBefore) === JSON.stringify(state.derived.numericSeries['parsed.signed8']));
    check('bad checksum still retains raw and recorded bytes', state.session.rawChunks.length === rawBefore + 1 && bytesToCompactHex(state.recording.rawChunks.at(-1).bytes) === bytesToCompactHex(bad));
    state.recording.active = false;
    const count = state.derived.numericSeries['parsed.signed8'].length;
    queueRxBytes(Uint8Array.from([...good, ...next]), nowPreciseMs());
    await wait(130); await refresh();
    check('coalesced frames each update the shared series', state.derived.numericSeries['parsed.signed8'].length === count + 2 && text(first, 'signed8') === '-2');
    const badFields = clone(definitions); badFields[0].offset = 29;
    reject('field outside full frame rejected', () => validateBinaryFields(badFields, schema));
    badFields[0] = field('overflow', 27, 'uint32');
    reject('multi-byte field ending outside frame rejected', () => validateBinaryFields(badFields, schema));
    check('out-of-range fields never produce a parsed frame', extractBinarySchemaFramesFromBytes(good, schema, badFields).frames.length === 0);
    const runtime = createDerivedRuntimeSeed('binary', 'realtime');
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: good, timestamp: 1000}, schema);
    const latestBefore = JSON.stringify(runtime.latestCards);
    state.parser.binaryFields = badFields;
    processDerivedBinaryChunk(runtime, {direction: 'rx', bytes: next, timestamp: 1100}, schema);
    check('invalid offset cannot overwrite valid runtime state', latestBefore === JSON.stringify(runtime.latestCards) && runtime.chartFrameCount === 1);
    state.parser.binaryFields = clone(definitions);
    for (const [name, patch] of [['duplicate name', {name: 'signed8'}], ['fractional offset', {offset: 1.5}], ['negative offset', {offset: -1}], ['unsupported float64', {dataType: 'float64'}], ['bad endian', {byteOrder: 'middle'}]]) {
      const fields = clone(definitions); Object.assign(fields[0], patch);
      reject(name, () => validateBinaryFields(fields, schema));
    }
    const legacyRows = [{kind: 'data', name: 'legacy', dataType: 'uint8'}];
    reject('fixed field cannot shadow existing decoded field', () => validateBinaryFields([field('legacy', 0, 'uint8')], legacyRows));
    document.getElementById('add-binary-field-btn').click();
    const added = state.parser.binaryFields.at(-1);
    let row = document.querySelector(`[data-binary-field-id="${added.id}"]`);
    const edit = (key, value) => {const input = row.querySelector(`[data-field-key="${key}"]`); input.value = value; input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));};
    edit('name', 'uiBit'); edit('offset', '22'); edit('dataType', 'bit7');
    row = document.querySelector(`[data-binary-field-id="${added.id}"]`);
    await wait(100); await refresh();
    check('field editor updates name offset and type', added.name === 'uiBit' && added.offset === 22 && added.dataType === 'bit7');
    check('single-byte and bit types disable byte order selector', row.querySelector('[data-field-key="byteOrder"]').disabled);
    check('new bit field is in shared decoder output', state.derived.numericSeries['parsed.uiBit'].at(-1).v === 1);
    row.querySelector('[data-remove-binary-field]').click();
    await wait(100); await refresh();
    check('field removal updates protocol definition', !state.parser.binaryFields.some(item => item.id === added.id));
    document.getElementById('add-numeric-panel-btn').click();
    await refresh();
    const addedPanel = state.charts.at(-1);
    check('numeric panel add button creates configurable component', addedPanel.type === 'numeric' && addedPanel.open);
    const checkbox = refs.chartList.querySelector(`[data-chart-id="${addedPanel.id}"] [data-numeric-binding="parsed.floatBE"]`);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', {bubbles: true}));
    await refresh();
    check('binding checkbox connects a defined field', addedPanel.bindings.includes('parsed.floatBE') && text(addedPanel, 'floatBE') === '1.5');
    const title = refs.chartList.querySelector(`[data-chart-id="${addedPanel.id}"] [data-numeric-title]`);
    title.value = '浮点上报'; title.dispatchEvent(new Event('input', {bubbles: true}));
    await refresh();
    check('numeric title updates through central refresh', addedPanel.name === '浮点上报' && refs.chartList.querySelector(`[data-chart-id="${addedPanel.id}"] [data-numeric-heading]`).textContent === '浮点上报');
    refs.chartList.querySelector(`[data-chart-id="${addedPanel.id}"] [data-chart-move-up]`).click();
    check('numeric component participates in common ordering', state.charts[state.charts.length - 2].id === addedPanel.id);
    for (const columns of [1, 2, 3]) {
      refs.componentColumns.value = String(columns); refs.componentColumns.dispatchEvent(new Event('change', {bubbles: true}));
      await refresh();
      const rects = [...refs.chartList.children].map(element => element.getBoundingClientRect());
      check(`numeric and curve panels equal width in ${columns} columns`, rects.every(rect => Math.abs(rect.width - rects[0].width) < 1));
      check(`${columns} columns stay user controlled at current window size`, getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length === columns);
    }
    const payload = buildDeviceConfigPayload();
    check('device JSON stores protocol fields without transient IDs', payload.config.parser.binary.fields.length === definitions.length && !('id' in payload.config.parser.binary.fields[0]));
    check('device JSON persists numeric bindings and component ordering', payload.config.charts.map(item => item.chartType).join(',') === state.charts.map(item => item.type).join(',') && payload.config.charts.find(item => item.title === '浮点上报').channels.bindings[0] === 'parsed.floatBE');
    check('device JSON excludes runtime values', !JSON.stringify(payload).includes('numericSeries') && !JSON.stringify(payload).includes('latestCards'));
    for (const [name, mutate] of [
      ['field range', file => {file.config.parser.binary.fields[0].offset = 99;}],
      ['missing numeric field', file => {file.config.charts.find(item => item.chartType === 'numeric').channels.bindings = ['parsed.missing'];}],
      ['unknown field property', file => {file.config.parser.binary.fields[0].scale = 2;}]
    ]) {const badFile = clone(payload); mutate(badFile); reject(`JSON rejects ${name}`, () => validateDeviceConfig(badFile));}
    const invalidImport = clone(payload); invalidImport.config.parser.binary.fields[0].offset = 99;
    const currentFields = JSON.stringify(snapshotBinaryFields());
    state.serial.connected = true;
    let invalidImportRejected = false;
    try { await openDeviceConfigText(JSON.stringify(invalidImport)); } catch (error) { invalidImportRejected = true; }
    check('invalid field import preserves live connection and current definition', invalidImportRejected && state.serial.connected && JSON.stringify(snapshotBinaryFields()) === currentFields);
    state.serial.connected = false;
    const prefs = buildLocalPrefsSnapshot();
    state.parser.binaryFields = []; state.charts = [];
    applyLocalPrefsSnapshot(prefs); syncUserConfigControls();
    await refresh();
    check('local preferences restore field definitions and numeric components', snapshotBinaryFields().length === definitions.length && state.charts.filter(item => item.type === 'numeric').length === 3);
    await openDeviceConfigText(JSON.stringify(payload));
    await refresh();
    check('JSON opens exact field definitions and bindings', JSON.stringify(snapshotBinaryFields()) === JSON.stringify(payload.config.parser.binary.fields) && state.charts.find(item => item.name === '浮点上报').bindings[0] === 'parsed.floatBE');
    check('JSON open never enables connection or sending', !state.serial.connected && state.serial.requireManualConnect && !state.autoSend.enabled && !state.conditionSend.enabled);
    const old = clone(payload); delete old.config.parser.binary.fields; old.config.charts = [];
    await openDeviceConfigText(JSON.stringify(old));
    await refresh();
    check('old device JSON without fields still opens', state.parser.binaryFields.length === 0);
    await openDeviceConfigText(JSON.stringify(payload));
    queueRxBytes(Uint8Array.from(good), nowPreciseMs());
    await wait(130); await refresh();
    check('restored numeric panel receives new valid reports', text(state.charts.find(item => item.name === '浮点上报'), 'floatBE') === '1.5');
    const sourceBefore = bytesToCompactHex(good);
    check('original report bytes unchanged after all display operations', sourceBefore === bytesToCompactHex(state.session.rawChunks.at(-1).bytes));
    state.charts.forEach(item => {item.open = false;});
    renderCharts(true); await paint();
    refs.chartList.scrollIntoView({block: 'start'});
    await wait(100);
    const result = parent.document.createElement('pre'); result.id = 'fixed-fields-result'; result.hidden = true; result.textContent = JSON.stringify({status: 'passed', checks}); parent.document.body.appendChild(result);
  } catch (error) {
    const result = parent.document.createElement('pre'); result.id = 'fixed-fields-result'; result.textContent = JSON.stringify({status: 'failed', error: String(error), stack: error.stack, checks}); parent.document.body.appendChild(result);
  }
});
