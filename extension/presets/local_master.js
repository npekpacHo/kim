(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "local_master",
    title: "Локальная мастер-клавиша",
    icon: "🔘",
    order: 11,
    tags: ["спальня", "свет", "длинтельное нажатие"],
    description: "Создаёт локальную мастер-клавишу для комнаты или зоны. Длительное нажатие на выбранную кнопку выключает один или несколько указанных выходов.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, parseRanges, checkOverwrite, makeHexMask, API, CFG, bindNamePreview } = ctx;
      const l = ctx.log;

      const inDi  = mkInp("", "2", {"--kcs-inp-max":"50px"});
      const inDos = mkInpSm("", "например 1-16 или 1 3 5 7 9", {"--kcs-inp-max":"240px"});
      const inId  = mkInp("1", {"--kcs-inp-max":"80px"});
      inId.style.backgroundColor = "#fff3cd";

      // Suggest next free ID (best-effort)
      if(ctx.findNextFreeId){
        ctx.findNextFreeId(60).then(v=>{
          if(v && !isNaN(parseInt(v,10))) inId.value = String(v);
        }).catch(()=>{});
      }

      const run = async () => {
        const di = parseInt(inDi.value, 10);
        const dos = parseRanges(inDos.value);
        const id = parseInt(inId.value, 10);

        if(!id || !di || !dos.length) return alert("Заполни кнопку, выходы и ID правила.");

        if(!(await checkOverwrite(id))) return;

        l(`>>> Создание Локального Мастера. DI ${di} -> OFF DO ${dos.join(",")}`);
        const res = await API.save({
          id,
          name: `Master_DI${di}`,
          enable: 1,
          relation: 0,
          scenario_mode: 0,
          if_items: [{ type: 1, index: di-1, triggle: 2 }], // 2 = long press
          then_items: [{ type: 9, off: makeHexMask(dos), on: CFG.Z32, toggle: CFG.Z32 }]
        });

        if(res && res.ok) {
          l(`OK: правило записано (ID ${id})`);
          alert("Готово! Правило создано.");
        } else {
          l(`ERR: не удалось записать правило (ID ${id})`);
        }
      };

      const card = el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Локальная мастер-клавиша"),
        el("div",{style:"margin-bottom:10px;color:#666;font-size:11px"},
          "Этот пресет создаёт одно правило. Долгое нажатие на выбранную кнопку выключает указанные выходы. " +
          "Подходит для спальни, комнаты или отдельной зоны, где нужно одной кнопкой погасить свет."
        ),
        el("div",{class:"kcs_row", style:"align-items:flex-start"},
          el("div",{style:"flex:1;min-width:180px"}, el("label",{style:"margin-right:10px"},"Кнопка для выключения (DI): "), inDi),
          el("div",{style:"flex:2;min-width:240px"}, el("label",{style:"margin-right:10px"},"Какие выходы выключать (DO): "), inDos)
        ),
        el("div",{class:"kcs_help", style:"margin-top:8px"},
          "Можно указать один выход, диапазон 1-16, список через пробел 1 3 5 7 9 или через запятую."
        ),
        el("div",{style:"margin-top:10px;padding-top:10px;border-top:1px solid #eee"},
          el("label",{style:"margin-right:10px"},"ID создаваемого правила: "), inId,
          el("button",{class:"kcs_btn primary", style:"margin-left:10px", onclick:run},"Создать мастер-клавишу")
        )
      );

      bindNamePreview(inDi, "di");
      bindNamePreview(inDos, "do");
      return card;
    }
  });
})();
