requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const refresh = async () => {scheduleRefresh({charts: true}); await paint(); await wait(20);};
  const reject = (name, fn) => {let failed = false; try {fn();} catch (error) {failed = true;} check(name, failed);};
  const parameter = (name, offset, dataType, defaultValue, byteOrder = 'le', extra = {}) => ({id: uid('schema'), name, offset, dataType, defaultValue, byteOrder, min: '', max: '', options: '', ...extra});
  const make = (template, parameters = [], checksum = normalizeProtocolChecksum()) => ({...createCommand(), name: '测试指令', template, parameters, checksum});
  const hex = frame => bytesToCompactHex(frame.bytes);
  const card = command => refs.chartList.querySelector(`[data-command-id="${command.id}"]`);
  try {
    closeVersionModal(); state.theme = 'dark'; state.layoutExpanded = true; state.parserMode = 'binary';
    state.deviceName = '指令状态设备';
    state.parser.binaryFields = [];
    state.parser.binarySchema = [
      {kind: 'header', value: 'A5'}, {kind: 'data', value: '', name: 'state', dataType: 'uint8'},
      {kind: 'checksum', name: 'checksum', checksum: {enabled: true, algorithm: 'sum8', start: 0, length: 2, byteOrder: 'le'}}, {kind: 'footer', value: '5A'}
    ].map(normalizeBinarySchemaRowFromConfig);
    const typed = make('A5 ' + '00 '.repeat(23) + '5A', [
      parameter('i8', 1, 'int8', '-128'), parameter('u8', 2, 'uint8', '255'),
      parameter('i16', 3, 'int16', '-32768'), parameter('u16', 5, 'uint16', '65535', 'be'),
      parameter('i32', 7, 'int32', '-2147483648'), parameter('u32', 11, 'uint32', '4294967295', 'be'),
      parameter('f32le', 15, 'float32', '1.5'), parameter('f32be', 19, 'float32', '-2.5', 'be')
    ], {enabled: true, algorithm: 'sum8', start: 0, length: 23, offset: 23, byteOrder: 'le'});
    check('independent typed frame bytes and SUM8', hex(buildCommandFrame(typed)) === 'A580FF0080FFFF00000080FFFFFFFF0000C03FC0200000FD5A');
    check('fixed command without parameters', hex(buildCommandFrame(make('AA 55 00'))) === 'AA5500');
    const modbus = make('01 03 00 00 00 0A 00 00', [parameter('数量', 5, 'uint8', '10', 'le', {min: '1', max: '125'})], {enabled: true, algorithm: 'crc16-modbus', start: 0, length: 6, offset: 6, byteOrder: 'le'});
    modbus.name = '读取寄存器';
    check('known CRC-16/MODBUS C5 CD', hex(buildCommandFrame(modbus)) === '01030000000AC5CD');
    const bigCRC = clone(modbus); bigCRC.checksum.byteOrder = 'be';
    check('CRC high-byte-first command output', hex(buildCommandFrame(bigCRC)) === '01030000000ACDC5');
    for (const [type, order, value, expected] of [
      ['int8', 'le', '-128', '80'], ['int8', 'le', '127', '7F'], ['uint8', 'le', '255', 'FF'],
      ['int16', 'le', '-32768', '0080'], ['int16', 'be', '32767', '7FFF'], ['uint16', 'le', '65535', 'FFFF'],
      ['int32', 'le', '-2147483648', '00000080'], ['int32', 'be', '2147483647', '7FFFFFFF'], ['uint32', 'be', '4294967295', 'FFFFFFFF'],
      ['float32', 'le', '1.5', '0000C03F'], ['float32', 'be', '-2.5', 'C0200000'], ['float32', 'le', '0', '00000000']
    ]) {
      const size = FIXED_FIELD_TYPES.find(item => item.value === type).bytes;
      check(`typed boundary ${type} ${order} ${value}`, hex(buildCommandFrame(make('00 '.repeat(size), [parameter('边界', 0, type, value, order)]))) === expected);
    }
    const sum = make('00 00', [parameter('数值', 0, 'uint8', '1')], {enabled: true, algorithm: 'sum8', start: 0, length: 1, offset: 1, byteOrder: 'le'});
    check('parameter changes recompute checksum', hex(buildCommandFrame(sum, ['2'])) === '0202' && hex(buildCommandFrame(sum, ['255'])) === 'FFFF');
    const noDefault = clone(sum); noDefault.parameters[0].defaultValue = '';
    check('definition may leave default empty for manual entry', validateCommandDefinition(noDefault).length === 2);
    reject('missing default still requires live input', () => buildCommandFrame(noDefault));
    check('live input works without default', hex(buildCommandFrame(noDefault, ['2'])) === '0202');
    const noDefaultBadRange = clone(noDefault); noDefaultBadRange.parameters[0].min = 'invalid';
    reject('empty default does not skip range validation', () => validateCommandDefinition(noDefaultBadRange));
    for (const [algorithm, expected] of [['xor8', '1212'], ['lrc8', '12EE']]) {
      const command = clone(sum); command.checksum.algorithm = algorithm;
      check(`shared ${algorithm} command`, hex(buildCommandFrame(command, ['18'])) === expected);
    }
    const newline = make('00 00', [parameter('数据', 1, 'uint8', '65')], {enabled: true, algorithm: 'sum8', start: 1, length: 2, offset: 0, byteOrder: 'le'});
    newline.appendNewline = true; newline.newlineMode = 'n';
    check('newline appended before checksum range calculation', hex(buildCommandFrame(newline)) === '4B410A');
    const enumCommand = make('00', [parameter('模式', 0, 'uint8', '1e0', 'le', {options: '停止=0\n运行=1'})]);
    enumCommand.name = '设置模式';
    check('enum values use the same numeric encoder', hex(buildCommandFrame(enumCommand, ['0'])) === '00' && hex(buildCommandFrame(enumCommand)) === '01');
    for (const [name, change] of [
      ['missing parameter', command => buildCommandFrame(command, [''])],
      ['non-numeric parameter', command => buildCommandFrame(command, ['abc'])],
      ['integer fraction', command => buildCommandFrame(command, ['1.5'])],
      ['uint8 underflow', command => buildCommandFrame(command, ['-1'])],
      ['uint8 overflow', command => buildCommandFrame(command, ['256'])],
      ['non-finite value', command => buildCommandFrame(command, ['Infinity'])],
      ['out-of-template offset', command => {command.parameters[0].offset = 2; return buildCommandFrame(command);}],
      ['fractional offset', command => {command.parameters[0].offset = 0.5; return buildCommandFrame(command);}],
      ['overlapping parameters', command => {command.parameters.push(parameter('重复', 0, 'uint8', '0')); return buildCommandFrame(command);}],
      ['overlapping checksum field', command => {command.parameters[0].offset = 1; return buildCommandFrame(command);}],
      ['overlapping checksum range', command => {command.checksum.length = 2; return buildCommandFrame(command);}],
      ['invalid template text', command => {command.template = 'AA ZZ'; return buildCommandFrame(command);}],
      ['empty template', command => {command.template = ''; return buildCommandFrame(command);}],
      ['reversed range', command => {command.parameters[0].min = '10'; command.parameters[0].max = '0'; return buildCommandFrame(command);}],
      ['configured minimum', command => {command.parameters[0].min = '2'; return buildCommandFrame(command);}],
      ['invalid range text', command => {command.parameters[0].max = 'abc'; return buildCommandFrame(command);}]
    ]) reject(name, () => change(clone(sum)));
    reject('float32 overflow rejected', () => buildCommandFrame(make('00 00 00 00', [parameter('浮点溢出', 0, 'float32', '3.5e38')])));
    reject('enum rejects undefined value', () => buildCommandFrame(enumCommand, ['2']));
    const duplicate = clone(enumCommand); duplicate.parameters[0].options = 'A=0\nB=0';
    reject('enum duplicate values rejected', () => buildCommandFrame(duplicate));
    const invalidEnum = clone(enumCommand); invalidEnum.parameters[0].options = '格式错误';
    reject('malformed enum rejected', () => buildCommandFrame(invalidEnum));
    const panel = createChart('command'); panel.name = '设备控制'; panel.commands = [modbus, enumCommand, make('AA 55')];
    panel.commands[2].name = '固定指令';
    const numeric = createChart('numeric'); numeric.name = '独立状态上报'; numeric.bindings = ['parsed.state'];
    const curve = createChart('time'); curve.bindings = ['parsed.state'];
    state.charts = [panel, numeric, curve];
    clearRealtimeHistoryData(); invalidateDerivedCaches(); deriveData(); syncUserConfigControls();
    await refresh();
    check('disconnected command button is disabled with explanation', card(modbus).querySelector('[data-send-command]').disabled && card(modbus).querySelector('[data-command-status]').textContent.includes('未连接'));
    check('preview already includes CRC while disconnected', card(modbus).querySelector('[data-command-preview]').textContent.includes('C5 CD'));
    check('enum dropdown normalizes equivalent numeric default', card(enumCommand).querySelector('[data-command-value]').value === '1');
    const writes = [];
    state.serial.connected = true; state.serial.disconnecting = false;
    state.serial.writer = {ready: Promise.resolve(), write: async bytes => {writes.push(Uint8Array.from(bytes));}};
    state.settings.appendNewline = true;
    state.settings.txChecksum = {enabled: true, algorithm: 'sum8', start: 0, length: 100, offset: 0, byteOrder: 'le'};
    await refresh();
    const before = writes.length;
    const preview = card(modbus).querySelector('[data-command-preview]').textContent.replace('最终 HEX：', '');
    card(modbus).querySelector('[data-send-command]').click();
    await wait(30); await refresh();
    check('actual command button writes exact preview once', writes.length === before + 1 && bytesToHex(writes.at(-1)) === preview);
    check('command checksum and newline are independent of global TX settings', bytesToCompactHex(writes.at(-1)) === '01030000000AC5CD');
    check('send uses ordinary logging and metadata', state.session.liveEvents.at(-1).metadata.source === 'command' && state.session.liveEvents.at(-1).metadata.commandName === '读取寄存器');
    check('result describes only serial send completion', card(modbus).querySelector('[data-command-status]').textContent === '已发送');
    check('sending does not invent device state', !state.derived.numericSeries['parsed.state']);
    const input = card(modbus).querySelector('[data-command-value]'); input.value = '11'; input.dispatchEvent(new Event('input', {bubbles: true}));
    await refresh();
    check('parameter input updates preview and clears stale send result', !card(modbus).querySelector('[data-command-preview]').textContent.includes('C5 CD') && card(modbus).querySelector('[data-command-status]').textContent === '');
    input.value = '126'; input.dispatchEvent(new Event('input', {bubbles: true})); await refresh();
    const blocked = writes.length;
    check('invalid input shows parameter-specific error and blocks button', card(modbus).querySelector('[data-send-command]').disabled && card(modbus).querySelector('[data-command-preview]').textContent.includes('数量'));
    check('invalid input cannot reach serial writer', !await sendCommand(panel, modbus) && writes.length === blocked);
    input.value = '10'; input.dispatchEvent(new Event('input', {bubbles: true})); await refresh();
    let finishWrite;
    state.serial.writer.write = async bytes => {writes.push(Uint8Array.from(bytes)); await new Promise(resolve => {finishWrite = resolve;});};
    const pending = sendCommand(panel, modbus); await paint();
    check('pending write disables repeat send and parameter edits', card(modbus).querySelector('[data-send-command]').disabled && card(modbus).querySelector('[data-command-value]').disabled);
    check('pending command cannot be submitted twice', !await sendCommand(panel, modbus));
    finishWrite(); await pending; await refresh();
    check('write completion restores editable parameters', !card(modbus).querySelector('[data-command-value]').disabled);
    state.serial.writer.write = async () => {throw new Error('mock write failure');};
    check('writer failure reports only send failure', !await sendCommand(panel, modbus));
    await refresh();
    check('failure is visible without device-success claim', card(modbus).querySelector('[data-command-status]').textContent.includes('发送失败') && !card(modbus).querySelector('[data-command-status]').textContent.includes('执行成功'));
    state.serial.writer.write = async bytes => {writes.push(Uint8Array.from(bytes));};
    queueRxBytes(Uint8Array.of(0xA5, 7, 0xAC, 0x5A), nowPreciseMs());
    await wait(130); scheduleRefresh(); await paint();
    check('independent incoming report updates state and curve', state.derived.numericSeries['parsed.state'].at(-1).v === 7 && refs.chartList.querySelector(`[data-chart-id="${numeric.id}"] [data-numeric-value="parsed.state"] strong`).textContent === '7');
    document.getElementById('add-command-panel-btn').click(); await refresh();
    const addedPanel = state.charts.at(-1); let added = addedPanel.commands[0];
    check('UI adds a configurable command panel', addedPanel.type === 'command' && addedPanel.open);
    card(added).querySelector('details').open = true;
    card(added).querySelector('[data-add-command-param]').click(); await refresh();
    added = addedPanel.commands[0];
    const edit = (selector, value, checkbox = false) => {const target = card(added).querySelector(selector); if (checkbox) target.checked = value; else target.value = value; target.dispatchEvent(new Event(target.tagName === 'SELECT' || checkbox ? 'change' : 'input', {bubbles: true}));};
    edit('[data-command-key="name"]', '设置速度'); edit('[data-command-key="template"]', 'AA 00 00 00');
    edit('[data-command-param-key="name"]', '速度'); edit('[data-command-param-key="offset"]', '1');
    edit('[data-command-param-key="dataType"]', 'uint16'); edit('[data-command-param-key="defaultValue"]', '500');
    edit('[data-command-param-key="min"]', '0'); edit('[data-command-param-key="max"]', '1000');
    edit('[data-command-param-key="options"]', '低速=100\n高速=500');
    edit('[data-checksum-key="enabled"]', true, true); edit('[data-checksum-key="length"]', '3'); edit('[data-checksum-key="offset"]', '3');
    await refresh();
    check('UI config writes typed template and checksum', card(added).querySelector('[data-command-preview]').textContent.endsWith('AA F4 01 9F'));
    const endian = card(added).querySelector('[data-command-param-key="byteOrder"]');
    check('multi-byte type enables endian selector and its custom trigger', !endian.disabled && !endian.closest('.custom-select').querySelector('button').disabled);
    const mode = card(added).querySelector('[data-command-value]'); mode.value = '100'; mode.dispatchEvent(new Event('change', {bubbles: true})); await refresh();
    check('enum UI changes encoded bytes and checksum', card(added).querySelector('[data-command-preview]').textContent.endsWith('AA 64 00 0E'));
    const sendCount = writes.length; card(added).querySelector('[data-send-command]').click(); await wait(30); await refresh();
    check('configured UI button transmits same final bytes', writes.length === sendCount + 1 && bytesToCompactHex(writes.at(-1)) === 'AA64000E');
    refs.chartList.querySelector(`[data-chart-id="${addedPanel.id}"] [data-add-command]`).click(); await refresh();
    check('one panel supports multiple independent buttons', addedPanel.commands.length === 2);
    const removable = addedPanel.commands.at(-1); card(removable).querySelector('[data-remove-command]').click(); await refresh();
    check('command deletion preserves remaining button', addedPanel.commands.length === 1 && addedPanel.commands[0].id === added.id);
    for (const columns of [1, 2, 3]) {
      refs.componentColumns.value = String(columns); refs.componentColumns.dispatchEvent(new Event('change', {bubbles: true})); await refresh();
      const widths = [...refs.chartList.children].map(element => element.getBoundingClientRect().width);
      check(`command numeric and curve components share ${columns} columns`, widths.every(width => Math.abs(width - widths[0]) < 1) && getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length === columns);
    }
    state.settings.txChecksum = normalizeProtocolChecksum(); syncUserConfigControls(); await refresh();
    const payload = buildDeviceConfigPayload();
    const saved = payload.config.charts.find(item => item.title === addedPanel.name).commands[0];
    check('JSON saves definitions and defaults instead of edited runtime value', saved.parameters[0].defaultValue === '500' && saved.parameters[0].options === '低速=100\n高速=500' && !('id' in saved));
    check('JSON excludes command results and runtime inputs', !JSON.stringify(payload).includes('commandRuntime') && !JSON.stringify(payload).includes('发送失败'));
    for (const [name, mutate] of [
      ['parameter overlap', file => {file.config.charts.find(item => item.chartType === 'command').commands[0].parameters[0].offset = 6;}],
      ['bad template', file => {file.config.charts.find(item => item.chartType === 'command').commands[0].template = 'ZZ';}],
      ['invalid default', file => {file.config.charts.find(item => item.chartType === 'command').commands[0].parameters[0].defaultValue = 'abc'; }],
      ['unsupported ACK setting', file => {file.config.charts.find(item => item.chartType === 'command').commands[0].ackTimeout = 100; }]
    ]) {const invalid = clone(payload); mutate(invalid); reject(`JSON rejects ${name}`, () => validateDeviceConfig(invalid));}
    const prefs = buildLocalPrefsSnapshot(); state.charts = [];
    applyLocalPrefsSnapshot(prefs); syncUserConfigControls(); await refresh();
    check('local preferences restore command definitions and types', state.charts.filter(item => item.type === 'command').length === 2 && state.charts.some(item => item.commands?.some(command => command.name === '设置速度')));
    state.serial.connected = false; state.serial.writer = null;
    const writesBeforeImport = writes.length;
    await openDeviceConfigText(JSON.stringify(payload)); await refresh();
    const restoredPanel = state.charts.find(item => item.name === addedPanel.name); const restored = restoredPanel.commands[0];
    check('JSON opens exact command rules and parameter defaults', JSON.stringify(snapshotCommand(restored)) === JSON.stringify(saved) && commandInputValues(restored)[0] === '500');
    check('JSON open causes no automatic connection or transmission', !state.serial.connected && state.serial.requireManualConnect && writes.length === writesBeforeImport && !state.autoSend.enabled && !state.conditionSend.enabled);
    check('restored preview uses default rather than old runtime input', card(restored).querySelector('[data-command-preview]').textContent.endsWith('AA F4 01 9F'));
    const old = clone(payload); old.config.charts = old.config.charts.filter(item => item.chartType !== 'command');
    await openDeviceConfigText(JSON.stringify(old)); await refresh();
    check('pre-command device JSON still opens', !state.charts.some(item => item.type === 'command'));
    await openDeviceConfigText(JSON.stringify(payload)); await refresh();
    state.charts.forEach(item => {item.open = false;}); renderCharts(true); await paint();
    refs.chartList.scrollIntoView({block: 'start'}); await wait(80);
    const result = parent.document.createElement('pre'); result.id = 'command-panels-result'; result.hidden = true; result.textContent = JSON.stringify({status: 'passed', checks}); parent.document.body.appendChild(result);
  } catch (error) {
    const result = parent.document.createElement('pre'); result.id = 'command-panels-result'; result.textContent = JSON.stringify({status: 'failed', error: String(error), stack: error.stack, checks}); parent.document.body.appendChild(result);
  }
});
