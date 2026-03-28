(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  window.__KCS_REGISTER_PRESET__({
    id: "leak_protection",
    title: "Защита от протечек",
    icon: "💧",
    order: 13,
    tags: ["протечки", "краны", "антизакисание", "вода", "сервис"],
    description: "Создаёт правила для закрытия кранов по сигналу протечки и отдельный сервисный прогон кранов от закисания.",
    render: (ctx) => {
      const { el, mkInp, mkInpSm, field, API, CFG, checkOverwrite, makeHexMask, bindNamePreview, shortName } = ctx;
      const log = (typeof ctx.log === "function") ? ctx.log : (()=>{});

      const MAX_VALVES_UI = Math.min(8, Math.max(1, Math.floor((CFG.doMax || 32) / 2)));

      const inValveCount = mkInp("2", "kcs_inp", "", {"--kcs-inp-max":"70px"});
      const inStartId    = mkInp("80", "kcs_inp", "", {"--kcs-inp-max":"90px"});
      inStartId.style.backgroundColor = "#fff3cd";

      const inServiceDi  = mkInpSm("", "например 40", {"--kcs-inp-max":"130px"});
      inServiceDi.style.backgroundColor = "#f1f8ff";

      const inGuardDo    = mkInpSm("", "например 1", {"--kcs-inp-max":"130px"});
      inGuardDo.style.backgroundColor = "#f1f8ff";

      const inGapSec     = mkInpSm("5", "", {"--kcs-inp-max":"100px"});

      const valvesWrap = el("div");
      const valveRows = [];

      const toInt = (v) => {
        const n = parseInt(String(v ?? "").trim(), 10);
        return Number.isFinite(n) ? n : NaN;
      };

      const optInt = (v) => {
        const s = String(v ?? "").trim();
        if(!s) return null;
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? n : NaN;
      };

      const ensureRange = (val, min, max, label) => {
        if(!Number.isFinite(val) || val < min || val > max) {
          throw new Error(`${label}: допустимы значения ${min}..${max}.`);
        }
      };

      const saveRule = async (rule, label) => {
        const res = await API.save(rule);
        if(!res || !res.ok) {
          const err = (res && (res.error || res.msg || res.text)) ? String(res.error || res.msg || res.text) : "неизвестная ошибка";
          throw new Error(`${label}: не удалось записать правило (${err}).`);
        }
        return res;
      };

      const makeValveEditor = (idx) => {
        const inDoClose = mkInpSm(String((idx * 2) - 1), "", {"--kcs-inp-max":"80px"});
        const inDoOpen  = mkInpSm(String(idx * 2), "", {"--kcs-inp-max":"80px"});
        const inCloseSec= mkInpSm("22", "", {"--kcs-inp-max":"90px"});
        const inOpenSec = mkInpSm("22", "", {"--kcs-inp-max":"90px"});
        const inLeakDi  = mkInpSm("", "необязательно", {"--kcs-inp-max":"120px"});
        inLeakDi.style.backgroundColor = "#f1f8ff";

        const box = el("div", {
            class:"kcs_card",
            style:"padding:10px;margin:10px 0;border:1px solid #e7e7e7;background:#fff"
          },
          el("div", {style:"font-weight:600;margin-bottom:8px"}, `Кран ${idx}`),
          el("div", {class:"kcs_form"},
            field("Выход Закрыть (DO)", inDoClose, "Выход, который подаёт питание на закрытие крана.", "sm"),
            field("Выход Открыть (DO)", inDoOpen, "Выход, который подаёт питание на открытие крана.", "sm"),
            field("Сколько держать команду Закрыть (сек)", inCloseSec, "Обычно около 22 секунд. После этого выход будет снят.", "sm"),
            field("Сколько держать команду Открыть (сек)", inOpenSec, "Обычно около 22 секунд. После этого выход будет снят.", "sm"),
            field("Вход протечки для этого крана (DI, необязательно)", inLeakDi, "Если указать, по сработке этого входа кран закроется. Поле можно оставить пустым, если датчик будет обрабатываться через Tuya или другую внешнюю логику.", "sm")
          )
        );

        bindNamePreview(inDoClose, "do");
        bindNamePreview(inDoOpen, "do");
        bindNamePreview(inLeakDi, "di");

        return { box, inDoClose, inDoOpen, inCloseSec, inOpenSec, inLeakDi };
      };

      const rerenderValves = () => {
        const countRaw = toInt(inValveCount.value);
        const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(MAX_VALVES_UI, countRaw)) : 1;
        inValveCount.value = String(count);
        valvesWrap.innerHTML = "";
        valveRows.length = 0;
        for(let i = 1; i <= count; i++) {
          const row = makeValveEditor(i);
          valveRows.push(row);
          valvesWrap.appendChild(row.box);
        }
      };

      inValveCount.addEventListener("change", rerenderValves);
      inValveCount.addEventListener("blur", rerenderValves);
      rerenderValves();


      const run = async () => {
        try {
          const valveCount = Math.max(1, Math.min(MAX_VALVES_UI, toInt(inValveCount.value) || 1));
          const startId = toInt(inStartId.value);
          const serviceDi = optInt(inServiceDi.value);
          const guardDo = optInt(inGuardDo.value);
          const gapSec = toInt(inGapSec.value);

          ensureRange(startId, 1, 9999, "Стартовый ID");
          ensureRange(gapSec, 0, 600, "Пауза между кранами");
          if(serviceDi !== null) ensureRange(serviceDi, 1, CFG.diMax, "Сервисный DI");
          if(guardDo !== null) ensureRange(guardDo, 1, CFG.doMax, "Разрешающий DO");

          const valves = [];
          const usedDo = new Set();
          const leakDiByValve = [];

          for(let i = 0; i < valveCount; i++) {
            const row = valveRows[i];
            const doClose = toInt(row.inDoClose.value);
            const doOpen  = toInt(row.inDoOpen.value);
            const closeSec = toInt(row.inCloseSec.value);
            const openSec  = toInt(row.inOpenSec.value);
            const leakDi   = optInt(row.inLeakDi.value);

            ensureRange(doClose, 1, CFG.doMax, `Кран ${i+1}: DO закрыть`);
            ensureRange(doOpen, 1, CFG.doMax, `Кран ${i+1}: DO открыть`);
            ensureRange(closeSec, 1, 65535, `Кран ${i+1}: время закрытия`);
            ensureRange(openSec, 1, 65535, `Кран ${i+1}: время открытия`);
            if(leakDi !== null) ensureRange(leakDi, 1, CFG.diMax, `Кран ${i+1}: вход протечки`);

            if(doClose === doOpen) {
              throw new Error(`Кран ${i+1}: выходы Открыть и Закрыть не должны совпадать.`);
            }
            if(usedDo.has(doClose) || usedDo.has(doOpen)) {
              throw new Error(`Кран ${i+1}: один из DO уже используется другим краном. Для каждого привода лучше выделить свою пару выходов.`);
            }
            usedDo.add(doClose);
            usedDo.add(doOpen);
            leakDiByValve.push(leakDi);

            valves.push({ idx: i+1, doClose, doOpen, closeSec, openSec, leakDi });
          }

          if(serviceDi !== null && leakDiByValve.some(v => v === serviceDi)) {
            throw new Error("Сервисный DI не должен совпадать с входом протечки. Иначе сервисный прогон начнёт закрывать краны как аварийный сигнал.");
          }

          const rules = [];
          let nextId = startId;

          // Аварийное закрытие по проводным датчикам / входам.
          valves.forEach(v => {
            if(v.leakDi === null) return;
            const maskClose = makeHexMask([v.doClose]);
            rules.push({
              id: nextId++,
              label: `Кран ${v.idx}: аварийное закрытие`,
              rule: {
                id: nextId - 1,
                name: shortName(`Leak_V${v.idx}_DI${v.leakDi}`),
                enable: 1,
                relation: 0,
                scenario_mode: 0,
                if_items: [{ type: 1, index: v.leakDi - 1, triggle: 0 }],
                then_items: [
                  { type: 9, on: maskClose, off: CFG.Z32, toggle: CFG.Z32, value: 0 },
                  { type: 11, delay: v.closeSec, value: 0 },
                  { type: 9, on: CFG.Z32, off: maskClose, toggle: CFG.Z32, value: 0 }
                ]
              }
            });
          });

          // Сервисная разминка от закисания.
          if(serviceDi !== null) {
            let offset = 0;
            valves.forEach(v => {
              const maskClose = makeHexMask([v.doClose]);
              const maskOpen = makeHexMask([v.doOpen]);
              const ifItems = [{ type: 1, index: serviceDi - 1, triggle: 0 }];
              let relation = 0;
              if(guardDo !== null) {
                ifItems.push({ type: 16, index: guardDo - 1, triggle: 0 }); // DO OFF
                relation = 1;
              }

              const thenItems = [];
              if(offset > 0) thenItems.push({ type: 11, delay: offset, value: 0 });
              thenItems.push(
                { type: 9, on: maskClose, off: CFG.Z32, toggle: CFG.Z32, value: 0 },
                { type: 11, delay: v.closeSec, value: 0 },
                { type: 9, on: CFG.Z32, off: maskClose, toggle: CFG.Z32, value: 0 },
                { type: 11, delay: 60, value: 0 },
                { type: 9, on: maskOpen, off: CFG.Z32, toggle: CFG.Z32, value: 0 },
                { type: 11, delay: v.openSec, value: 0 },
                { type: 9, on: CFG.Z32, off: maskOpen, toggle: CFG.Z32, value: 0 }
              );

              rules.push({
                id: nextId++,
                label: `Кран ${v.idx}: сервисная разминка`,
                rule: {
                  id: nextId - 1,
                  name: shortName(`LP_Srv_V${v.idx}`),
                  enable: 1,
                  relation,
                  scenario_mode: 0,
                  if_items: ifItems,
                  then_items: thenItems
                }
              });

              offset += v.closeSec + 60 + v.openSec + gapSec;
            });
          }

          if(!rules.length) {
            throw new Error("Создавать нечего. Укажи хотя бы один вход протечки или сервисный DI для разминки.");
          }

          for(const item of rules) {
            const ok = await checkOverwrite(item.id);
            if(!ok) {
              log("Отмена пользователем.");
              return;
            }
          }

          log(">>> Создание правил защиты от протечек...");
          for(const item of rules) {
            await saveRule(item.rule, item.label);
            log(`[ID ${item.id}] ${item.label}`);
          }

          const parts = [];
          const leakCount = rules.filter(x => /аварийное закрытие/i.test(x.label)).length;
          const serviceCount = rules.filter(x => /сервисная разминка/i.test(x.label)).length;
          if(leakCount) parts.push(`аварийных правил: ${leakCount}`);
          if(serviceCount) parts.push(`сервисных правил: ${serviceCount}`);
          alert(`Готово! Создано ${rules.length} правил (${parts.join(", ")}).`);
        } catch(err) {
          const msg = (err && err.message) ? err.message : String(err);
          log(`ERR: ${msg}`);
          alert(msg);
        }
      };

      const note = el("div", {class:"kcs_help", style:"margin-bottom:10px"},
        "Пресет создаёт два типа правил.\n" +
        "1. Аварийное закрытие: по сигналу протечки подаётся команда на закрытие крана на нужное число секунд, затем питание снимается.\n" +
        "2. Сервисная разминка: по отдельному сервисному входу кран закрывается, через минуту снова открывается. Это удобно для защиты от закисания.\n\n" +
        "Важно: автоматический запуск разминки раз в 4 дня сюда пока не включён. В KCS есть Timer IF, но текущий API пресетов не описывает его JSON достаточно надёжно, чтобы я не подложил тебе мину в рабочий контроллер. Поэтому эта версия делает рабочую защиту и ручной сервисный прогон.\n\n" +
        "Для каждого привода используются два DO: один на Закрыть, второй на Открыть. Лучше заранее включить interlock для этой пары выходов в настройках контроллера, чтобы они никогда не включались одновременно."
      );

      const card = el("div", {class:"kcs_card"},
        el("div", {class:"kcs_card_head"}, "Защита от протечек"),
        note,

        el("div", {class:"kcs_form"},
          field("Сколько кранов с электроприводом", inValveCount, `От 1 до ${MAX_VALVES_UI}. Для каждого будет своя пара DO и свои времена открытия/закрытия.`, "sm"),
          field("Стартовый ID для новых правил", inStartId, "Пресет создаёт несколько правил подряд, начиная с этого номера.", "sm"),
          field("Сервисный вход для разминки кранов (DI, необязательно)", inServiceDi, "Если указать этот вход, по его сработке будет выполнен сервисный прогон всех кранов по очереди. Если оставить пустым, будут созданы только правила аварийного закрытия.", "sm"),
          field("Разрешающий выход для разминки (DO, должен быть OFF, необязательно)", inGuardDo, "Например, можно указать свет в санузле. Разминка стартует только если этот выход выключен. Проверка делается в момент старта сервиса.", "sm"),
          field("Пауза между кранами при сервисной разминке (сек)", inGapSec, "Чтобы краны не дёргались одновременно. По умолчанию 5 секунд.", "sm")
        ),

        valvesWrap,

        el("div", {style:"margin-top:10px;padding-top:10px;border-top:1px solid #eee"},
          el("button", {class:"kcs_btn danger", onclick: run}, "Создать защиту от протечек"),
          el("span", {style:"margin-left:10px;color:#777;font-size:12px"},
            "Один и тот же вход протечки можно указать у нескольких кранов, если по одному датчику нужно закрывать сразу всё."
          )
        )
      );

      bindNamePreview(inServiceDi, "di");
      bindNamePreview(inGuardDo, "do");
      return card;
    }
  });
})();
