requestAnimationFrame(async()=>{
  const checks=[];
  const check=(name,condition)=>{if(!condition)throw new Error(name);checks.push(name);};
  const originalSerial=Object.getOwnPropertyDescriptor(navigator,'serial');
  let enumerations=0,requests=0,opens=0;
  const mockPort={open:async()=>{opens++;throw new Error('controlled test open failure');}};
  Object.defineProperty(navigator,'serial',{configurable:true,value:{getPorts:async()=>{enumerations++;return[mockPort];},requestPort:async()=>{requests++;return mockPort;},addEventListener:()=>{}}});
  try {
    closeVersionModal();
    check('initial page is disconnected with reconnect off',!state.serial.connected && state.serial.requireManualConnect && !state.settings.autoReconnect && !refs.autoReconnect.checked);
    await tryInitialSerialConnectPrompt();
    check('authorized port is not enumerated or opened at startup',enumerations===0 && opens===0 && requests===0);
    const saved=buildLocalPrefsSnapshot();saved.manualConnectRequired=false;saved.settings.autoReconnect=true;saved.settings.baudRate='9600';saved.deviceName='保留原配置';
    for(const legacy of [false,true]){
      const prefs=JSON.parse(JSON.stringify(saved));if(legacy)delete prefs.manualConnectRequired;
      localStorage.setItem(LOCAL_PREFS_KEY,JSON.stringify(prefs));initializeDefaults();
      await tryInitialSerialConnectPrompt();
      check(`${legacy?'legacy':'saved'} connected preference cannot auto-connect`,state.serial.requireManualConnect && !state.serial.connected && !state.settings.autoReconnect && !refs.autoReconnect.checked && opens===0 && enumerations===0);
      check(`${legacy?'legacy':'saved'} unrelated settings remain restored`,state.settings.baudRate==='9600' && state.deviceName==='保留原配置');
    }
    refs.autoReconnect.checked=true;refs.autoReconnect.dispatchEvent(new Event('change',{bubbles:true}));
    check('user can enable reconnect for current session',state.settings.autoReconnect && refs.autoReconnect.checked);
    await tryInitialSerialConnectPrompt();
    check('enabling reconnect still waits for explicit first connection',state.serial.requireManualConnect && opens===0 && enumerations===0 && !shouldScheduleReconnect());
    persistLocalPrefsNow();initializeDefaults();
    check('reload initialization resets persisted reconnect to off',!state.settings.autoReconnect && !refs.autoReconnect.checked && state.serial.requireManualConnect);
    const supported=state.serial.supported;state.serial.supported=true;
    await connectSerial('manual');state.serial.supported=supported;
    check('explicit manual connection still invokes chooser and port open',requests===1 && opens===1 && !state.serial.connected);
    check('reset defaults also has auto reconnect off',buildDefaultUserConfigSnapshot().settings.autoReconnect===false);
    const result=parent.document.createElement('pre');result.id='startup-connection-result';result.hidden=true;result.textContent=JSON.stringify({status:'passed',checks});parent.document.body.appendChild(result);
  }catch(error){const result=parent.document.createElement('pre');result.id='startup-connection-result';result.textContent=JSON.stringify({status:'failed',error:String(error),stack:error.stack,checks});parent.document.body.appendChild(result);}
  finally{if(originalSerial)Object.defineProperty(navigator,'serial',originalSerial);else delete navigator.serial;}
});
