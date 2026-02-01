(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "local_master",
    title: "Локальная мастер-клавиша",
    icon: "🔘",
    order: 11,
    tags: ["спальня", "свет", "длинтельное нажатие"],
    description: "Создаёт одно правило: длительное нажатие на выбранный вход выключает выбранный выход или группу выходов. Подобных правил может быть несколько.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, parseRanges, checkOverwrite, makeHexMask, API, CFG, bindNamePreview } = ctx;
      const l = ctx.log;

      const inDi  = mkInp("", "2", {"--kcs-inp-max":"50px"});
      const inDos = mkInpSm("", "5, 6, 7", {"--kcs-inp-max":"240px"});
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

        if(!id || !di || !dos.length) return alert("Заполните поля!");

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
          alert("Готово!");
        } else {
          l(`ERR: не удалось записать правило (ID ${id})`);
        }
      };

      const card = el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Локальная мастер-клавиша"),
        el("div",{style:"margin-bottom:10px;color:#666;font-size:11px"},
          "Создаёт одно правило: длительное нажатие на DI выключает выбранную группу DO."
        ),
        el("div",{class:"kcs_row", style:"align-items:flex-start"},
          el("div",{style:"flex:1;min-width:180px"}, el("label",{style:"margin-right:10px"},"Кнопка (DI): "), inDi),
          el("div",{style:"flex:2;min-width:240px"}, el("label",{style:"margin-right:10px"},"Группы (DO): "), inDos)
        ),
        el("div",{style:"margin-top:10px;padding-top:10px;border-top:1px solid #eee"},
          el("label",{style:"margin-right:10px"},"ID правила: "), inId,
          el("button",{class:"kcs_btn primary", style:"margin-left:10px", onclick:run},"Создать")
        )
      );

      bindNamePreview(inDi, "di");
      bindNamePreview(inDos, "do");
      return card;
    }
  });
})();