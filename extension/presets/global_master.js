(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "global_master",
    title: "Глобальная мастер-клавиша",
    icon: "🧠",
    order: 10,
    tags: ["централизованное управление", "группа правил", "свет", "статус", "таймер"],
    description: "Создаёт группу правил для общего выключения нагрузок одной кнопкой и автоматического таймера вежливого света.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, field, parseRanges, checkOverwrite, makeHexMask, makeAllOffMaskExcept, API, CFG, sleep, bindNamePreview } = ctx;
      const l = ctx.log;

      const inMasterDi  = mkInp("1",  {"--kcs-inp-max":"60px"});
      const inPoliteDo  = mkInp("1",  {"--kcs-inp-max":"60px"});
      const inPoliteSec = mkInp("30", {"--kcs-inp-max":"60px"});
      const inStatusDo  = mkInp("32", {"--kcs-inp-max":"60px"});
      const inExcDi     = mkInpSm("39, 40", "", {"--kcs-inp-max":"220px"});
      const inExcDo     = mkInpSm("", "", {"--kcs-inp-max":"220px"});
      const inStartId   = mkInp("51", {"--kcs-inp-max":"80px"});
      inStartId.style.backgroundColor = "#fff3cd";

      const run = async () => {
        const mDi = parseInt(inMasterDi.value, 10);
        const pDo = parseInt(inPoliteDo.value, 10);
        const pSec = parseInt(inPoliteSec.value, 10);
        const sDo = parseInt(inStatusDo.value, 10);
        const startId = parseInt(inStartId.value, 10);

        if(!mDi || !pDo || !sDo || !startId || !pSec) return alert("Заполните поля.");

        const excDi = parseRanges(inExcDi.value);
        const excDo = parseRanges(inExcDo.value);

        const doKeepOn = [...excDo, sDo, pDo];
        const maskAllOff   = makeAllOffMaskExcept(doKeepOn);
        const maskStatusOn = makeHexMask([sDo]);
        const maskStatusOff= makeHexMask([sDo]);
        const maskPoliteOff= makeHexMask([pDo]);

        if(!(await checkOverwrite(startId))) return;

        l(">>> Генерация Глобального Мастера...");

        // 1) Master: long press -> OFF all except keep list, and turn ON status DO
        await API.save({
          id: startId,
          name: `Master_DI${mDi}`,
          enable: 1,
          relation: 0,
          scenario_mode: 0,
          if_items: [{ type: 1, index: mDi-1, triggle: 2 }],
          then_items: [
            { type: 9, off: maskAllOff, on: CFG.Z32, toggle: CFG.Z32 },
            { type: 9, on:  maskStatusOn, off: CFG.Z32, toggle: CFG.Z32 }
          ]
        });
        l(`[ID ${startId}] Мастер-кнопка записана.`);
        await sleep(200);

        // 2) WakeUp rules: any DI (except master & excluded) -> turn OFF status DO
        const wakeDis = [];
        for(let i=1; i<=CFG.diMax; i++) if(i !== mDi && !excDi.includes(i)) wakeDis.push(i);

        const chunkSize = 8;
        let currentId = startId + 1;

        for (let i = 0; i < wakeDis.length; i += chunkSize) {
          const chunk = wakeDis.slice(i, i + chunkSize);
          await API.save({
            id: currentId,
            name: `WakeUp_G${Math.floor(i/chunkSize)+1}`,
            enable: 1,
            relation: 0,
            scenario_mode: 0,
            if_items: chunk.map(di => ({ type: 1, index: di-1, triggle: 0 })), // short press
            then_items: [{ type: 9, off: maskStatusOff, on: CFG.Z32, toggle: CFG.Z32 }]
          });
          l(`[ID ${currentId}] WakeUp: DI ${chunk.join(",")} -> статус OFF`);
          currentId++;
          await sleep(200);
        }

        // 3) Polite light: when status DO is ON -> wait pSec -> turn OFF polite DO
        await API.save({
          id: currentId,
          name: `Polite_OFF`,
          enable: 1,
          relation: 0,
          scenario_mode: 0,
          if_items: [{ type: 16, index: sDo-1, triggle: 1 }], // output ON
          then_items: [{ type: 11, delay: pSec }, { type: 9, off: maskPoliteOff, on: CFG.Z32, toggle: CFG.Z32 }]
        });

        l(`[ID ${currentId}] Вежливый свет (таймер ${pSec} сек).`);
        alert("Готово!");
      };

      const card = el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Глобальная мастер-клавиша"),
        el("div",{style:"margin-bottom:10px;color:#666;font-size:11px"},
          "Создаёт группу правил для централизованного управления. Долгое нажатие на мастер DI выключает все DO, " +
          "кроме исключений, и включает статусный DO. Пока статусный DO включён, срабатывает таймер и выключает вежливый DO. " +
          "Короткое нажатие на любой другой DI (кроме исключений) выключает статусный DO."
        ),
        el("div",{class:"kcs_form"},
          field("Мастер DI", inMasterDi, "", "sm"),
          field("Вежливый DO", inPoliteDo, "", "sm"),
          field("Таймер, сек", inPoliteSec, "", "sm"),
          field("Статус DO", inStatusDo, "", "sm"),
          field("Исключить DI", inExcDi, "", "sm"),
          field("Исключить DO", inExcDo, "", "sm"),
          field("Старт с ID", inStartId, "", "sm")
        ),
        el("div",{class:"kcs_actions"},
          el("button",{class:"kcs_btn danger", onclick:run},"Создать группу правил")
        )
      );

      bindNamePreview(inMasterDi, "di");
      bindNamePreview(inPoliteDo, "do");
      bindNamePreview(inStatusDo, "do");
      bindNamePreview(inExcDo, "do");

      return card;
    }
  });
})();