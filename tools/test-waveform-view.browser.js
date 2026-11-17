requestAnimationFrame(async () => {
  const checks = [];
  const check = (name, condition) => {if (!condition) throw new Error(name); checks.push(name);};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const equal = (a,b) => Math.abs(a-b) < 1e-6;
  const panel = chart => refs.chartList.querySelector(`[data-chart-id="${chart.id}"]`);
  const click = (chart, selector) => panel(chart).querySelector(selector).click();
  const ranges = (chart, values) => {
    if (!chart.open) click(chart, '[data-chart-toggle]');
    ['x-min','x-max','y-min','y-max'].forEach((key,index) => {
      const input = panel(chart).querySelector(`[data-chart-range="${key}"]`); input.value = values[index]; input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    click(chart, '[data-chart-range-apply]');
  };
  try {
    closeVersionModal(); state.layoutExpanded = true; state.parserMode = 'binary';
    state.settings.txChecksum = normalizeProtocolChecksum();
    state.parser.binaryFields = [{name:'second',offset:1,dataType:'uint8',byteOrder:'le'}];
    state.parser.binarySchema = [{kind:'header',value:'A5'}, {kind:'data',name:'value',dataType:'uint8'}, {kind:'footer',value:'5A'}].map(normalizeBinarySchemaRowFromConfig);
    state.charts = ['time','fft','time'].map(createChart);
    state.charts.forEach(chart => {chart.bindings=['parsed.value'];chart.fftWindow=32;});
    clearRealtimeHistoryData(); const start=nowPreciseMs();
    for (let i=0;i<40;i++) recordRawChunk('rx',Uint8Array.of(0xA5,128+Math.round(80*Math.sin(i/3)),0x5A), start+i*20);
    invalidateDerivedCaches(); deriveData(); syncUserConfigControls(); renderCharts(true); await wait(120); await paint();
    const chart = state.charts[0], fft = state.charts[1];
    check('real pipeline supplies waveform and FFT', chart.drawMeta?.type==='time' && fft.drawMeta?.type==='fft' && state.derived.numericSeries['parsed.value'].length===40);
    const samples = JSON.stringify(state.derived.numericSeries);
    for (const target of [chart,fft]) {
      const before = structuredClone(target.drawMeta);
      click(target, '[data-chart-zoom="x:2"]');
      check(`${target.type} X zoom leaves Y unchanged`, equal(target.drawMeta.xRange.range,before.xRange.range/2) && equal(target.drawMeta.yRange.min,before.yRange.min) && equal(target.drawMeta.yRange.max,before.yRange.max));
      const oldX=structuredClone(target.drawMeta.xRange);
      click(target, '[data-chart-zoom="y:2"]');
      check(`${target.type} Y zoom leaves X unchanged`, equal(target.drawMeta.xRange.min,oldX.min) && equal(target.drawMeta.xRange.max,oldX.max) && equal(target.drawMeta.yRange.range,before.yRange.range/2));
      ranges(target, target.type==='time' ? [-800,-100,-20,260] : [10,80,5,100]);
      check(`${target.type} manual ranges apply exactly`, equal(target.drawMeta.yRange.min,target.type==='time'?-20:5) && equal(target.drawMeta.yRange.max,target.type==='time'?260:100) && equal(target.drawMeta.xRange.min,target.type==='time'?-800:10));
      const saved=JSON.stringify(snapshotChartConfig(target));
      for (const invalid of [['','1','0','1'],['2','1','0','1'],['0','1','2','2']]) {
        ranges(target,invalid);
        check(`${target.type} invalid range ${invalid.join(',')} rejected without view change`, !!panel(target).querySelector('[data-chart-range-error]').textContent && JSON.stringify(snapshotChartConfig(target))===saved);
      }
      ranges(target, target.type==='time' ? [-800,-100,-20,260] : [10,80,5,100]);
      const meta=target.drawMeta, wrap=panel(target).querySelector('.chart-canvas-wrap'), rect=wrap.getBoundingClientRect();
      const x=rect.left+meta.left+meta.plotW/2,y=rect.top+meta.top+meta.plotH/2;
      const beforePan=structuredClone(target.drawMeta);
      wrap.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
      document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x+12,clientY:y+10}));
      document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      check(`${target.type} plot pans both axes without changing spans`, target.drawMeta.xRange.min!==beforePan.xRange.min && target.drawMeta.yRange.min!==beforePan.yRange.min && equal(target.drawMeta.xRange.range,beforePan.xRange.range) && equal(target.drawMeta.yRange.range,beforePan.yRange.range));
      const wheelMeta=target.drawMeta, wheelRect=wrap.getBoundingClientRect();
      const yBeforeWheel=structuredClone(wheelMeta.yRange);
      wrap.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-1,clientX:wheelRect.left+wheelMeta.left+wheelMeta.plotW/2,clientY:wheelRect.top+wheelMeta.bottom+8}));
      check(`${target.type} X-axis wheel preserves Y`,equal(target.drawMeta.yRange.min,yBeforeWheel.min) && equal(target.drawMeta.yRange.max,yBeforeWheel.max) && target.drawMeta.xRange.range<beforePan.xRange.range);
      const xBeforeWheel=structuredClone(target.drawMeta.xRange);
      wrap.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-1,clientX:wheelRect.left+wheelMeta.left-8,clientY:wheelRect.top+wheelMeta.top+wheelMeta.plotH/2}));
      check(`${target.type} Y-axis wheel preserves X`,equal(target.drawMeta.xRange.min,xBeforeWheel.min) && equal(target.drawMeta.xRange.max,xBeforeWheel.max) && target.drawMeta.yRange.range<yBeforeWheel.range);
      click(target,'[data-chart-auto]');
      check(`${target.type} reset restores automatic view`,target.viewMode==='auto' && target.viewFollowLatestX && target.viewZoomX===1 && target.viewZoomY===1 && !panel(target).querySelector('[data-chart-range-error]').textContent);
    }
    check('all display interactions preserve original samples and timestamps', JSON.stringify(state.derived.numericSeries)===samples);
    ranges(chart,[-1000,0,0,256]); const origin=chart.drawMeta.timeOrigin;
    recordRawChunk('rx',Uint8Array.of(0xA5,90,0x5A),start+1800);invalidateDerivedCaches();deriveData();drawChart(chart);
    check('manual time view stays frozen while reception continues', chart.drawMeta.timeOrigin===origin && state.derived.numericSeries['parsed.value'].length===41);
    click(chart,'[data-chart-auto]');drawChart(chart);
    check('reset follows newest received timestamp again',chart.drawMeta.timeOrigin>origin && panel(chart).querySelector('[data-chart-view-status]').textContent.includes('实时跟随'));
    // Test the canvas grid using its actual stroke positions and restored dash state.
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),strokes=[];
    const lines=[]; const move=ctx.moveTo.bind(ctx),line=ctx.lineTo.bind(ctx);
    ctx.moveTo=(x,y)=>{lines.push([x,y]);move(x,y);};ctx.lineTo=(x,y)=>{lines.push([x,y]);line(x,y);};
    const originalStroke=ctx.stroke.bind(ctx);ctx.stroke=()=>{strokes.push(ctx.getLineDash());originalStroke();};
    for(const theme of ['light','dark']) {state.theme=theme;drawGrid(ctx,10,20,200,100,{min:0,max:10,range:10},{min:0,max:10,range:10},[0,5,10],[0,5,10]);}
    check('both themes render dashed main grid and restore canvas dash',strokes.length===12 && strokes.every(d=>d.join(',')==='4,4') && ctx.getLineDash().length===0);
    check('grid line positions match axis tick coordinates',JSON.stringify(lines.slice(0,12))===JSON.stringify([[10,120],[210,120],[10,70],[210,70],[10,20],[210,20],[10,20],[10,120],[110,20],[110,120],[210,20],[210,120]]));
    for (const theme of ['light','dark']) {state.theme=theme;applyTheme();drawChart(chart);check(`${theme} theme repaints without changing view`,chart.viewMode==='auto' && chart.drawMeta.timeOrigin>origin);}
    for (const columns of [1,2,3]) {
      state.ui.componentColumns=columns;renderCharts(true);await paint();
      check(`${columns} columns kept exactly as selected`,getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length===columns);
      check(`${columns} columns repaint to container width`,state.charts.every(c=>Math.abs(document.getElementById(`canvas-${c.id}`).width/devicePixelRatio-Math.floor(panel(c).querySelector('.chart-canvas-wrap').getBoundingClientRect().width))<1));
    }
    state.ui.componentColumns=1;renderCharts(true);await paint();
    chart.alignScale=false; chart.bindings=['parsed.value','parsed.second'];chart.yAxisBindingKey='__all__';resetChartView(chart);drawChart(chart);renderCharts(true);await paint();
    ranges(chart,[-2000,0,-100,500]);
    check('all-channel range updates visible axes and per-channel views',chart.drawMeta.yRange.min===-100 && chart.drawMeta.yRange.max===500 && chart.bindings.every(k=>chart.bindingViewY[k].baseMin===-100));
    chart.yAxisBindingKey='parsed.value';drawChart(chart);ranges(chart,[-2000,0,0,100]);
    check('selected channel range leaves other channel unchanged',chart.bindingViewY['parsed.second'].baseMin===-100 && chart.drawMeta.yRange.max===100);
    const selectedMeta=chart.drawMeta, selectedWrap=panel(chart).querySelector('.chart-canvas-wrap'), selectedRect=selectedWrap.getBoundingClientRect();
    const sx=selectedRect.left+selectedMeta.left+selectedMeta.plotW/2,sy=selectedRect.top+selectedMeta.top+selectedMeta.plotH/2;
    selectedWrap.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:sx,clientY:sy}));
    window.dispatchEvent(new MouseEvent('mousemove',{clientX:sx,clientY:sy+10}));window.dispatchEvent(new MouseEvent('mouseup'));
    check('selected channel drag uses manual range and preserves other channel',equal(chart.drawMeta.yRange.min,100*10/selectedMeta.plotH) && chart.bindingViewY['parsed.second'].baseMin===-100 && chart.bindingViewY['parsed.second'].offset===0);
    const payload=buildDeviceConfigPayload(), snapshot=JSON.stringify(snapshotChartConfig(chart));
    check('device JSON validates manual range and zoom state',!!validateDeviceConfig(payload));
    await openDeviceConfigText(JSON.stringify(payload));await paint();await wait(80);
    check('JSON open restores display settings exactly',JSON.stringify(snapshotChartConfig(state.charts[0]))===snapshot);
    check('JSON does not persist runtime time anchor or auto-connect',!JSON.stringify(payload).includes('viewTimeAnchor') && !state.serial.connected && state.serial.requireManualConnect);
    state.charts.forEach(c=>c.open=false);state.theme='dark';applyTheme();renderCharts(true);await paint();refs.chartList.scrollIntoView();
    const result=parent.document.createElement('pre');result.id='waveform-view-result';result.hidden=true;result.textContent=JSON.stringify({status:'passed',checks});parent.document.body.appendChild(result);
  } catch(error) {
    const result=parent.document.createElement('pre');result.id='waveform-view-result';result.textContent=JSON.stringify({status:'failed',error:String(error),stack:error.stack,checks});parent.document.body.appendChild(result);
  }
});
