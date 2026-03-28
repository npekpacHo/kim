(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "global_master",
    title: "Глобальная мастер-клавиша",
    icon: "🧠",
    order: 10,
    tags: ["централизованное управление", "мастер-кнопка", "вежливый свет", "статус", "таймер"],
    description: "Создаёт сценарий общего выключения одной кнопкой. Долгое нажатие выключает почти всё, оставляет нужные исключения и запускает вежливый свет на заданное время.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, field, parseRanges, checkOverwrite, makeHexMask, makeAllOffMaskExcept, API, CFG, sleep, bindNamePreview } = ctx;
      const l = (typeof ctx.log === "function") ? ctx.log : (()=>{});

      const inMasterDi  = mkInp("1",  {"--kcs-inp-max":"60px"});
      const inPoliteDo  = mkInp("1",  {"--kcs-inp-max":"60px"});
      const inPoliteSec = mkInp("30", {"--kcs-inp-max":"80px"});
      const inStatusDo  = mkInp("32", {"--kcs-inp-max":"60px"});
      const inExcDi     = mkInpSm("39, 40", "например 39, 40", {"--kcs-inp-max":"220px"});
      const inExcDo     = mkInpSm("", "например 2, 5, 9", {"--kcs-inp-max":"220px"});
      const inStartId   = mkInp("51", {"--kcs-inp-max":"80px"});
      inStartId.style.backgroundColor = "#fff3cd";

      const uniqSorted = (arr) => Array.from(new Set((arr || []).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v)))).sort((a,b)=>a-b);
      const inRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
      const badVals = (arr, min, max) => arr.filter(v => !inRange(v, min, max));

      const run = async () => {
        const mDi = parseInt(inMasterDi.value, 10);
        const pDo = parseInt(inPoliteDo.value, 10);
        const pSec = parseInt(inPoliteSec.value, 10);
        const sDo = parseInt(inStatusDo.value, 10);
        const startId = parseInt(inStartId.value, 10);

        const excDi = uniqSorted(parseRanges(inExcDi.value));
        const excDo = uniqSorted(parseRanges(inExcDo.value));

        if(!inRange(mDi, 1, CFG.diMax)) return alert(`Мастер-кнопка должна быть в диапазоне DI 1..${CFG.diMax}.`);
        if(!inRange(pDo, 1, CFG.doMax)) return alert(`Выход вежливого света должен быть в диапазоне DO 1..${CFG.doMax}.`);
        if(!inRange(sDo, 1, CFG.doMax)) return alert(`Статусный выход должен быть в диапазоне DO 1..${CFG.doMax}.`);
        if(!Number.isFinite(pSec) || pSec < 1) return alert("Таймер вежливого света должен быть числом не меньше 1 секунды.");
        if(!Number.isFinite(startId) || startId < 1) return alert("Стартовый ID должен быть положительным числом.");

        const badDi = badVals(excDi, 1, CFG.diMax);
        if(badDi.length) return alert(`В исключениях DI есть значения вне диапазона 1..${CFG.diMax}: ${badDi.join(", ")}`);

        const badDo = badVals(excDo, 1, CFG.doMax);
        if(badDo.length) return alert(`В исключениях DO есть значения вне диапазона 1..${CFG.doMax}: ${badDo.join(", ")}`);

        if(pDo === sDo) return alert("Выход вежливого света и статусный выход должны быть разными.");

        const doKeepOn = uniqSorted([...excDo, sDo, pDo]);
        const maskAllOff = makeAllOffMaskExcept(doKeepOn);
        const maskStatus = makeHexMask([sDo]);
        const maskPolite = makeHexMask([pDo]);

        const wakeDis = [];
        for(let i = 1; i <= CFG.diMax; i++) {
          if(i !== mDi && !excDi.includes(i)) wakeDis.push(i);
        }

        const chunkSize = 8;
        const wakeRuleCount = Math.ceil(wakeDis.length / chunkSize);
        const totalRules = 1 + wakeRuleCount + 1;
        const allIds = Array.from({ length: totalRules }, (_, i) => startId + i);

        for (const id of allIds) {
          const ok = await checkOverwrite(id);
          if (!ok) {
            l("Отмена пользователем.");
            return;
          }
        }

        l(">>> Генерация глобальной мастер-клавиши...");
        l(`Будет создано правил: ${totalRules}. ID: ${allIds[0]}-${allIds[allIds.length - 1]}`);

        // 1) Master rule: long press -> OFF all except keep list, and turn ON status DO
        const resMaster = await API.save({
          id: startId,
          name: `Master_DI${mDi}`,
          enable: 1,
          relation: 0,
          scenario_mode: 0,
          if_items: [{ type: 1, index: mDi - 1, triggle: 2 }],
          then_items: [
            { type: 9, off: maskAllOff, on: CFG.Z32, toggle: CFG.Z32 },
            { type: 9, on: maskStatus, off: CFG.Z32, toggle: CFG.Z32 }
          ]
        });
        if(!resMaster || !resMaster.ok) {
          l(`ERR: не удалось записать мастер-правило (ID ${startId})`);
          return alert(`Не удалось записать правило ID ${startId}.`);
        }
        l(`[ID ${startId}] Долгое нажатие DI${mDi}: общий OFF + статус ON`);
        await sleep(200);

        // 2) Wake-up rules: any short press on allowed DI -> turn OFF status DO
        let currentId = startId + 1;
        for (let i = 0; i < wakeDis.length; i += chunkSize) {
          const chunk = wakeDis.slice(i, i + chunkSize);
          const resWake = await API.save({
            id: currentId,
            name: `WakeUp_G${Math.floor(i / chunkSize) + 1}`,
            enable: 1,
            relation: 0,
            scenario_mode: 0,
            if_items: chunk.map(di => ({ type: 1, index: di - 1, triggle: 0 })),
            then_items: [{ type: 9, off: maskStatus, on: CFG.Z32, toggle: CFG.Z32 }]
          });
          if(!resWake || !resWake.ok) {
            l(`ERR: не удалось записать wake-правило (ID ${currentId})`);
            return alert(`Не удалось записать правило ID ${currentId}.`);
          }
          l(`[ID ${currentId}] Любая из кнопок DI ${chunk.join(", ")} снимает master-режим`);
          currentId++;
          await sleep(200);
        }

        // 3) Polite light rule: when status DO turns ON -> wait pSec -> turn OFF polite DO
        const resPolite = await API.save({
          id: currentId,
          name: `Polite_OFF`,
          enable: 1,
          relation: 0,
          scenario_mode: 0,
          if_items: [{ type: 16, index: sDo - 1, triggle: 1 }],
          then_items: [
            { type: 11, delay: pSec, value: 0 },
            { type: 9, off: maskPolite, on: CFG.Z32, toggle: CFG.Z32, value: 0 }
          ]
        });
        if(!resPolite || !resPolite.ok) {
          l(`ERR: не удалось записать таймер вежливого света (ID ${currentId})`);
          return alert(`Не удалось записать правило ID ${currentId}.`);
        }

        l(`[ID ${currentId}] Вежливый свет: DO${pDo} выключится через ${pSec} сек.`);
        alert("Готово! Глобальная мастер-клавиша создана.");
      };

      const note = el("div",{class:"kcs_help", style:"margin-bottom:10px"},
        "Этот пресет создаёт несколько связанных правил.\n" +
        "1. Долгое нажатие на мастер-кнопку выключает почти все выходы, кроме исключений, и включает статусный флаг master-режима.\n" +
        "2. Вежливый свет остаётся включённым и через заданное время выключается сам.\n" +
        "3. Первое короткое нажатие на любую обычную кнопку снимает master-режим.\n\n" +
        "Исключения DI нужны для кнопок, которые не должны снимать master-режим. Исключения DO нужны для нагрузок, которые нельзя выключать общей командой."
      );

      const card = el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Глобальная мастер-клавиша"),
        note,
        el("div",{class:"kcs_form"},
          field("Кнопка общего выключения (DI)", inMasterDi, "Долгое нажатие на эту кнопку запускает общий master-сценарий.", "sm"),
          field("Вежливый свет после master (DO)", inPoliteDo, "Этот свет не выключается сразу. Он погаснет сам через заданное время.", "sm"),
          field("Через сколько выключить вежливый свет (сек)", inPoliteSec, "Таймер для вежливого света после общего выключения.", "sm"),
          field("Статус master-режима (DO)", inStatusDo, "Служебный выход-флаг. Он показывает, что master-режим сейчас активен.", "sm"),
          field("Не использовать для снятия master (DI, необязательно)", inExcDi, "Эти кнопки не будут отключать master-режим своим коротким нажатием.", "sm"),
          field("Не выключать общей командой (DO, необязательно)", inExcDo, "Эти выходы останутся включёнными после общего выключения.", "sm"),
          field("Первый ID для группы правил", inStartId, "Пресет создаёт сразу несколько правил подряд, начиная с этого ID.", "sm")
        ),
        el("div",{class:"kcs_actions"},
          el("button",{class:"kcs_btn danger", onclick:run},"Создать глобальный master")
        )
      );

      bindNamePreview(inMasterDi, "di");
      bindNamePreview(inPoliteDo, "do");
      bindNamePreview(inStatusDo, "do");
      bindNamePreview(inExcDi, "di");
      bindNamePreview(inExcDo, "do");

      return card;
    }
  });
})();
