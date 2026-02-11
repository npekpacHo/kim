(function(){
  if (window.KCS_IoNameEditor) return;

  const HDRS = {
    "accept": "*/*",
    "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "pragma": "no-cache",
    "x-requested-with": "XMLHttpRequest"
  };

  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

  const cleanName = (s) => {
    s = (s ?? "").toString().replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    return s;
  };

  const cpLen = (s) => Array.from((s ?? "").toString()).length;

  // Safe write length (9 unicode codepoints)
  const clip9 = (s) => Array.from(cleanName(s)).slice(0, 9).join("");

  async function monitorGet(){
    const r = await fetch("/monitor/get", {
      method:"POST",
      headers: HDRS,
      body: null,
      credentials:"include",
      cache:"no-store"
    });

    const text = await r.text();
    if(!r.ok) throw new Error(`monitor/get HTTP ${r.status}: ${text.slice(0,180)}`);

    let j;
    try { j = JSON.parse(text); }
    catch(e){ throw new Error(`monitor/get not JSON: ${text.slice(0,180)}`); }

    return (j && typeof j === "object" && j.data) ? j.data : j;
  }

  async function monitorSet(type, id1, name){
    const body = JSON.stringify({ type, id: id1, name });
    const r = await fetch("/monitor/set", {
      method:"POST",
      headers: HDRS,
      body,
      credentials:"include",
      cache:"no-store"
    });

    const text = await r.text();
    if(!r.ok) throw new Error(`monitor/set HTTP ${r.status}: ${text.slice(0,180)}`);
    return text;
  }

  function mk(tag, attrs, ...kids){
    const el = document.createElement(tag);
    if(attrs){
      for(const [k,v] of Object.entries(attrs)){
        if(v === null || v === undefined) continue;
        if(k === "class") el.className = v;
        else if(k === "style") el.style.cssText = v;
        else if(k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    for(const k of kids.flat()){
      if(k === null || k === undefined) continue;
      el.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return el;
  }

  function ensureStyles(){
    if(document.getElementById("kcs_io_name_editor_css")) return;
    const css = `
#kcs_io_name_modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:none;align-items:center;justify-content:center;padding:18px}
#kcs_io_name_card{width:min(780px,96vw);height:min(82vh,760px);background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 15px 50px rgba(0,0,0,0.35);display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}
#kcs_io_name_head{padding:10px 14px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;background:#f7f8fa}
#kcs_io_name_head h3{margin:0;font-size:14px;font-weight:700;color:#222}
#kcs_io_name_head .kcs_spacer{flex:1}
#kcs_io_name_note{color:#666;font-size:11px;padding:10px 14px;border-bottom:1px solid #f0f0f0}
#kcs_io_name_body{flex:1;display:grid;grid-template-columns: 1fr 1fr 0.9fr;gap:10px;overflow:hidden;padding:12px}
.kcs_io_col{overflow:auto;border:1px solid #f0f0f0;border-radius:10px;background:#fff}
.kcs_io_colhead{position:sticky;top:0;background:#fff;z-index:2;padding:10px 10px 6px;border-bottom:1px solid #f0f0f0;font-size:12px;font-weight:700;color:#222}
.kcs_io_tablewrap{padding:0 10px 10px}
.kcs_io_table{width:100%;border-collapse:collapse;font-size:12px}
.kcs_io_table th,.kcs_io_table td{border-bottom:1px solid #f6f6f6;padding:6px 8px;text-align:left;vertical-align:middle}
.kcs_io_table th{position:sticky;top:36px;background:#fff;z-index:1}
.kcs_io_table .num{width:64px;color:#666;white-space:nowrap}
.kcs_io_inp{width:150px;max-width:150px;box-sizing:border-box;padding:6px 8px;border:1px solid #d0d7de;border-radius:8px;font-size:12px}
.kcs_over td{background:#ffecec}
.kcs_over .kcs_io_inp{border-color:#d33}
.kcs_hint{padding:10px;font-size:12px;color:#333;line-height:1.35}
.kcs_hint ul{margin:8px 0 0 16px;padding:0}
.kcs_hint li{margin:6px 0;color:#444}
#kcs_io_name_foot{padding:10px 14px;border-top:1px solid #eee;display:flex;align-items:center;gap:10px}
#kcs_io_name_status{flex:1;color:#555;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;
    document.head.appendChild(mk("style",{id:"kcs_io_name_editor_css"}, css));
  }

  function buildModal(){
    ensureStyles();

    const modal = mk("div",{id:"kcs_io_name_modal"},
      mk("div",{id:"kcs_io_name_card"},
        mk("div",{id:"kcs_io_name_head"},
          mk("h3",null,"Имена входов/выходов  - лимит 9 символов (кириллицей - 7)"),
          mk("div",{class:"kcs_spacer"}),
          mk("button",{class:"kcs_btn", id:"kcs_io_close", type:"button"},"Закрыть")
        ),
        mk("div",{id:"kcs_io_name_note"},
          "Kincony не дружит с длинными описаниями. Всё, что длиннее 9 символов будет обрезано при записи в контроллер. Иначе получишь ���"
        ),
        mk("div",{id:"kcs_io_name_body"},
          mk("div",{class:"kcs_io_col", id:"kcs_io_col_di"},
            mk("div",{class:"kcs_io_colhead"},"DI (входы)"),
            mk("div",{class:"kcs_io_tablewrap"},
              mk("table",{class:"kcs_io_table"},
                mk("thead",null,
                  mk("tr",null,
                    mk("th",{class:"num"},"№"),
                    mk("th",null,"Имя")
                  )
                ),
                mk("tbody",{id:"kcs_io_tbody_di"})
              )
            )
          ),
          mk("div",{class:"kcs_io_col", id:"kcs_io_col_do"},
            mk("div",{class:"kcs_io_colhead"},"DO (выходы)"),
            mk("div",{class:"kcs_io_tablewrap"},
              mk("table",{class:"kcs_io_table"},
                mk("thead",null,
                  mk("tr",null,
                    mk("th",{class:"num"},"№"),
                    mk("th",null,"Имя")
                  )
                ),
                mk("tbody",{id:"kcs_io_tbody_do"})
              )
            )
          ),
          mk("div",{class:"kcs_io_col"},
            mk("div",{class:"kcs_io_colhead"},"Подсказки"),
            mk("div",{class:"kcs_hint"},
              "Длина важнее красоты:",
              mk("ul",null,
                mk("li",null,"Используй единый стиль"),
                mk("li",null,"Номер зоны лучше указать в начале."),
				mk("li",null,"Сокращения: к1, к2, к3 - комнаты. кух, кор, су... и т.п."),
				mk("li",null,"Используй прочерки в качестве разделителя"),
                mk("li",null,"Одинаковые вещи называй одинаково (не «Свет1» и «Лампа2»)."),
				mk("li",null,"спт - споты, точки"),
				mk("li",null,"пдв - подвес"),
				mk("li",null,"лст - люстра"),
				mk("li",null,"трк - трековый светильник"),
				mk("li",null,"бра - настенный светильник"),
				mk("li",null,"лед - светодиодная подсветка"),
				mk("li",null,"выт - вытяжка"),
                mk("li",null,"Участие в сценариях лучше упоминать в названиях"),
				mk("li",null,"Ц - централизованное управление / массовое действие"),
				mk("li",null,"М - локальное действие с несколькими выходами "),
				mk("li",null,"Например: к2_спт_М или су_выт2"),
              )
            )
          )
        ),
        mk("div",{id:"kcs_io_name_foot"},
          mk("button",{class:"kcs_btn", id:"kcs_io_reload", type:"button"},"Загрузить из контроллера"),
          mk("button",{class:"kcs_btn primary", id:"kcs_io_apply", type:"button"},"Применить"),
          mk("button",{class:"kcs_btn danger", id:"kcs_io_cancel", type:"button", style:"display:none"},"Отмена"),
          mk("div",{id:"kcs_io_name_status"},"")
        )
      )
    );

    document.body.appendChild(modal);
    return modal;
  }

  let modalEl = null;
  let current = { di: [], do: [] };
  let isBusy = false;
  let cancelFlag = false;

  function setStatus(s){
    const st = document.getElementById("kcs_io_name_status");
    if(st) st.textContent = s || "";
  }

  function setBusy(b){
    isBusy = b;
    const apply = document.getElementById("kcs_io_apply");
    const reload = document.getElementById("kcs_io_reload");
    const cancel = document.getElementById("kcs_io_cancel");
    if(apply) apply.disabled = b;
    if(reload) reload.disabled = b;
    if(cancel) cancel.style.display = b ? "" : "none";
    const inputs = modalEl ? modalEl.querySelectorAll("input.kcs_io_inp") : [];
    inputs.forEach(i=> i.disabled = b);
  }

  function renderTables(){
    const tbDi = document.getElementById("kcs_io_tbody_di");
    const tbDo = document.getElementById("kcs_io_tbody_do");
    if(!tbDi || !tbDo) return;

    tbDi.innerHTML = "";
    tbDo.innerHTML = "";

    const mark = ()=>{
      const overDi = current.di.filter(x=>cpLen(x)>9).length;
      const overDo = current.do.filter(x=>cpLen(x)>9).length;
      const warn = (overDi||overDo) ? ` | ⚠ >9: DI=${overDi}, DO=${overDo}` : "";
      setStatus(`DI: ${current.di.length} | DO: ${current.do.length}${warn}`);
    };

    for(let i=0;i<current.di.length;i++){
      const idx = i+1;
      const inp = mk("input",{class:"kcs_io_inp", type:"text", value: current.di[i] ?? ""});
      const tr = mk("tr",null,
        mk("td",{class:"num"},"DI"+idx),
        mk("td",null, inp)
      );

      const update = ()=>{
        const v = cleanName(inp.value);
        current.di[i] = v;
        tr.classList.toggle("kcs_over", cpLen(v) > 7);
        mark();
      };
      inp.addEventListener("input", update);
      update();

      tbDi.appendChild(tr);
    }

    for(let i=0;i<current.do.length;i++){
      const idx = i+1;
      const inp = mk("input",{class:"kcs_io_inp", type:"text", value: current.do[i] ?? ""});
      const tr = mk("tr",null,
        mk("td",{class:"num"},"DO"+idx),
        mk("td",null, inp)
      );

      const update = ()=>{
        const v = cleanName(inp.value);
        current.do[i] = v;
        tr.classList.toggle("kcs_over", cpLen(v) > 7);
        mark();
      };
      inp.addEventListener("input", update);
      update();

      tbDo.appendChild(tr);
    }

    mark();
  }

  async function reloadFromController(){
    setBusy(true);
    cancelFlag = false;
    try{
      setStatus("Читаю /monitor/get …");
      const j = await monitorGet();

      const ins = Array.isArray(j.inputs) ? j.inputs : [];
      const outs = Array.isArray(j.outputs) ? j.outputs : [];

      current.di = ins.map(x => cleanName(x && x.name ? x.name : ""));
      current.do = outs.map(x => cleanName(x && x.name ? x.name : ""));

      renderTables();
      setStatus(`Загружено: DI=${current.di.length}, DO=${current.do.length}`);
    }catch(e){
      console.warn(e);
      setStatus("Ошибка чтения: " + (e && e.message ? e.message : e));
    }finally{
      setBusy(false);
    }
  }

  async function applyToController(){
    setBusy(true);
    cancelFlag = false;

    try{
      setStatus("Сверяю изменения …");
      const j = await monitorGet();

      const ins = Array.isArray(j.inputs) ? j.inputs : [];
      const outs = Array.isArray(j.outputs) ? j.outputs : [];

      const curDi = ins.map(x => clip9(x && x.name ? x.name : ""));
      const curDo = outs.map(x => clip9(x && x.name ? x.name : ""));

      // normalize to controller length
      current.di = Array.from({length: curDi.length}, (_,i)=> cleanName(current.di[i] ?? ""));
      current.do = Array.from({length: curDo.length}, (_,i)=> cleanName(current.do[i] ?? ""));

      const desiredDi = current.di.map(clip9);
      const desiredDo = current.do.map(clip9);

      const jobs = [];
      for(let i=0;i<curDi.length;i++){
        if(desiredDi[i] !== curDi[i]) jobs.push({type:"input", id:i, name: desiredDi[i], label:`DI${i+1}`});
      }
      for(let i=0;i<curDo.length;i++){
        if(desiredDo[i] !== curDo[i]) jobs.push({type:"output", id:i, name: desiredDo[i], label:`DO${i+1}`});
      }

      if(jobs.length === 0){
        renderTables();
        setStatus("Нечего применять: всё уже совпадает.");
        return;
      }

      let done = 0;
      setStatus(`Записываю имена: 0/${jobs.length} …`);

      for(let k=0;k<jobs.length;k++){
        if(cancelFlag) throw new Error("Отменено пользователем");
        const it = jobs[k];

        await monitorSet(it.type, it.id, it.name);
        done++;
        setStatus(`Записываю имена: ${done}/${jobs.length} (последнее: ${it.label})`);

        await sleep(230);
        if(done % 10 === 0) await sleep(1100);
      }

      setStatus(`Готово. Записано: ${done} шт.`);
      await sleep(250);
      await reloadFromController();

    }catch(e){
      console.warn(e);
      setStatus("Ошибка записи: " + (e && e.message ? e.message : e));
    }finally{
      setBusy(false);
      cancelFlag = false;
    }
  }

  function open(){
    if(!modalEl) modalEl = buildModal();

    if(!modalEl.__wired){
      modalEl.__wired = true;

      modalEl.addEventListener("click",(e)=>{
        if(e.target && e.target.id === "kcs_io_name_modal") close();
      });

      document.getElementById("kcs_io_close").addEventListener("click", close);
      document.getElementById("kcs_io_reload").addEventListener("click", reloadFromController);
      document.getElementById("kcs_io_apply").addEventListener("click", applyToController);
      document.getElementById("kcs_io_cancel").addEventListener("click", ()=>{ cancelFlag = true; setStatus("Отмена…"); });

      document.addEventListener("keydown",(e)=>{
        if(modalEl.style.display !== "flex") return;
        if(e.key === "Escape") close();
      });
    }

    modalEl.style.display = "flex";

    if(current.di.length === 0 && current.do.length === 0){
      reloadFromController();
    }else{
      renderTables();
    }
  }

  function close(){
    if(!modalEl) return;
    if(isBusy) return; // don't close mid-write
    modalEl.style.display = "none";
    setStatus("");
  }

  window.KCS_IoNameEditor = { open, close, reload: reloadFromController };
})();
