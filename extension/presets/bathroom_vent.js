(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "bathroom_vent",
    title: "Проветривание санузла",
    icon: "🌬️",
    order: 12,
    tags: ["санузел", "вытяжка", "свет", "таймер"],
    description: "Создаёт управление светом и вытяжкой в санузле. Свет и вытяжку можно включать вручную отдельными кнопками, а вытяжка дополнительно может запускаться сама через некоторое время после включения света.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, field, API, CFG, makeHexMask, checkOverwrite, bindNamePreview, shortName } = ctx;
      const log = (typeof ctx.log === "function") ? ctx.log : (()=>{});

      // Свет
      const inDiLight = mkInp("1", "kcs_inp", "", {"--kcs-inp-max":"60px"});
      const inDoLight = mkInp("1", "kcs_inp", "", {"--kcs-inp-max":"60px"});

      // Вытяжка
      const inDiFan   = mkInp("2", "kcs_inp", "", {"--kcs-inp-max":"60px"});
      const inDoFan   = mkInp("2", "kcs_inp", "", {"--kcs-inp-max":"60px"});

      // Тайминги (сек)
      const inDelaySec = mkInpSm("60", "", {"--kcs-inp-max":"120px"});
      const inRunSec   = mkInpSm("180", "", {"--kcs-inp-max":"120px"});

      // Опциональный DO-флаг "разрешить" (можно выключать ночью)
      const inEnableDo = mkInpSm("", "например 32", {"--kcs-inp-max":"120px"});
      inEnableDo.style.backgroundColor = "#f1f8ff";

      // ID авто-правила (рекомендация: 70)
      const inAutoId = mkInpSm("70", "", {"--kcs-inp-max":"90px"});
      inAutoId.style.backgroundColor = "#fff3cd";

      const run = async () => {
        const diL = parseInt(inDiLight.value, 10);
        const doL = parseInt(inDoLight.value, 10);
        const diF = parseInt(inDiFan.value, 10);
        const doF = parseInt(inDoFan.value, 10);

        const delaySec = parseInt(inDelaySec.value, 10);
        const runSec   = parseInt(inRunSec.value, 10);

        const enableDo = parseInt((inEnableDo.value||"").trim(), 10);
        const autoId   = parseInt(inAutoId.value, 10);

        if(!diL || !doL || !diF || !doF) { alert("Заполни DI/DO для света и вытяжки."); return; }
        if(!Number.isFinite(delaySec) || delaySec < 0) { alert("Задержка должна быть числом (сек), минимум 0."); return; }
        if(!Number.isFinite(runSec) || runSec < 1) { alert("Время работы должно быть числом (сек), минимум 1."); return; }
        if(!autoId || autoId < 3) { alert("ID авто должен быть числом (рекомендуется 70)."); return; }

        const idLight = autoId - 2;
        const idFan   = autoId - 1;
        const ids = [idLight, idFan, autoId];

        for(const id of ids){
          const ok = await checkOverwrite(id);
          if(!ok) { log("Отмена пользователем."); return; }
        }

        const maskLight = makeHexMask([doL]);
        const maskFan   = makeHexMask([doF]);

        // 1) Кнопка света: DI -> TOGGLE DO света
        await API.save({
          id: idLight,
          name: shortName(`WC_Light_DI${diL}`),
          enable: 1, relation: 0, scenario_mode: 0,
          if_items: [{ type: 1, index: diL-1, triggle: 0 }],
          then_items: [{ type: 9, toggle: maskLight, on: CFG.Z32, off: CFG.Z32 }]
        });
        log(`[ID ${idLight}] Свет: DI${diL} -> TOG DO${doL}`);

        // 2) Кнопка вытяжки: DI -> TOGGLE DO вытяжки
        await API.save({
          id: idFan,
          name: shortName(`WC_Fan_DI${diF}`),
          enable: 1, relation: 0, scenario_mode: 0,
          if_items: [{ type: 1, index: diF-1, triggle: 0 }],
          then_items: [{ type: 9, toggle: maskFan, on: CFG.Z32, off: CFG.Z32 }]
        });
        log(`[ID ${idFan}] Вытяжка вручную: DI${diF} -> TOG DO${doF}`);

        // 3) Авто-вытяжка:
        // IF DO света ON (и, опционально, DO-флаг ON) THEN:
        // delay -> fan ON -> delay(run) -> fan OFF
        const ifItems = [{ type: 16, index: doL-1, triggle: 1 }];
        let relation = 0;
        if(Number.isFinite(enableDo) && enableDo > 0){
          ifItems.push({ type: 16, index: enableDo-1, triggle: 1 });
          relation = 1; // AND
        }

        await API.save({
          id: autoId,
          name: shortName("WC_AutoVent"),
          enable: 1, relation, scenario_mode: 0,
          if_items: ifItems,
          then_items: [
            { type: 11, delay: delaySec, value: 0 },
            { type: 9,  on: maskFan, off: CFG.Z32, toggle: CFG.Z32, value: 0 },
            { type: 11, delay: runSec, value: 0 },
            { type: 9,  on: CFG.Z32, off: maskFan, toggle: CFG.Z32, value: 0 }
          ]
        });

        const extra = (relation === 1) ? ` (и DO${enableDo} ON)` : "";
        log(`[ID ${autoId}] Авто: DO${doL} ON -> +${delaySec}s вент ON на ${runSec}s -> OFF${extra}`);

        alert("Готово! Правила созданы.");
      };

      const note = el("div",{class:"kcs_help", style:"margin-bottom:10px;white-space:pre-line"},
        "Пресет создаст 3 правила.\n"
        + "1. Кнопка света включает и выключает свет.\n"
        + "2. Кнопка вытяжки включает и выключает вытяжку вручную.\n"
        + "3. После включения света вытяжка может включиться автоматически: сначала ждём заданное время, потом включаем её на нужный срок и выключаем.\n\n"
        + "Если указать DO-флаг «разрешить», авто-вытяжка будет работать только когда этот выход включён."
      );

      const card = el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Проветривание санузла"),
        note,

        el("div",{class:"kcs_row", style:"align-items:flex-start"},
          el("div",{style:"flex:1;min-width:240px"},
            el("div",{style:"font-weight:600;margin-bottom:6px"},"Кнопка света и реле света"),
            el("label",{style:"margin-right:10px"},"DI: "), inDiLight,
            el("label",{style:"margin:0 10px 0 14px"},"DO: "), inDoLight
          ),
          el("div",{style:"flex:1;min-width:240px"},
            el("div",{style:"font-weight:600;margin-bottom:6px"},"Кнопка вытяжки и реле вытяжки"),
            el("label",{style:"margin-right:10px"},"DI: "), inDiFan,
            el("label",{style:"margin:0 10px 0 14px"},"DO: "), inDoFan
          )
        ),

        el("div",{class:"kcs_form"},
          field("Через сколько включить вытяжку (сек)", inDelaySec, "Сколько ждать после включения света, прежде чем запустить вытяжку автоматически.", "sm"),
          field("Сколько держать вытяжку включённой (сек)", inRunSec, "Время работы вытяжки в авто-режиме.", "sm"),
          field("DO-флаг «разрешить авто» (необязательно)", inEnableDo, "Если указать этот выход, авто-вытяжка будет работать только когда он включён. Удобно для ночного отключения.", "sm"),
          field("ID основного авто-правила", inAutoId, "Будут созданы три подряд идущих правила: свет, ручная вытяжка и авто-вытяжка. Рекомендуется 70.", "sm")
        ),

        el("div",{style:"margin-top:10px;padding-top:10px;border-top:1px solid #eee"},
          el("button",{class:"kcs_btn primary", onclick:run},"Создать управление санузлом"),
          el("span",{style:"margin-left:10px;color:#777;font-size:12px"},
            "Будут созданы три правила подряд: свет, ручная вытяжка и авто-вытяжка."
          )
        )
      );

      bindNamePreview(inDiLight, "di");
      bindNamePreview(inDoLight, "do");
      bindNamePreview(inDiFan, "di");
      bindNamePreview(inDoFan, "do");
      bindNamePreview(inEnableDo, "do");

      return card;
    }
  });
})();