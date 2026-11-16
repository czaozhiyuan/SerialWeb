requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = text => queueRxBytes(new TextEncoder().encode(text), nowPreciseMs());
  const reset = () => {
    clearRealtimeHistoryData();
    resetRxSegmentationState();
    state.settings.textEncoding = 'utf-8';
    state.settings.rxDisplayMode = 'text';
  };
  try {
    closeVersionModal();
    state.layoutExpanded = false;
    state.activeTimelineId = 'realtime';
    state.conditionSend.enabled = false;
    state.presetSend.enabled = false;
    state.settings.baudRate = '9600';
    state.settings.appendTimestamp = false;
    applyLayout(false);
    reset();
    send('status=');
    await wait(60);
    check('no split before 100 ms', state.serial.rxActiveEvent !== null);
    send('12');
    await wait(60);
    check('new data restarts idle deadline', state.serial.rxActiveEvent !== null && state.session.liveEvents.length === 1);
    const rawBefore = JSON.stringify(state.session.rawChunks);
    await wait(60);
    check('idle closes unterminated line', state.serial.rxActiveEvent === null && state.session.liveEvents[0].metadata.rxOpen === false);
    check('idle preserves last receive timestamp', state.session.liveEvents[0].timestamp === state.session.rawChunks.at(-1).timestamp);
    check('idle does not insert raw bytes', JSON.stringify(state.session.rawChunks) === rawBefore);
    send('status=13');
    await wait(120);
    check('next idle burst starts another line', state.session.liveEvents.length === 2 && state.session.liveEvents[1].text === 'status=13');
    invalidateDerivedCaches();
    deriveData();
    renderMonitor();
    check('monitor renders two lines', refs.terminal.querySelectorAll('.log-line.rx').length === 2);
    const replay = rebuildEventsFromRawChunks(state.session.rawChunks);
    check('replay retains idle burst boundary', replay.length === 2 && replay[0].text === 'status=12' && replay[1].text === 'status=13');
    const exported = buildTimelineExportPayload({rawChunks: state.session.rawChunks, startTs: state.session.rawChunks[0].timestamp});
    check('raw export contains no synthetic newline', new TextDecoder().decode(Uint8Array.from(exported.chunks.flatMap(chunk => chunk.bytes))) === 'status=12status=13');
    state.settings.rxDisplayMode = 'hex';
    renderMonitor();
    check('HEX monitor uses idle burst boundary', refs.terminal.querySelectorAll('.log-line.rx').length === 2);

    reset();
    const timestamp = nowPreciseMs();
    queueRxBytes(new TextEncoder().encode('first'), timestamp);
    queueRxBytes(new TextEncoder().encode('second'), timestamp + 100);
    check('delayed timer still splits at 100 ms', state.session.liveEvents.length === 2);
    check('replay splits at exact threshold', rebuildEventsFromRawChunks(state.session.rawChunks).length === 2);
    reset();
    queueRxBytes(new TextEncoder().encode('first'), timestamp);
    queueRxBytes(new TextEncoder().encode('second'), timestamp + 99);
    check('99 ms gap stays in one line', state.session.liveEvents.length === 1);
    check('replay preserves short gap', rebuildEventsFromRawChunks(state.session.rawChunks).length === 1);

    reset();
    send('one\r');
    await wait(120);
    send('\ntwo\n\nthree\r\n');
    await wait(120);
    check('CRLF split adds no extra line and explicit blank lines survive', state.session.liveEvents.map(event => event.text).join('|') === 'one|two||three');

    reset();
    const unicode = new TextEncoder().encode('A中');
    queueRxBytes(unicode.slice(0, 2), nowPreciseMs());
    await wait(120);
    check('incomplete UTF-8 prevents splitting a character', state.serial.rxActiveEvent !== null);
    queueRxBytes(unicode.slice(2), nowPreciseMs());
    await wait(120);
    check('UTF-8 continuation stays intact', state.session.liveEvents.length === 1 && state.session.liveEvents[0].text === 'A中');

    reset();
    state.settings.textEncoding = 'utf-16le';
    queueRxBytes(Uint8Array.from([65, 0, 45]), nowPreciseMs());
    await wait(120);
    queueRxBytes(Uint8Array.from([78]), nowPreciseMs());
    await wait(120);
    check('UTF-16LE continuation stays intact', state.session.liveEvents.length === 1 && state.session.liveEvents[0].text === 'A中');

    reset();
    send('discard');
    clearRealtimeHistoryData();
    await wait(120);
    check('clear cancels idle callback', state.serial.rxIdleTimerId === null && state.session.liveEvents.length === 0);
    send('disconnect');
    await disconnectSerial('manual');
    await wait(120);
    check('disconnect cancels idle timer', state.serial.rxIdleTimerId === null && state.serial.rxActiveEvent === null);
    reset();
    send('status=12');
    await wait(120);
    send('status=13');
    await wait(120);
    renderMonitor();
    const result = document.createElement('pre');
    result.id = 'rx-idle-result';
    result.hidden = true;
    result.textContent = JSON.stringify({status: 'passed', checks});
    document.body.appendChild(result);
  } catch (error) {
    const result = document.createElement('pre');
    result.id = 'rx-idle-result';
    result.textContent = JSON.stringify({status: 'failed', error: String(error), checks});
    document.body.appendChild(result);
  }
});
