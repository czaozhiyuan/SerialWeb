requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const clone = value => JSON.parse(JSON.stringify(value));
  const reject = (name, fn) => { let failed = false; try { fn(); } catch (error) { failed = true; } check(name, failed); };
  const select = async columns => {
    refs.componentColumns.value = String(columns);
    refs.componentColumns.dispatchEvent(new Event('change', {bubbles: true}));
    await paint();
    await wait(70);
  };
  const resize = async width => { window.frameElement.style.width = `${width}px`; await paint(); await wait(100); await paint(); };
  const panels = () => [...refs.chartList.querySelectorAll('[data-chart-id]')];
  const verifyLayout = (name, columns) => {
    const elements = panels();
    const rects = elements.map(panel => panel.getBoundingClientRect());
    const list = refs.chartList.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(refs.chartList).columnGap);
    const padding = parseFloat(getComputedStyle(refs.chartList).paddingRight);
    const expectedWidth = (refs.chartList.clientWidth - padding - gap * (columns - 1)) / columns;
    check(`${name}: equal widths and unfilled last row`, rects.every(rect => Math.abs(rect.width - expectedWidth) < 2));
    check(`${name}: row-major stable order`, elements.every((panel, index) => panel.dataset.chartId === state.charts[index].id && (index % columns === 0 || Math.abs(rects[index].top - rects[index - 1].top) < 1) && (index < columns || rects[index].top > rects[index - columns].top)));
    check(`${name}: panels stay within grid`, rects.every(rect => rect.left >= list.left - 1 && rect.right <= list.right + 1));
    const canvasSizes = elements.map((panel, index) => {
      const wrap = panel.querySelector('.chart-canvas-wrap');
      const canvas = wrap.querySelector('canvas');
      return {pixelWidth: canvas.width, dpr: devicePixelRatio, width: wrap.getBoundingClientRect().width, canvasRight: canvas.getBoundingClientRect().right, wrapRight: wrap.getBoundingClientRect().right, plotW: state.charts[index].drawMeta?.plotW};
    });
    const validCanvases = canvasSizes.every(size => Math.abs(size.pixelWidth / size.dpr - Math.floor(size.width)) < 1 && size.canvasRight <= size.wrapRight + 1 && size.plotW > 0);
    if (!validCanvases) throw new Error(`${name}: canvas size mismatch ${JSON.stringify(canvasSizes)}`);
    check(`${name}: canvas matches actual container and has usable plot`, validCanvases);
    if (innerWidth >= 1024) {
      check(`${name}: toolbar fits each panel`, elements.every((panel, index) => {
        const toolbar = panel.querySelector('.chart-toolbar').getBoundingClientRect();
        return toolbar.left >= rects[index].left && toolbar.right <= rects[index].right;
      }));
    } else {
      check(`${name}: small window retains chosen columns`, getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length === columns);
    }
  };
  try {
    closeVersionModal();
    state.layoutExpanded = true;
    state.parserMode = 'binary';
    state.settings.txChecksum = normalizeProtocolChecksum();
    state.parser.binarySchema = [
      {kind: 'header', value: 'A5', name: ''},
      {kind: 'data', value: '', name: 'value', dataType: 'uint8'},
      {kind: 'footer', value: '5A', name: ''}
    ].map(normalizeBinarySchemaRowFromConfig);
    state.charts = ['time', 'fft', 'bar', 'time'].map(createChart);
    state.charts.forEach((chart, index) => {chart.name = `图表 ${index + 1}`; chart.bindings = ['parsed.value']; chart.fftWindow = 32;});
    clearRealtimeHistoryData();
    const start = nowPreciseMs();
    for (let index = 0; index < 40; index++) recordRawChunk('rx', Uint8Array.of(0xA5, 128 + Math.round(Math.sin(index / 3) * 80), 0x5A), start + index * 20);
    invalidateDerivedCaches();
    deriveData();
    syncUserConfigControls();
    renderCharts(true);
    await wait(100);
    check('all three existing chart types share the container', panels().length === 4 && state.charts.map(chart => chart.type).join(',') === 'time,fft,bar,time');
    check('select exposes only 1/2/3 columns', [...refs.componentColumns.options].map(option => option.value).join(',') === '1,2,3');
    const shell = refs.componentColumns.closest('.custom-select');
    const option = getCustomSelectMenu(shell).firstElementChild;
    scheduleRefresh({charts: true});
    await paint();
    check('normal data refresh does not recreate column menu options', getCustomSelectMenu(shell).firstElementChild === option);
    const rawBefore = JSON.stringify(state.session.rawChunks);
    const schemaBefore = JSON.stringify(state.parser.binarySchema);
    const seriesBefore = JSON.stringify(state.derived.numericSeries);
    const sendBefore = JSON.stringify({settings: state.settings, draft: state.sendDraft});
    state.charts[0].viewMode = 'manual';
    state.charts[0].viewZoomX = 2;
    const bindingsBefore = state.charts.map(chart => chart.bindings.join(',')).join('|');
    for (const width of [1440, 1024, 800, 721, 720, 600, 1440]) {
      await resize(width);
      for (const columns of [1, 2, 3]) {
        await select(columns);
        verifyLayout(`${width}px / selected ${columns}`, columns);
        check(`${width}px / selected ${columns}: choice retained`, state.ui.componentColumns === columns && refs.componentColumns.value === String(columns));
      }
    }
    check('column switches preserve chart bindings and manual zoom', state.charts.map(chart => chart.bindings.join(',')).join('|') === bindingsBefore && state.charts[0].viewMode === 'manual' && state.charts[0].viewZoomX === 2);
    check('column switches preserve raw bytes, decoded series, parser and send content', rawBefore === JSON.stringify(state.session.rawChunks) && seriesBefore === JSON.stringify(state.derived.numericSeries) && schemaBefore === JSON.stringify(state.parser.binarySchema) && sendBefore === JSON.stringify({settings: state.settings, draft: state.sendDraft}));
    const beforeWidth = panels()[0].querySelector('canvas').width;
    toggleSidebarCollapse();
    await wait(100);
    check('sidebar container resize repaints canvases', panels()[0].querySelector('canvas').width !== beforeWidth);
    verifyLayout('sidebar collapsed', 3);
    toggleSidebarCollapse();
    await wait(100);
    const firstId = state.charts[0].id;
    panels()[0].querySelector('[data-chart-move-down]').click();
    await wait(70);
    check('existing order button changes row-major order', state.charts[1].id === firstId && panels()[1].dataset.chartId === firstId);
    refs.addBarChartBtn.click();
    await wait(70);
    check('add component places it in next grid slot', state.charts.length === 5 && panels().at(-1).dataset.chartId === state.charts.at(-1).id);
    verifyLayout('after add', 3);
    panels()[1].querySelector('[data-chart-remove]').click();
    await wait(70);
    check('delete component compacts remaining positions', state.charts.length === 4 && !state.charts.some(chart => chart.id === firstId));
    verifyLayout('after delete', 3);
    panels()[0].querySelector('[data-chart-toggle]').click();
    check('chart configuration remains operable', panels()[0].querySelector('.chart-config').classList.contains('open'));
    panels()[0].querySelector('[data-chart-toggle]').click();
    const payload = buildDeviceConfigPayload();
    check('JSON persists selected columns and component order', payload.config.layout.componentColumns === 3 && payload.config.charts.map(chart => chart.title).join('|') === state.charts.map(chart => chart.name).join('|'));
    const prefs = buildLocalPrefsSnapshot();
    await select(1);
    applyLocalPrefsSnapshot(prefs); syncUserConfigControls();
    await wait(70);
    check('local preferences restore columns', state.ui.componentColumns === 3 && refs.componentColumns.value === '3');
    await openDeviceConfigText(JSON.stringify(payload));
    await wait(70);
    check('JSON opens columns and ordered component configuration', state.ui.componentColumns === 3 && payload.config.charts.map(chart => chart.title).join('|') === state.charts.map(chart => chart.name).join('|'));
    check('JSON import retains manual connect and disabled sending', !state.serial.connected && state.serial.requireManualConnect && !state.autoSend.enabled && !state.conditionSend.enabled);
    for (const value of [0, 4, 1.5, '3', null]) {
      const bad = clone(payload); bad.config.layout.componentColumns = value;
      reject(`invalid columns rejected: ${JSON.stringify(value)}`, () => validateDeviceConfig(bad));
    }
    const old = clone(payload); delete old.config.layout.componentColumns;
    await openDeviceConfigText(JSON.stringify(old));
    await wait(70);
    check('old JSON without columns defaults to one', state.ui.componentColumns === 1 && refs.componentColumns.value === '1');
    await select(3);
    await resize(600);
    const smallWindowSaved = buildDeviceConfigPayload();
    check('small window and JSON both retain three columns', smallWindowSaved.config.layout.componentColumns === 3 && getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length === 3);
    await resize(1440);
    verifyLayout('wide window keeps three columns after small window export', 3);
    const placeholder = document.createElement('article'); placeholder.textContent = '组件布局占位';
    refs.chartList.appendChild(placeholder);
    check('shared container gives non-chart children the same column width', Math.abs(placeholder.getBoundingClientRect().width - panels()[0].getBoundingClientRect().width) < 1);
    placeholder.remove();
    state.charts = [];
    renderCharts(true);
    check('empty state spans all columns', refs.chartList.firstElementChild.getBoundingClientRect().width >= refs.chartList.clientWidth - 2);
    applyUserConfigSnapshot(validateDeviceConfig(payload), {reconfigureSerial: false});
    await wait(70);
    await resize(parent.innerWidth);
    await select(3);
    check('final choice label is synced', refs.componentColumns.closest('.custom-select').querySelector('.custom-select-label').textContent.trim() === '3 列');
    await wait(70);
    const result = parent.document.createElement('pre'); result.id = 'component-columns-result'; result.hidden = true; result.textContent = JSON.stringify({status: 'passed', checks}); parent.document.body.appendChild(result);
  } catch (error) {
    const result = parent.document.createElement('pre'); result.id = 'component-columns-result'; result.textContent = JSON.stringify({status: 'failed', error: String(error), stack: error.stack, checks}); parent.document.body.appendChild(result);
  }
});
