requestAnimationFrame(async () => {
  const checks=[];
  const check=(name,condition)=>{if(!condition) throw new Error(name);checks.push(name);};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const refresh=async()=>{scheduleRefresh();await paint();await wait(40);};
  // Object key order is not part of JSON configuration semantics; array order is.
  const sortKeys=value=>Array.isArray(value)?value.map(sortKeys):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortKeys(value[key])])):value;
  const canonical=payload=>JSON.stringify(sortKeys({...payload.config,savedAt:0}));
  const card=command=>refs.commandEditorList.querySelector(`[data-command-id="${command.id}"]`);
  try {
    closeVersionModal();state.layoutExpanded=true;state.parserMode='binary';state.deviceName='指令与状态联调';state.ui.componentColumns=3;
    state.settings.baudRate='9600';state.settings.autoReconnect=true;state.settings.txChecksum=normalizeProtocolChecksum();
    state.parser.binarySchema=[{kind:'header',value:'A5'},{kind:'gap',value:'',length:3},{kind:'data',name:'status',dataType:'uint16le'},
      {kind:'checksum',name:'check',checksum:{enabled:true,algorithm:'sum8',start:0,length:6,byteOrder:'le'}},{kind:'footer',value:'5A'}].map(normalizeBinarySchemaRowFromConfig);
    state.parser.binaryFields=[{id:uid('schema'),name:'wordBE',offset:4,dataType:'uint16',byteOrder:'be'},{id:uid('schema'),name:'flag',offset:3,dataType:'bit0',byteOrder:'le'}];
    const command={...createCommand(),name:'读取状态',template:'01 03 00 00 00 0A 00 00',checksum:{enabled:true,algorithm:'crc16-modbus',start:0,length:6,offset:6,byteOrder:'be'},
      parameters:[{id:uid('schema'),name:'数量',offset:5,dataType:'uint8',byteOrder:'le',defaultValue:'10',min:'1',max:'125',options:''}]};
    const curve=createChart('time');curve.bindings=['parsed.status','parsed.wordBE'];curve.alignScale=false;curve.yAxisBindingKey='parsed.wordBE';
    Object.assign(curve,{viewMode:'manual',viewBaseXMin:-2000,viewBaseXMax:0,viewBaseYMin:0,viewBaseYMax:20000,viewZoomX:2,viewOffsetX:-0.25,viewFollowLatestX:false,
      bindingViewY:{'parsed.status':{baseMin:0,baseMax:10000,zoom:2,offset:0.1},'parsed.wordBE':{baseMin:-100,baseMax:20000,zoom:3,offset:0.2}}});
    const numeric=createChart('numeric');numeric.bindings=['parsed.status','parsed.wordBE','parsed.flag'];numeric.name='设备状态';
    const buttons=createChart('command');buttons.commands=[command,{...createCommand(),name:'固定指令',template:'AA 55'}];buttons.name='设备控制';
    const fft=createChart('fft');fft.bindings=['parsed.status'];fft.fftWindow=32;fft.fftFrameIntervalMs='20';
    const bar=createChart('bar');bar.bindings=['parsed.status'];state.charts=[numeric,buttons,curve,fft,bar];
    state.autoSend.queue=[{id:'poll',enabled:true,payload:'POLL',payloadRawHex:'504F4C4C'}];
    state.conditionSend.rules=[{id:'reply',enabled:true,pattern:'HELLO',patternRawHex:'48454C4C4F',response:'ACK',responseRawHex:'41434B'}];
    clearRealtimeHistoryData();invalidateDerivedCaches();deriveData();syncUserConfigControls();renderCharts(true);await refresh();
    check('five component types use selected three columns',state.charts.map(c=>c.type).join(',')==='numeric,command,time,fft,bar' && getComputedStyle(refs.chartList).gridTemplateColumns.split(' ').length===3);
    const frame=Uint8Array.of(0xA5,0x0D,0x0A,0x55,0x34,0x12,0x57,0x5A);
    const t=nowPreciseMs();for(let i=0;i<40;i++)queueRxBytes(frame,t+i*20);await wait(140);await refresh();
    check('shared RX fields update numeric and waveform components',state.derived.numericSeries['parsed.status'].at(-1).v===4660 && state.derived.numericSeries['parsed.wordBE'].at(-1).v===13330 && state.derived.numericSeries['parsed.flag'].at(-1).v===1);
    check('numeric panel shows shared bit and word values',refs.chartList.querySelector('[data-numeric-value="parsed.flag"] strong').textContent==='1' && refs.chartList.querySelector('[data-numeric-value="parsed.status"] strong').textContent==='4660');
    check('independent TX template has known CRC high-byte order',bytesToCompactHex(buildCommandFrame(command).bytes)==='01030000000ACDC5');
    const writes=[];let closes=0;state.serial.connected=true;state.serial.port={close:async()=>{closes++;}};
    state.serial.writer={ready:Promise.resolve(),write:async bytes=>{writes.push(Uint8Array.from(bytes));},releaseLock:()=>{}};await refresh();
    const live=card(command).querySelector('[data-command-value]');live.value='11';live.dispatchEvent(new Event('input',{bubbles:true}));await refresh();
    await sendCommand(buttons,command);await refresh();
    check('live parameter sends via shared writer before save',writes.length===1 && bytesToCompactHex(writes[0])!==bytesToCompactHex(buildCommandFrame(command).bytes));
    const downloadOriginal=downloadFile;let downloaded;downloadFile=(name,blob)=>{downloaded={name,blob};};
    document.getElementById('save-device-config-btn').click();downloadFile=downloadOriginal;
    const text=await downloaded.blob.text(),payload=JSON.parse(text);
    check('one UTF8 JSON file contains entire device workbench',downloaded.name==='指令与状态联调.json' && payload.type==='PortScopeDeviceConfig' && payload.config.charts.length===5 && payload.config.layout.componentColumns===3);
    check('fixed frame offsets and three-byte gap preserved',payload.config.parser.binary.frameLength===8 && payload.config.parser.binary.rows.map(r=>r.offset).join(',')==='0,1,4,6,7' && payload.config.parser.binary.rows[1].length===3);
    check('RX SUM8 and independent TX CRC16 rules preserved',payload.config.parser.binary.rows[3].checksum.algorithm==='sum8' && payload.config.charts[1].commands[0].checksum.byteOrder==='be');
    check('JSON excludes temporary values and send result',!text.includes('commandRuntime') && !text.includes('rawChunks') && !text.includes('latestCards') && !text.includes('viewTimeAnchor') && !text.includes('已发送') && payload.config.charts[1].commands[0].parameters[0].defaultValue==='10');
    const invalid=[
      ['missing numeric field',p=>p.config.charts[0].channels.bindings=['parsed.missing']],
      ['bad command parameter offset',p=>p.config.charts[1].commands[0].parameters[0].offset=100],
      ['overlapping TX checksum',p=>p.config.charts[1].commands[0].checksum.offset=5],
      ['unbound Y channel',p=>p.config.charts[2].channels.selectedYAxisBinding='parsed.flag'],
      ['reversed per-channel range',p=>{p.config.charts[2].view.perChannelY['parsed.status'].baseMin=10001;}],
      ['overflowing X range',p=>{p.config.charts[2].view.baseXMin=-1e308;p.config.charts[2].view.baseXMax=1e308;}],
      ['bad gap length',p=>p.config.parser.binary.rows[1].length=0],
      ['unsupported format',p=>p.version=99]
    ];
    for(const [name,change] of invalid){const bad=clone(payload);change(bad);let rejected=false;try{await openDeviceConfigText(JSON.stringify(bad));}catch{rejected=true;}
      check(`${name}: rejected before changing active workbench`,rejected && closes===0 && state.serial.connected && canonical(buildDeviceConfigPayload())===canonical(payload));}
    startRecording();queueRxBytes(frame,nowPreciseMs());state.autoSend.enabled=true;state.conditionSend.enabled=true;
    state.autoSend.timerId=setInterval(()=>{writes.push('unexpected');},10000);const count=state.timelines.length;
    const transfer=new DataTransfer();transfer.items.add(new File([text],'device.json',{type:'application/json'}));refs.deviceConfigFileInput.files=transfer.files;
    refs.deviceConfigFileInput.dispatchEvent(new Event('change',{bubbles:true}));
    for(let i=0;i<100 && (!state.serial.requireManualConnect || state.ui.deviceConfigImporting);i++)await wait(20);await refresh();
    check('file open closes existing port and stops task timers',closes===1 && !state.serial.connected && !state.autoSend.enabled && !state.conditionSend.enabled && !state.autoSend.timerId);
    check('recording archived with original protocol bytes',state.timelines.length===count+1 && !state.recording.active && state.timelines.at(-1).rawChunks[0].bytes.join(',')===frame.join(','));
    const restoredConfig=buildDeviceConfigPayload();
    if(canonical(restoredConfig)!==canonical(payload)) {
      const differences=[];
      const compare=(a,b,path)=>{if(a && b && typeof a==='object' && typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(key!=='savedAt')compare(a[key],b[key],`${path}.${key}`);}else if(a!==b)differences.push({path,actual:a,expected:b});};
      compare(restoredConfig.config,payload.config,'config');throw new Error('Workbench restore mismatch: '+JSON.stringify(differences));
    }
    check('whole configuration restores without losing component order or views',canonical(restoredConfig)===canonical(payload));
    const restored=state.charts[1].commands[0];
    check('temporary parameter and result do not restore',commandInputValues(restored)[0]==='10' && card(restored).querySelector('[data-command-status]').textContent.includes('未连接') && card(restored).querySelector('[data-command-preview]').textContent.includes('CD C5'));
    check('opening has no side effect writes or automatic reconnect',writes.length===1 && state.serial.requireManualConnect && !shouldScheduleReconnect());
    check('restored local preferences retain manual-connect latch',readLocalPrefs().manualConnectRequired===true);
    const prefs=buildLocalPrefsSnapshot();state.charts=[];applyLocalPrefsSnapshot(prefs);syncUserConfigControls();await refresh();
    check('local preferences restore all five component types and manual view',state.charts.length===5 && JSON.stringify(snapshotChartConfig(state.charts[2]))===JSON.stringify(payload.config.charts[2]) && state.ui.componentColumns===3 && state.serial.requireManualConnect);
    clearRealtimeHistoryData();await refresh();
    check('configuration alone does not contain live measurements',!state.derived.numericSeries['parsed.status'] && refs.chartList.querySelector('[data-numeric-value="parsed.status"] strong').textContent==='等待');
    queueRxBytes(frame.slice(0,3),nowPreciseMs());await refresh();check('restored protocol waits across partial gap',!state.derived.numericSeries['parsed.status']);
    queueRxBytes(frame.slice(3),nowPreciseMs()+20);await wait(140);await refresh();
    check('restored RX rules decode fragmented report correctly',state.derived.numericSeries['parsed.status'].at(-1).v===4660 && state.derived.numericSeries['parsed.flag'].at(-1).v===1);
    const bad=Uint8Array.from(frame);bad[6]^=1;const n=state.derived.numericSeries['parsed.status'].length;queueRxBytes(bad,nowPreciseMs()+40);await wait(140);await refresh();
    check('bad checksum does not overwrite valid state',state.derived.numericSeries['parsed.status'].length===n);
    const ctx=document.createElement('canvas').getContext('2d'),colors=[];
    const fill=ctx.fillText.bind(ctx);ctx.fillText=(...args)=>{colors.push(ctx.fillStyle);fill(...args);};
    const originalMatch=Object.getOwnPropertyDescriptor(browserThemeQuery,'matches');
    for(const dark of [false,true]) {
      Object.defineProperty(browserThemeQuery,'matches',{configurable:true,value:dark});state.theme='system';applyTheme();
      colors.length=0;drawAxes(ctx,300,220,{left:46,right:12,top:8,bottom:36},{min:0,max:1,range:1},{min:0,max:1,range:1},'X','Y',[0,1],[0,1]);
      check(`system ${dark?'dark':'light'} theme uses readable chart label colors`,colors.every(color=>color===(dark?'rgba(220, 235, 242, 0.72)':'rgba(18, 36, 54, 0.66)')));
    }
    if(originalMatch)Object.defineProperty(browserThemeQuery,'matches',originalMatch);else delete browserThemeQuery.matches;
    state.theme='dark';applyTheme();
    state.charts.forEach(c=>c.open=false);renderCharts(true);await paint();refs.chartList.scrollIntoView();
    const result=parent.document.createElement('pre');result.id='device-workbench-result';result.hidden=true;result.textContent=JSON.stringify({status:'passed',checks});parent.document.body.appendChild(result);
  }catch(error){const result=parent.document.createElement('pre');result.id='device-workbench-result';result.textContent=JSON.stringify({status:'failed',error:String(error),stack:error.stack,checks});parent.document.body.appendChild(result);}
});
