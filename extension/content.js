(function(){
  if (window.__KCS_HELPER_LOADED__) return;
  window.__KCS_HELPER_LOADED__ = true;

  // Safety: run ONLY on localhost/private LAN addresses.
  // Chrome match patterns cannot express IP ranges like 192.168.*.*,
  // so we gate execution here instead of in manifest.json.
  const __KCS_IS_LOCAL_HOST__ = (host) => {
    if (!host) return false;
    host = String(host).toLowerCase();

    // Plain local hostnames
    if (host === "localhost" || host === "::1") return true;

    // Common LAN TLDs (optional, but practical)
    if (host.endsWith(".local") || host.endsWith(".lan")) return true;

    // IPv4 private ranges + loopback
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
    if ([a,b,c,d].some(x => Number.isNaN(x) || x < 0 || x > 255)) return false;

    if (a === 127) return true;                 // loopback
    if (a === 10) return true;                  // 10.0.0.0/8
    if (a === 192 && b === 168) return true;    // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12

    return false;
  };

  if (!__KCS_IS_LOCAL_HOST__(location.hostname)) return;


// content.js
(() => {
  "use strict";

// ==========================================
  // 1. CONFIG
  // ==========================================
  const CFG = {
      ver: "v.2.0.7", 
      diMax: 40, doMax: 32, adcMax: 4, sensorMax: 0, dacMax: 0,
      Z32: "00000000000000000000000000000000",
      detailUrl: "/ifttt_edit.html",
      // --- НАСТРОЙКИ ОПРОСА ---
      pollIntervalHttp: 2500, // HTTP медленный, дергаем редко (резерв)
      pollIntervalWs: 700,    // 700мс = ~1.4 раза в секунду. Меньше спама по WS, меньше потерь команд.
      wsReconnectDelay: 3000, // Даем время контроллеру очухаться перед реконнектом
      secret: "" 
  };

  const BASE = window.location.origin;
  const WS_PROTO = location.protocol === "https:" ? "wss" : "ws";
  const WS_URL = `${WS_PROTO}://${window.location.host}/ws`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- HELPERS ---
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "style") {
        if (typeof v === "string") n.style.cssText = v;
        else Object.assign(n.style, v);
      }
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
    }
    children.forEach(c => {
        if(c !== null && c !== undefined) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  const limitName15 = (s) => {
    if (s === undefined || s === null) return "";
    s = String(s).trim();
    // KinCony хранит максимум 15 символов (по факту: 15 codepoints).
    const chars = [...s];
    return (chars.length > 15) ? chars.slice(0, 15).join("") : s;
  };

  };

  function parseRanges(str) {
      if(!str) return [];
      const res = [];
      str.toString().split(",").forEach(s => {
          const val = parseInt(s.trim());
          if(!isNaN(val)) res.push(val);
      });
      return res;
  }

  function shortName(s) {
    return String(s || "").replace(/[^a-zA-Z0-9а-яА-Я _-]/g, "").trim().slice(0, 20);
  }

  
  // --- BACKUP HELPERS (export/import) ---
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowStamp = () => {
      const d = new Date();
      return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  };

  async function getControllerMeta() {
      // Try to collect stable meta from different endpoints.
      let model = "";
      let firmware = "";
      let diMax = CFG.diMax;
      let doMax = CFG.doMax;
      let adcMax = CFG.adcMax;

      try {
          const sys = await API.getSystemInfo();
          if(sys && sys.model) {
              model = String(sys.model || "");
              firmware = String(sys.version || "");
              state.lastSysInfo = sys;
          }
      } catch(e) {}

      try {
          const src = await API.getSources();
          if(src) {
              if(src.di_num) diMax = parseInt(src.di_num) || diMax;
              if(src.do_num) doMax = parseInt(src.do_num) || doMax;
          }
      } catch(e) {}

      try {
          const names = await API.getNames();
          if(names) {
              if(names.input_num) diMax = parseInt(names.input_num) || diMax;
              if(names.output_num) doMax = parseInt(names.output_num) || doMax;
              if(names.adc_num !== undefined) adcMax = parseInt(names.adc_num) || adcMax;
              if(Array.isArray(names.adcs) && names.adcs.length) adcMax = names.adcs.length;
          }
      } catch(e) {}

      // Fallbacks
      if(!model) model = (state.lastSysInfo && state.lastSysInfo.model) ? String(state.lastSysInfo.model) : "";
      if(!model) model = window.location.host || "kincony";
      if(!firmware && state.lastSysInfo && state.lastSysInfo.version) firmware = String(state.lastSysInfo.version);

      return { model, firmware, diMax, doMax, adcMax, exportedAt: new Date().toISOString() };
  }

  function buildBackupFilename(meta, suffix) {
      const m = shortName(meta && meta.model ? meta.model : "kincony") || "kincony";
      const stamp = nowStamp();
      return `${m}_${stamp}_${suffix}.json`;
  }

  function parseBackupJson(rawText) {
      // Supports:
      // 1) old format: [rule, rule, ...]
      // 2) new format: { meta:{...}, rules:[...] }
      // 3) single rule: { ...rule... }
      // 4) wrapped single: { meta:{...}, rule:{...} }
      const obj = JSON.parse(rawText);
      if(Array.isArray(obj)) return { meta:null, rules: obj, single:false };
      if(obj && typeof obj === "object") {
          if(Array.isArray(obj.rules)) return { meta: obj.meta || null, rules: obj.rules, single:false };
          if(obj.rule) return { meta: obj.meta || null, rules: [obj.rule], single:true };
          // looks like a single rule
          if(obj.if_items || obj.then_items) return { meta:null, rules:[obj], single:true };
      }
      throw new Error("Непонятный формат JSON");
  }

  function clipMaskToDoMax(hexMask, doMax) {
      const arr = parseMaskToArr(hexMask);
      const ok = arr.filter(x => x >= 1 && x <= doMax);
      return makeHexMask(ok);
  }

  function sanitizeRuleForController(rule, diMax, doMax) {
      // Returns { rule: cleanedRule, disabled: bool, notes: string[] }
      const r = JSON.parse(JSON.stringify(rule || {}));
      const notes = [];
      let disabled = false;

      // Normalize payload shape
      const pr = preparePayload(r);

      // IF items: keep only in-range for DI/DO checks
      const ifClean = [];
      for(const it of (pr.if_items || [])) {
          const t = parseInt(it.type);
          const idx1 = parseInt(it.index) + 1;
          if(t === 1) { // DI
              if(idx1 >= 1 && idx1 <= diMax) ifClean.push(it);
              else { disabled = true; notes.push(`IF: DI${idx1} вне диапазона (1..${diMax})`); }
          } else if(t === 16) { // DO state check
              if(idx1 >= 1 && idx1 <= doMax) ifClean.push(it);
              else { disabled = true; notes.push(`IF: DO${idx1} вне диапазона (1..${doMax})`); }
          } else {
              // Unknown types we keep as-is (could be timer/adc/etc)
              ifClean.push(it);
          }
      }

      // THEN items: clip output masks to available DO count
      const thenClean = [];
      for(const it of (pr.then_items || [])) {
          const t = parseInt(it.type);
          if(t === 9) {
              const on2 = clipMaskToDoMax(it.on || CFG.Z32, doMax);
              const off2 = clipMaskToDoMax(it.off || CFG.Z32, doMax);
              const tog2 = clipMaskToDoMax(it.toggle || CFG.Z32, doMax);

              const hadOor = (parseMaskToArr(it.on || CFG.Z32).some(x => x > doMax)
                          || parseMaskToArr(it.off || CFG.Z32).some(x => x > doMax)
                          || parseMaskToArr(it.toggle || CFG.Z32).some(x => x > doMax));
              if(hadOor) { disabled = true; notes.push(`THEN: обрезаны маски DO до 1..${doMax}`); }

              thenClean.push({ ...it, on: on2, off: off2, toggle: tog2 });
          } else {
              thenClean.push(it);
          }
      }

      pr.if_items = ifClean;
      pr.then_items = thenClean;
      pr.if_count = ifClean.length;
      pr.then_count = thenClean.length;

      // If anything got removed/clipped OR rule becomes empty, disable.
      if(pr.if_count === 0 || pr.then_count === 0) {
          disabled = true;
          notes.push("Правило пустое после фильтрации (нет IF или THEN)");
      }

      if(disabled) {
          pr.enable = 0;
          // Имя не меняем (лимит 15 символов на контроллере)
      }

      return { rule: pr, disabled, notes };
  }

  function wrapBackup(meta, rules) {
      return { meta, rules };
  }

  // --- HEX MASK GENERATOR (Версия 1.7.4 - Проверенная) ---
  function makeHexMask(doIndices) {
      const nibbles = new Array(32).fill(0); 
      doIndices.forEach(idx => {
          if(idx < 1 || idx > 128) return;
          const nibIdx = Math.floor((idx - 1) / 4);
          const bitPos = (idx - 1) % 4;
          const val = 1 << (3 - bitPos); 
          if(nibIdx < 32) nibbles[nibIdx] |= val;
      });
      return nibbles.map(n => n.toString(16)).join("");
  }

  function parseMaskToArr(hex) {
      if(!hex || parseInt(hex, 16) === 0) return [];
      const res = [];
      const len = Math.min(hex.length, 32);
      for(let i=0; i<len; i++) {
          const val = parseInt(hex[i], 16);
          if(isNaN(val) || val === 0) continue;
          const base = i * 4;
          if(val & 8) res.push(base + 1);
          if(val & 4) res.push(base + 2);
          if(val & 2) res.push(base + 3);
          if(val & 1) res.push(base + 4);
      }
      return res.sort((a,b)=>a-b);
  }

  function makeAllOffMaskExcept(exceptions) {
      const turnOffList = []; 
      for(let i=1; i<=CFG.doMax; i++) {
          if(!exceptions.includes(i)) turnOffList.push(i);
      }
      return makeHexMask(turnOffList);
  }

  // ==========================================
  // 2. DATA PREPARATION
  // ==========================================
  function preparePayload(r) {
      const cleanIf = (r.if_items || []).map(item => ({
          type: parseInt(item.type),
          index: parseInt(item.index),
          triggle: item.triggle !== undefined ? parseInt(item.triggle) : (item.trigger !== undefined ? parseInt(item.trigger) : 0),
          ...(item.operator !== undefined ? {operator: item.operator} : {}),
          ...(item.value !== undefined ? {value: item.value} : {})
      }));

      const cleanThen = (r.then_items || []).map(item => ({
          type: parseInt(item.type),
          ...(item.type === 9 ? {
              on: item.on || CFG.Z32,
              off: item.off || CFG.Z32,
              toggle: item.toggle || CFG.Z32
          } : {}),
          ...(item.type === 11 ? { delay: parseInt(item.delay) } : {}),
          ...(item.id !== undefined ? {id: item.id} : {}),
          ...(item.value !== undefined ? {value: item.value} : {})
      }));

      return {
          id: parseInt(r.id),
          name: r.name || "",
          enable: r.enable ? 1 : 0,
          relation: r.relation !== undefined ? parseInt(r.relation) : 0,
          scenario_mode: r.scenario_mode !== undefined ? parseInt(r.scenario_mode) : 0,
          if_items: cleanIf,
          if_count: cleanIf.length,
          then_items: cleanThen,
          then_count: cleanThen.length
      };
  }

  // ==========================================
  // 3. API LAYER
  // ==========================================
  async function apiPost(path, body = null) {
      try {
          const res = await fetch(`${BASE}${path}`, {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
              body: body ? JSON.stringify(body) : null
          });
          const txt = await res.text();
          try { 
              const json = JSON.parse(txt);
              if (json.ok === undefined) json.ok = (json.code === 200 || json.code === 0 || json.status === "success");
              return json;
          } catch { return { text: txt, status: res.status, ok: res.ok }; }
      } catch (e) { return { error: e.message, ok: false }; }
  }

  async function apiCgi(cmd, id=0, value=0) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
          // Secret is included
          const url = `${BASE}/ctrl.cgi?cmd=${cmd}&id=${id}&value=${value}&secret=${encodeURIComponent(CFG.secret)}`; 
          const res = await fetch(url, { credentials: "include", signal: controller.signal });
          clearTimeout(timeoutId);
          if(res.ok) {
              const txt = await res.text();
              try { return JSON.parse(txt); } catch { return null; }
          }
      } catch(e) {}
      return null;
  }

  const API = {
      save: (rule) => apiPost("/ifttt/save_channel", preparePayload(rule)),
      delete: (ids) => apiPost("/ifttt/set", { cmd: "delete", ids: ids }),
      getSources: () => apiPost("/ifttt/source", null),
      list: async () => { return apiListAll(); },
      getDetail: async (id) => {
          try {
              const res = await fetch(`${BASE}${CFG.detailUrl}?id=${id}`, { method: "POST", credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
              if(!res.ok) return { ok: false };
              const json = await res.json();
              return { ok: true, data: json };
          } catch(e) { return { ok: false }; }
      },
      getNames: () => apiPost("/monitor/get", null),
      setName: (type, id, name) => apiPost("/monitor/set", { type, id, name: limitName15(name) }),
      getAllDatas: () => apiCgi("get_all_datas"),
      setOutput: (id, val) => apiCgi("set_output", id, val),
      getInputs: () => apiCgi("get_inputs"),
      getOutputs: () => apiCgi("get_outputs"),
      getAdcs: () => apiCgi("get_adcs"),
      getDacs: () => apiCgi("get_dacs"),

	  setAllOutputs: (val) => apiCgi("set_all_outputs", 0, val ? 1 : 0),
      // CGI set_outputs needs 16 chars. IFTTT uses 32. Truncate for CGI.
      setOutputsHex: (hexMask) => apiCgi("set_outputs", 0, hexMask.substring(0, 16)),
      getSystemInfo: () => apiPost("/index", null),
      restart: () => apiPost("/restart", null),
      runIR: (id) => apiCgi("run_ir", id, 0),
      runRF: (id) => apiCgi("run_rf", id, 0),
      setBeep: (isOn) => apiCgi("set_beep", 1, isOn ? 1 : 0)
  };

  async function apiListAll() {
      const CHUNK = 50;
      let offset = 0;
      let allRows = [];
      while(offset < 2000) { 
          try {
              const res = await fetch(`${BASE}/ifttt/get`, {
                  method: "POST", credentials: "include",
                  headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
                  body: new URLSearchParams({ limit: CHUNK, offset: offset, keyword: "" })
              });
              if(!res.ok) break;
              const data = await res.json();
              if(data && Array.isArray(data.rows) && data.rows.length > 0) {
                  allRows = allRows.concat(data.rows);
                  if(data.rows.length < CHUNK) break; 
                  offset += CHUNK;
                  await sleep(100);
              } else break;
          } catch(e) { break; }
      }
      return { rows: allRows };
  }

  // ==========================================
  // 4. UI HELPERS
  // ==========================================
  function describeRuleHtml(r) {
      let ifHtml = "";
      if(r.if_items && r.if_items.length) {
          ifHtml = r.if_items.map(t => {
              if(t.type === 1) { // DI
                  const diNum = t.index + 1;
                  const name = state.diNames[t.index] ? `(${state.diNames[t.index]})` : "";
                  const trig = t.triggle === 2 ? " [Long]" : "";
                  return `<span class="kcs_badge if">🔘 DI ${diNum}${trig} ${name}</span>`;
              } else if(t.type === 16) {
                  // UPDATED: Show trigger state for DO Check
                  const doNum = t.index + 1;
                  const name = state.doNames[t.index] ? `(${state.doNames[t.index]})` : "";
                  const stateStr = t.triggle === 1 ? "ON" : "OFF";
                  const color = t.triggle === 1 ? "on" : "off";
                  return `<span class="kcs_badge ${color}">IF DO ${doNum} ${stateStr} ${name}</span>`;
              }
              return `<span class="kcs_badge gray">Type ${t.type}</span>`;
          }).join(" ");
      } else ifHtml = `<span class="kcs_badge danger">--</span>`;

      let thenHtml = "";
      if(r.then_items && r.then_items.length) {
          thenHtml = r.then_items.map(t => {
              if(t.type === 11) return `<span class="kcs_badge delay">⏳${t.delay}s</span>`;
              if(t.type === 9) {
                  const tog = parseMaskToArr(t.toggle);
                  const on = parseMaskToArr(t.on);
                  const off = parseMaskToArr(t.off);
                  const joinDO = (arr) => arr.join(',<wbr>DO');
                  if(tog.length) return `<span class="kcs_badge tog">TOG: DO${joinDO(tog)}</span>`;
                  if(on.length) return `<span class="kcs_badge on">ON: DO${joinDO(on)}</span>`;
                  if(off.length) return `<span class="kcs_badge off">OFF: DO${joinDO(off)}</span>`;
                  return `<span class="kcs_badge danger">No Action</span>`;
              }
              return `<span class="kcs_badge gray">Act${t.type}</span>`;
          }).join(" ➜ ");
      } else thenHtml = `<span class="kcs_badge danger">--</span>`;

      return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:11px;">${ifHtml} ➜ ${thenHtml}</div>`;
  }

  const nameUpdateRegistry = [];
  function bindNamePreview(input, type) {
      const hint = el("div", {style:"font-size:10px;color:#09c;min-height:12px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:italic"});
      input.parentNode.insertBefore(hint, input.nextSibling);
      const update = () => {
          const val = input.value;
          if(!val) { hint.textContent = ""; return; }
          const indices = parseRanges(val);
          const names = indices.map(i => {
              const arr = type==='di' ? state.diNames : state.doNames;
              const name = arr[i-1];
              return name ? `[${i}:${name}]` : `[${i}]`;
          });
          hint.textContent = names.join(" + ");
      };
      input.addEventListener("input", update);
      nameUpdateRegistry.push(update);
      setTimeout(update, 200);
  }
  function triggerAllNamePreviews() { nameUpdateRegistry.forEach(fn => fn()); }

  const mkInp = (val="", a="", b="", cssVars=null) => {
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    let cls = "kcs_inp"; let ph = ""; let vars = {};
    if (isObj(a)) vars = a;
    else if (typeof a === "string" && a.includes("kcs_")) { cls = a; if (isObj(b)) vars = b; else { ph = b || ""; if (isObj(cssVars)) vars = cssVars; } } 
    else { ph = a || ""; if (isObj(b)) vars = b; else if (isObj(cssVars)) vars = cssVars; }
    const i = el("input", {class: cls, type:"text", inputmode:"numeric", pattern:"[0-9, ]*", value: val||"", placeholder: ph||""});
    Object.entries(vars).forEach(([k,v]) => { try { i.style.setProperty(k, String(v)); } catch(e){} });
    return i;
  };
  const mkInpSm = (val="", ph="", cssVars=null) => mkInp(val, "kcs_inp_sm", ph, cssVars);
  const field = (labelText, controlEl, helpText = "", cls = "") => {
    const wrap = el("div", { class: `kcs_field ${cls}`.trim() });
    wrap.appendChild(el("label", { class: "kcs_label" }, labelText));
    wrap.appendChild(controlEl);
    if (helpText) wrap.appendChild(el("div", { class: "kcs_help" }, helpText));
    return wrap;
  };

  async function findNextFreeId(startFrom) {
      try {
          const list = await API.list();
          if(!list.rows) return startFrom;
          const used = new Set(list.rows.map(r => parseInt(r.id)));
          let cand = startFrom;
          while(used.has(cand) && cand < 60) cand++;
          return cand;
      } catch(e) { return startFrom; }
  }
  async function checkOverwrite(id) {
      try {
          const list = await API.list();
          const existing = list.rows.find(r => r.id == id);
          if(existing) return confirm(`Правило ID ${id} уже существует!\nИмя: "${existing.name}"\n\nПерезаписать?`);
      } catch(e){}
      return true;
  }

  
  // ==========================================
  // 4. PRESET MODULES (Registry)
  // ==========================================
  window.__KCS_PRESET_REGISTRY__ = window.__KCS_PRESET_REGISTRY__ || [];
  window.__KCS_REGISTER_PRESET__ = window.__KCS_REGISTER_PRESET__ || function(p) {
      try {
          if(!p || typeof p !== "object") return;
          const id = (p.id || "").toString();
          if(!id) return;
          const reg = window.__KCS_PRESET_REGISTRY__;
          if(reg.some(x => x && x.id === id)) return;
          reg.push(p);
      } catch(e) {}
  };

  function listPresets() {
      return (window.__KCS_PRESET_REGISTRY__ || []).slice();
  }

  function makePresetCtx(logFn) {
      return {
          el, mkInp, mkInpSm, field,
          parseRanges,
          checkOverwrite,
          makeHexMask,
          parseMaskToArr,
          makeAllOffMaskExcept,
          API,
          CFG,
          sleep,
          bindNamePreview,
          shortName,
          findNextFreeId: (typeof findNextFreeId === "function") ? findNextFreeId : async () => null,
          log: (typeof logFn === "function") ? logFn : (()=>{})
      };
  }

  // Close preset modal by ESC (global one-time listener)
  if(!window.__KCS_PRESET_ESC__) {
      window.__KCS_PRESET_ESC__ = true;
      document.addEventListener("keydown", (e) => {
          if(e.key !== "Escape") return;
          const m = document.getElementById("kcs_preset_modal");
          if(m && m.style.display !== "none") m.style.display = "none";
      });
  }

// ==========================================
  // 5. RENDERERS
  // ==========================================
  function renderMap(){
    const wrap = el("div",{class:"kcs_tab_content"});
    const logArea = el("pre",{class:"kcs_log_box",style:"height:100px"}, "Маппинг входов на выходы...");
    const l = (t) => { logArea.textContent = t + "\n" + logArea.textContent; };
    const inStartDi = mkInp("1", {"--kcs-inp-max":"50px"});
    const inStartDo = mkInp("1", {"--kcs-inp-max":"50px"});
    const inCount = mkInp("8", {"--kcs-inp-max":"120px"});
    const inRuleId = mkInp("1", {"--kcs-inp-max":"160px"});

    const runMap = async (isAuto) => {
        let sDi, sDo, cnt, sId;
        if(isAuto) {
            const m = Math.min(CFG.diMax, CFG.doMax);
            if(!confirm(`Создать правила 1:1 для всех входов/выходов?\nDI 1 -> DO 1 ... DI ${m} -> DO ${m}\nСтарт с ID 1`)) return;
            sDi = 1; sDo = 1; cnt = m; sId = 1;
        } else {
            sDi = parseInt(inStartDi.value); sDo = parseInt(inStartDo.value);
            cnt = parseInt(inCount.value); sId = parseInt(inRuleId.value);
            if(!sDi || !sDo || !cnt || !sId) return alert("Заполните все поля!");
            if(!confirm(`Создать ${cnt} правил начиная с DI ${sDi} -> DO ${sDo} (ID ${sId})?`)) return;
        }
        l(">>> Старт маппинга...");
        for(let i=0; i<cnt; i++) {
            const cDi = sDi + i; const cDo = sDo + i; const cId = sId + i;
            const rule = {
                id: cId, name: shortName(`Map_DI${cDi}_DO${cDo}`),
                enable: 1, relation: 0, scenario_mode: 0,
                if_items: [{ type: 1, index: cDi-1, triggle: 0 }],
                then_items: [{ type: 9, toggle: makeHexMask([cDo]), on: CFG.Z32, off: CFG.Z32 }]
            };
            const res = await API.save(rule);
            if(res.ok) l(`OK: ID ${cId} (DI${cDi}->DO${cDo})`); else l(`ERR: ID ${cId}`);
            if(i%10 === 0) await sleep(500); else await sleep(150);
        }
        l("Готово!"); alert("Маппинг завершен.");
    };

    wrap.appendChild(el("div",{class:"kcs_card"},
        el("div",{class:"kcs_card_head"},"Генератор правил 1:1 (Toggle)"),
		el("div",{style:"margin-bottom:10px;color:#666;font-size:11px"}, "Массовое сопоставление Входов Выходам по принципу DI-toggle-DO. Будут установлены связи и созданы правила для заданного диапазона или всех пар Входов/Выходов с одинаковыми номерами создавая программный аналог импульсных реле."),
        el("div",{class:"kcs_form"},
            field("С входа (DI)", inStartDi, "", "sm"), field("На выход (DO)", inStartDo, "", "sm"),
            field("Количество", inCount, "", "sm"), field("Старт ID", inRuleId, "", "sm")
        ),
        el("div",{class:"kcs_actions"},
            el("button",{class:"kcs_btn primary", onclick:()=>runMap(false)},"Создать"),
            el("button",{class:"kcs_btn", style:"background:#6f42c1;color:#fff", onclick:()=>runMap(true)},"Авто 1:1 (Все)")
        ),
        el("div",{class:"kcs_help"},"Авто 1:1 создаст DI 1→DO 1 ... до максимума доступных выходов."),
        logArea
    ));
    return wrap;
  }

  
  function renderPresets(){
      const wrap = el("div",{class:"kcs_tab_content"});
      const presets = listPresets().sort((a,b)=>{
          const ao = (a && a.order !== undefined) ? a.order : 9999;
          const bo = (b && b.order !== undefined) ? b.order : 9999;
          if(ao !== bo) return ao - bo;
          const at = (a && (a.title || a.id) || "").toString();
          const bt = (b && (b.title || b.id) || "").toString();
          return at.localeCompare(bt, "ru");
      });

      // Modal skeleton (single modal for all presets)
      const modal = el("div",{id:"kcs_preset_modal", class:"kcs_modal_overlay", style:"display:none"},
          el("div",{class:"kcs_modal_card", onclick:(e)=>e.stopPropagation()},
              el("div",{class:"kcs_modal_head"},
                  el("div",{id:"kcs_preset_modal_title", class:"kcs_modal_title"},""),
                  el("button",{class:"kcs_btn", style:"padding:6px 10px", onclick:()=>showModal(false)},"✕")
              ),
              el("div",{id:"kcs_preset_modal_body", class:"kcs_modal_body"})
          )
      );

      function showModal(show){
          modal.style.display = show ? "flex" : "none";
      }
      modal.onclick = ()=>showModal(false);

      function openPreset(p){
          const titleEl = modal.querySelector("#kcs_preset_modal_title");
          const bodyEl  = modal.querySelector("#kcs_preset_modal_body");
          titleEl.textContent = `${p.icon ? p.icon+" " : ""}${p.title || p.id || "Preset"}`;
          bodyEl.innerHTML = "";

          const logArea = el("pre",{class:"kcs_log_box", style:"height:140px"}, "");
          const l = (t) => {
              const line = (t===undefined || t===null) ? "" : String(t);
              logArea.textContent = line + "\n" + logArea.textContent;
          };
          const ctx = makePresetCtx(l);

          let ui = null;
          try {
              ui = (p && typeof p.render === "function") ? p.render(ctx) : null;
          } catch(e) {
              ui = el("div",{class:"kcs_empty"}, `Ошибка пресета: ${e.message || e}`);
          }

          if(Array.isArray(ui)) ui.forEach(x=>x && bodyEl.appendChild(x));
          else if(ui) bodyEl.appendChild(ui);

          // Log controls
          const copyLog = async () => {
              const txt = logArea.textContent || "";
              try {
                  if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
                  else prompt("Copy log:", txt);
              } catch(e) { prompt("Copy log:", txt); }
          };
          bodyEl.appendChild(el("div",{class:"kcs_row", style:"margin-top:10px"},
              el("button",{class:"kcs_btn", onclick:()=>{logArea.textContent="";}},"Очистить лог"),
              el("button",{class:"kcs_btn", onclick:copyLog},"Копировать лог")
          ));
          bodyEl.appendChild(logArea);

          if(p && p.description) l(p.description);
          showModal(true);
      }

      const grid = el("div",{class:"kcs_preset_grid"});
      if(!presets.length){
          grid.appendChild(el("div",{class:"kcs_empty"},
              "Пока нет пресетов. Проверь, что файлы presets/*.js подключены в manifest.json и расширение перезагружено."
          ));
      } else {
          presets.forEach(p=>{
              const tags = Array.isArray(p.tags) ? p.tags : [];
              const meta = el("div",{class:"kcs_preset_meta"},
                  ...tags.slice(0,6).map(t=>el("span",{class:"kcs_preset_tag"}, String(t)))
              );
              const btn = el("button",{class:"kcs_preset_btn", onclick:()=>openPreset(p)},
                  el("div",{class:"kcs_preset_title"}, `${p.icon ? p.icon+" " : ""}${p.title || p.id}`),
                  el("div",{class:"kcs_preset_desc"}, (p.description || "").toString()),
                  tags.length ? meta : null
              );
              grid.appendChild(btn);
          });
      }

      wrap.appendChild(el("div",{class:"kcs_card"},
          el("div",{class:"kcs_card_head"},"Пресеты"),
          el("div",{class:"kcs_help"},
              "Готовые сценарии для типовых задач. Достаточно выбрать входы/выходы и задать параметры чтобы получить набор правил." +
              " "
          ),
          grid
      ));

      wrap.appendChild(modal);
      return wrap;
  }


  function renderRules() {
      const wrap = el("div", {class:"kcs_tab_content"});
      const head = el("div", {class:"kcs_row"}, 
          el("button", {class:"kcs_btn primary", onclick:()=>runScanner(wrap)}, "🔄 Сканировать"),
          el("button", {class:"kcs_btn", style:"margin-left:10px", onclick:()=>API.restart()}, "⟳ Перезагрузить контроллер")
      );
      const output = el("div", {id:"kcs_rules_out"});
      const fileIn = el("input", {type:"file", accept:".json", style:"display:none", onchange:(e)=>handleSingleImport(e, wrap)});
      wrap.appendChild(head); wrap.appendChild(output); wrap.appendChild(fileIn);
      if(state.fullRulesCache.length > 0) renderRulesTable(output, fileIn); else runScanner(wrap);
      return wrap;
  }

	const WAIT_IMG_URL = (chrome?.runtime?.getURL)
	? chrome.runtime.getURL("wait.png")
	: "wait.png";


  async function runScanner(wrap) {
      const out = wrap.querySelector("#kcs_rules_out");
      out.innerHTML = `
	<div class="kcs_loader">
    <div style="font-weight:600;margin-bottom:8px;">Получение списка правил...</div>
    <div style="color:#666;font-size:12px;max-width:520px;margin:0 auto 10px;line-height:1.35;">
      Важно: дождитесь завершения загрузки. Пока счётчик не дойдёт до конца, таблица может быть неполной и действия могут работать некорректно.
    </div>
    <img src="${WAIT_IMG_URL}" alt="Please wait" style="width:200px;height:200px;object-fit:contain;opacity:.95;display:block;margin:0 auto;">
	</div>`;

      const list = await API.list(); 
      if(!list.rows || !list.rows.length) { out.innerHTML = "<div class='kcs_empty'>Пусто.</div>"; return; }
      state.fullRulesCache = [];
      const total = list.rows.length;
      if(list.rows[0].if_items && list.rows[0].if_items.length > 0) {
          state.fullRulesCache = list.rows;
      } else {
          for(let i=0; i<total; i++) {
              if(i>0 && i%10===0) await sleep(2000); else await sleep(150);
              const res = await API.getDetail(list.rows[i].id);
              if(res.ok) state.fullRulesCache.push(res.data);
              out.innerHTML = `
	<div class="kcs_loader">
		<div style="font-weight:600;margin-bottom:8px;">
		Дождитесь окончания. Выгружено правил из контроллера: ${i+1}/${total}
	</div>
    <div style="color:#666;font-size:12px;max-width:520px;margin:0 auto 10px;line-height:1.35;">
      Не закрывайте вкладку и не нажимайте действия в списке, пока загрузка не завершится. Иначе увидите половину правил и будете потом удивляться.
    </div>
		<img src="${WAIT_IMG_URL}" alt="Please wait"
         style="width:200px;height:200px;object-fit:contain;display:block;margin:0 auto;">
	</div>`;
          }
      }
      renderRulesTable(out, wrap.querySelector("input[type=file]"));
  }

  function downloadRule(r) {
      // Single-rule export (with meta)
      const meta = {
          model: (state.lastSysInfo && state.lastSysInfo.model) ? String(state.lastSysInfo.model) : (window.location.host || "kincony"),
          firmware: (state.lastSysInfo && state.lastSysInfo.version) ? String(state.lastSysInfo.version) : "",
          diMax: CFG.diMax,
          doMax: CFG.doMax,
          exportedAt: new Date().toISOString(),
          kind: "single_rule"
      };
      const payload = { meta, rule: preparePayload(r) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = buildBackupFilename(meta, `rule_${r.id}`);
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function renderRulesTable(container, fileInput) {
      container.innerHTML = "";
      const rules = state.fullRulesCache.sort((a,b)=>a.id-b.id);
      const tbl = el("table", {class:"kcs_table"});
      tbl.appendChild(el("tr", {},
		el("th", {style:"width:36px;"} , "ID"),          // под 3 цифры
		el("th", {style:"width:160px;"} , "Имя"),        // влезет 15 символов
		el("th", {style:""} , "Логика"),                 // всё свободное место
		el("th", {style:"width:110px;"} , "Действия")    // 4 кнопки
	));


      rules.forEach(r => {
          const logic = el("div",{},""); 
          if(r.then_items) logic.innerHTML = describeRuleHtml(r);
          else logic.innerHTML = "<span class='kcs_badge danger'>Error</span>";
          const chk = el("input",{type:"checkbox", checked:!!r.enable, onchange:async(e)=>{
              r.enable = e.target.checked ? 1 : 0; await API.save(r); 
          }});
          const btnEdit = el("a", {href:`/ifttt_edit.html?id=${r.id}`, target:"_blank", class:"kcs_btn_sm", title:"Edit"}, "↗");
          const btnExp = el("button", {class:"kcs_btn_sm", title:"DL", onclick:()=>downloadRule(r)}, "⬇️");
          const btnImp = el("button", {class:"kcs_btn_sm", title:"Import", onclick:()=>{
              state.singleImportTargetId = r.id;
              if(fileInput) fileInput.click();
          }}, "⬆️");
          const actions = el("div", {class:"kcs_actions_cell"},
			el("label", {class:"kcs_chk"}, chk), // чекбокс слева
			btnEdit, btnExp, btnImp
		 );

			const row = el("tr", {style:r.enable?"":"opacity:0.6;background:#f8f8f8"},
			el("td",{},String(r.id)),
			el("td",{style:"font-size:11px"},r.name),
			el("td",{},logic),
			el("td", {class:"kcs_actions_td"}, actions)
			);

          tbl.appendChild(row);
      });
      container.appendChild(tbl);
  }

  function renderInfo() {
      const wrap = el("div", {class: "kcs_tab_content"});

      // Верхняя карточка: о расширении
      wrap.appendChild(el("div", {class: "kcs_card"},
          el("div", {class: "kcs_card_head"}, "Инфо"),
          el("div", {style: "display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"},
              el("div", {style:"min-width:240px"},
                  el("div", {style:"font-size:12px;color:#444;line-height:1.4"},
                      el("strong", {}, "KIM: KCS IFTTT Mass Mapper "), `(${CFG.ver})`
                  ),
                  el("div", {class:"kcs_help"},
                      "Альтернативный интерфейс для Kincony / ESP32: мониторинг входов/выходов, правила IFTTT, пресеты, импорт/экспорт."
                  )
              ),
              el("div", {style:"min-width:240px"},
                  el("div", {style:"font-size:12px;color:#444"},
                      el("strong", {}, "Secret-код: "),
                      el("span", {style:`font-weight:600;color:${CFG.secret ? "#0f5132" : "#856404"}`},
                          CFG.secret ? "установлен" : "не задан"
                      )
                  ),
                  el("div", {class:"kcs_help"},
                      "Нужен для быстрых HTTP-команд через /ctrl.cgi. Без него расширение чаще падает на WebSocket и становится задумчивым."
                  )
              )
          )
      ));

      // Двухколоночная сетка: слева системная инфа + инструменты, справа secret-настройки
      const grid = el("div", {class:"kcs_two_columns"});

      // Левая колонка
      const left = el("div", {class:"kcs_col"});

      const sysCard = el("div", {class: "kcs_card"});
      sysCard.appendChild(el("div", {class: "kcs_card_head"}, "Системная информация (контроллер)"));
      const contentDiv = el("div", {id: "kcs_sys_info", class: "kcs_loader"}, "Загрузка данных...");
      sysCard.appendChild(contentDiv);
      left.appendChild(sysCard);

      // Инструменты (то, что у тебя уже было)


      const btnRestart = el("button", {class:"kcs_btn danger", onclick:async()=>{
          if(confirm("Перезагрузить контроллер?")) {
              const r = await API.restart();
              alert(r && r.status==="success" ? "Контроллер перезагружается" : "Не получилось. Магия не сработала.");
          }
      }}, "Перезагрузить");

      const btnClearSecret = el("button", {class:"kcs_btn", onclick:()=>{
          if(confirm("Стереть сохранённый secret-код на этом ПК?")) {
              localStorage.removeItem("kcs_secret");
              CFG.secret = "";
              alert("Secret-код очищен. Открой Инфо заново, если хочешь автопоиск.");
          }
      }}, "Сбросить secret");



      // Правая колонка: secret-настройки
      const right = el("div", {class:"kcs_col"});
      const secretCard = el("div", {class:"kcs_card"});
      secretCard.appendChild(el("div", {class:"kcs_card_head"}, "Secret-код (HTTP Server)"));

      const secretInput = el("input", {
          class:"kcs_inp",
          type:"password",
          value: (CFG.secret || ""),
          placeholder: "Введите secret-код (или оставьте пустым)",
          style:"max-width:none"
      });

      const btnEye = el("button", {class:"kcs_btn", style:"padding:8px 10px", onclick:()=>{
          secretInput.type = (secretInput.type === "password") ? "text" : "password";
      }}, "👁");

      const btnTest = el("button", {class:"kcs_btn", onclick:async()=>{
          const s = (secretInput.value || "").trim();
          btnTest.textContent = "Проверяю…";
          btnTest.disabled = true;

          try{
              const testUrl = `${BASE}/ctrl.cgi?secret=${encodeURIComponent(s)}&cmd=get_inputs&id=0&value=0`;
              const res = await fetch(testUrl, {credentials:"include"});
              if(res.ok){
                  const txt = await res.text();
                  if(txt.includes('"inputs"') || txt.includes('"status":"success"')) {
                      alert("✅ Secret-код рабочий");
                  } else {
                      alert("❌ Похоже, secret неверный (или контроллер отвечает чем-то странным)");
                  }
              } else if(res.status === 403) {
                  alert("❌ 403 Forbidden: secret неверный или HTTP Server выключен");
              } else {
                  alert("❌ HTTP ошибка: " + res.status);
              }
          } catch(e){
              alert("❌ Ошибка сети: " + (e && e.message ? e.message : e));
          }

          btnTest.textContent = "Проверить";
          btnTest.disabled = false;
      }}, "Проверить");

      const btnSave = el("button", {class:"kcs_btn primary", onclick:()=>{
          const s = (secretInput.value || "").trim();
          CFG.secret = s;
          localStorage.setItem("kcs_secret", s);
          alert("Secret-код сохранён локально");
      }}, "Сохранить");

      secretCard.appendChild(el("div", {class:"kcs_help"},
          "Нужно включить HTTP Server в контроллере: Protocol → General → HTTP Server (ON), задать Secret-код и нажать Save. " +
          "Дальше расширение будет выполнять команды быстрее и стабильнее."
      ));

      secretCard.appendChild(el("div", {style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px"},
          secretInput, btnEye, btnTest, btnSave, btnClearSecret
      ));



      right.appendChild(secretCard);

      grid.appendChild(left);
      grid.appendChild(right);
      wrap.appendChild(grid);

      // Загрузка системной информации
      API.getSystemInfo().then(data => {
          const div = document.getElementById("kcs_sys_info");
          if (!div) return;

          if (!data || !data.model) {
              div.textContent = "Не удалось получить данные (/index).";
              div.className = "kcs_conflict_row";
              return;
          }

          const mkRow = (lbl, val) => el("tr", {},
              el("td", {style: "width:140px;color:#666;padding:5px 3px;border-bottom:1px solid #f0f0f0;font-size:12px"}, lbl),
              el("td", {style: "padding:5px 3px;border-bottom:1px solid #f0f0f0;font-weight:500;font-size:12px"}, String(val))
          );

          const tbl = el("table", {style: "width:100%;font-size:12px;border-collapse:collapse"});
          tbl.appendChild(mkRow("Модель", data.model));
          tbl.appendChild(mkRow("Прошивка", data.version));
          if(data.serial_number) tbl.appendChild(mkRow("Серийный №", data.serial_number));
          if(data.lan_ip) tbl.appendChild(mkRow("LAN IP", data.lan_ip));
          if(data.lan_mac) tbl.appendChild(mkRow("LAN MAC", data.lan_mac));
          if(data.wifi_ip) tbl.appendChild(mkRow("WiFi IP", data.wifi_ip));

          div.innerHTML = "";
          div.className = "";
          div.appendChild(tbl);
      });

      return wrap;
  }

  function renderImpExp(){
      const wrap = el("div",{class:"kcs_tab_content"});
      const logArea = el("pre",{class:"kcs_log_box", style:"height:170px"}, "Готов.");
      const setLog = (t) => { logArea.textContent = t + "\n" + logArea.textContent; };

      const doExport = async () => {
          setLog(">>> Экспорт: читаю правила...");
          const meta = await getControllerMeta();
          meta.extVer = CFG.ver;
          setLog(`Контроллер: ${meta.model} | DI=${meta.diMax} DO=${meta.doMax}`);

          const list = await API.list();
          if(!list.rows) { setLog("ERR: список пуст или не прочитался"); return; }

          const rules = [];
          for(let i=0; i<list.rows.length; i++){
              if(i>0 && i%20===0) await sleep(1000); else await sleep(60);
              const det = await API.getDetail(list.rows[i].id);
              if(det.ok) rules.push(preparePayload(det.data));
              setLog(`Exp ID ${list.rows[i].id} (${i+1}/${list.rows.length})`);
          }

          const payload = wrapBackup(meta, rules);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
          a.download = buildBackupFilename(meta, "allifttt_backup");
          a.click();
          setLog(`OK: сохранено правил: ${rules.length}`);
      };

      const fileIn = el("input", {type:"file", accept:".json", style:"display:block;margin-top:10px"});

      const doImport = async () => {
          const f = fileIn.files[0];
          if(!f) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
              try{
                  const parsed = parseBackupJson(e.target.result);
                  const current = await getControllerMeta();

                  setLog(`>>> Импорт: цель ${current.model} | DI=${current.diMax} DO=${current.doMax}`);
                  if(parsed.meta && (parsed.meta.model || parsed.meta.diMax || parsed.meta.doMax)) {
                      setLog(`Файл: ${parsed.meta.model || "??"} | DI=${parsed.meta.diMax || "?"} DO=${parsed.meta.doMax || "?"}`);
                  } else {
                      setLog("Файл: старый/без метаданных");
                  }

                  const rules = parsed.rules || [];
                  setLog(`Всего в файле: ${rules.length}`);

                  let disabledCount = 0;
                  let clippedMasksCount = 0;

                  for(let i=0; i<rules.length; i++){
                      const rawRule = rules[i];
                      const { rule: cleanRule, disabled, notes } = sanitizeRuleForController(rawRule, current.diMax, current.doMax);

                      if(disabled) disabledCount++;
                      if(notes && notes.some(n => (""+n).startsWith("THEN: обрезаны маски DO"))) clippedMasksCount++;

                      await API.save(cleanRule);

                      if(disabled && notes.length) setLog(`Imp ID ${cleanRule.id}: DISABLED (${notes.join("; ")})`);
                      else setLog(`Imp ID ${cleanRule.id}: OK`);

                      if(i>0 && i%10===0) await sleep(1200); else await sleep(220);
                  }

                  setLog(`Итог: OK ${rules.length - disabledCount}, DISABLED ${disabledCount}, маски DO обрезаны: ${clippedMasksCount}`);
alert("Импорт завершён");
              } catch(err){
                  alert("Не удалось импортировать: " + (err && err.message ? err.message : err));
                  setLog("ERR: " + (err && err.message ? err.message : err));
              }
          };
          reader.readAsText(f);
      };


      const doDeleteAllRules = async () => {
          const ok = confirm("Удалить ВСЕ правила IFTTT на контроллере?\nЭто нельзя отменить.");
          if(!ok) return;

          setLog(">>> Удаление всех правил: читаю список...");
          const list = await API.list();
          const rows = (list && list.rows) ? list.rows : [];
          if(!rows.length){
              setLog("Нечего удалять: список правил пуст.");
              alert("Правил нет. Удалять нечего.");
              return;
          }

          const ids = rows.map(r => r.id).filter(v => typeof v === "number" || /^\d+$/.test(String(v))).map(v => Number(v)).sort((a,b)=>a-b);
          setLog(`Найдено правил: ${ids.length}. Удаляю пачками по 50...`);

          let deleted = 0;
          const CH = 50;
          for(let i=0; i<ids.length; i+=CH){
              const chunk = ids.slice(i, i+CH);
              const res = await API.delete(chunk);
              deleted += chunk.length;

              if(res && res.ok){
                  setLog(`Del ${i+1}-${i+chunk.length}/${ids.length}: OK`);
              } else {
                  setLog(`Del ${i+1}-${i+chunk.length}/${ids.length}: ERR ${res && (res.msg||res.message||res.error||res.text||res.status) ? (res.msg||res.message||res.error||res.text||res.status) : ""}`);
              }

              // чуть притормозим, чтобы веб-морда и контроллер не начали дымиться
              await sleep(450);
          }

          setLog(`Готово. Запрошено к удалению: ${ids.length}.`);
          alert("Удаление завершено. Обнови страницу IFTTT, чтобы увидеть пустой список.");
      };


      wrap.appendChild(el("div", {class:"kcs_card"},
          el("div",{class:"kcs_card_head"},"Бэкап / Восстановление (IFTTT)"),
          el("div",{class:"kcs_help"},
              "Экспорт сохраняет все правила IFTTT + метаданные контроллера (модель, DI/DO). " +
              "Импорт перезаписывает правила с совпадающими ID. " +
              "Если в правилах есть DI/DO вне диапазона текущего контроллера, такие правила автоматически импортируются выключенными (enable=0), а маски выходов обрезаются."
          ),
          el("div",{class:"kcs_actions"},
              el("button", {class:"kcs_btn primary", onclick: doExport}, "Экспорт"),
			  el("button", {class:"kcs_btn danger", onclick: doDeleteAllRules}, "Удалить все правила"),
              el("button", {class:"kcs_btn", onclick: doImport}, "Импорт из файла"),
              
              fileIn
          ),
          logArea
      ));
      return wrap;
  }

  function renderLive(){
      const wrap=el("div",{class:"kcs_tab_content",style:"height:100%;display:flex;flex-direction:column;overflow:hidden"});
      const top=el("div",{class:"kcs_row",style:"flex:0 0 auto;border-bottom:1px solid #eee;padding-bottom:5px"},
          el("button",{class:"kcs_btn primary",onclick:()=>sendGlobalCmd(1)},"ВКЛ ВСЁ"),
          el("button",{class:"kcs_btn danger",onclick:()=>sendGlobalCmd(0)},"ВЫКЛ ВСЁ"),
		  el("div",{style:"margin-left:50px;color:#666;font-size:11px"}, "Состояние DI / DO отображается с небольшой задержкой. Приоритет у комманд переключения.")
      );
      const split=el("div",{style:"flex:1;display:flex;gap:15px;overflow:hidden"});
      const mkCol=(type)=>{
          const col=el("div",{style:"flex:1;display:flex;flex-direction:column;overflow:hidden"});
          col.appendChild(el("h4",{style:"margin:3px 0;text-align:center;background:#eee;padding:2px 0;font-size:12px;border-radius:4px"},type.toUpperCase()));
          const grid=el("div",{class:"kcs_monitor_grid",id:`kcs_grid_${type}`}); 
          for(let i=0;i<(type==='di'?CFG.diMax:CFG.doMax);i++)grid.appendChild(makeLiveCard(type,i));
          col.appendChild(grid); return col;
      }
      split.appendChild(mkCol('di')); split.appendChild(mkCol('do'));
      const bot=el("div",{id:"kcs_monitor_bottom",class:"kcs_monitor_bottom",style:"flex:0 0 auto;margin-top:4px;border-top:1px solid #eee;padding-top:4px"});
      const adcSec=el("div",{class:"kcs_mon_section"},
          el("div",{class:"kcs_mon_title",id:"kcs_adc_title"},"ADC"),
          el("div",{class:"kcs_mon_row",id:"kcs_adc_row"})
      );
      const dacSec=el("div",{class:"kcs_mon_section"},
          el("div",{class:"kcs_mon_title",id:"kcs_dac_title"},"DAC"),
          el("div",{class:"kcs_mon_row",id:"kcs_dac_row"})
      );
      const senSec=el("div",{class:"kcs_mon_section"},
          el("div",{class:"kcs_mon_titlebar"},
              el("div",{class:"kcs_mon_title",id:"kcs_sensor_title"},"Sensors"),
              el("button",{class:"kcs_btn",style:"padding:4px 10px;font-size:12px",onclick:()=>showSensorModal(true)},"Все")
          ),
          el("div",{class:"kcs_sensor_preview",id:"kcs_sensor_preview"})
      );

      const senModal=el("div",{id:"kcs_sensor_modal",class:"kcs_modal_overlay",style:"display:none"},
          el("div",{class:"kcs_modal_card"},
              el("div",{class:"kcs_modal_head"},
                  el("div",{class:"kcs_modal_title",id:"kcs_sensor_modal_title"},"Sensors"),
                  el("button",{class:"kcs_btn",style:"padding:4px 10px;font-size:12px",onclick:()=>showSensorModal(false)},"Закрыть")
              ),
              el("div",{class:"kcs_modal_body"},
                  el("div",{class:"kcs_sensor_grid kcs_sensor_grid_full",id:"kcs_sensor_grid_full"})
              )
          )
      );
      senModal.addEventListener("click",(e)=>{ if(e.target===senModal) showSensorModal(false); });

      const analogBar=el("div",{class:"kcs_mon_analog_bar"},adcSec,dacSec);
      bot.appendChild(analogBar); bot.appendChild(senSec);
      wrap.appendChild(top); wrap.appendChild(split); wrap.appendChild(bot); wrap.appendChild(senModal);

      if(!state.__sensorModalKeyListener){
          state.__sensorModalKeyListener = true;
          document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") showSensorModal(false); });
      }

      rebuildMonitorBottom();
      setTimeout(refreshNames, 100);
      return wrap;
  }
  
  
  function showSensorModal(show){
      const m = document.getElementById("kcs_sensor_modal");
      if(!m) return;
      m.style.display = show ? "flex" : "none";
  }

const state = { ws: null, wsConnected: false, di: [], do: [], adcs: [], dacs: [], sensors: [], diNames: [], doNames: [], adcMeta: [], dacMeta: [], sensorMeta: [], fullRulesCache: [], pollTimer: null, singleImportTargetId: null, lastSysInfo: null, pendingDo: [], pendingDoValue: [], pendingDoTimer: [], wsInFlight: false, wsInFlightAt: 0 };
  for(let i=0; i<128; i++) { state.diNames.push(""); state.doNames.push(""); }
  function updateConnStatus() { const b=document.getElementById("kcs_ws_badge"); if(b) b.className = state.wsConnected ? "kcs_ws_status on" : "kcs_ws_status warn"; if(b) b.textContent = state.wsConnected?"WS":"HTTP"; }

  async function refreshNames() {
  const res = await API.getNames();
  if (!res) return;

  if (res.input_num !== undefined) CFG.diMax = parseInt(res.input_num, 10) || CFG.diMax;
  if (res.output_num !== undefined) CFG.doMax = parseInt(res.output_num, 10) || CFG.doMax;

  if (res.adc_num !== undefined) CFG.adcMax = parseInt(res.adc_num, 10) || CFG.adcMax;
  if (res.dac_num !== undefined) CFG.dacMax = parseInt(res.dac_num, 10) || 0;
  if (res.sensor_num !== undefined) CFG.sensorMax = parseInt(res.sensor_num, 10) || 0;

  // Some firmwares prefer arrays length
  if (Array.isArray(res.adcs) && res.adcs.length) CFG.adcMax = res.adcs.length;
  if (Array.isArray(res.dacs) && res.dacs.length) CFG.dacMax = res.dacs.length;
  if (Array.isArray(res.sensors) && res.sensors.length) CFG.sensorMax = res.sensors.length;

  const applyNames = (src, dst) => {
    if (!Array.isArray(src)) return;

    // KCS v2: массив строк
    if (src.length === 0 || typeof src[0] === "string") {
      src.forEach((name, idx) => { dst[idx] = (name || "").toString(); });
      return;
    }

    // KCS v3: массив объектов {id, name}
    src.forEach((it, idx) => {
      if (!it || typeof it !== "object") return;
      const id = parseInt(it.id ?? it.num ?? (idx + 1), 10);
      const name = (it.name ?? "").toString();
      if (!name) return;
      if (!Number.isNaN(id) && id >= 1) dst[id - 1] = name;
    });
  };

  const buildMeta = (src, max) => {
    const out = new Array(max || 0).fill(null);
    if (!Array.isArray(src) || !src.length || typeof src[0] !== "object") return out;
    src.forEach((it, idx) => {
      if (!it || typeof it !== "object") return;
      const id = parseInt(it.id ?? it.num ?? (idx + 1), 10);
      if (Number.isNaN(id) || id < 1 || id > out.length) return;
      out[id - 1] = {
        name: (it.name ?? "").toString(),
        unit: it.unit ?? "",
        type: it.type ?? undefined,
        min: it.min ?? undefined,
        max: it.max ?? undefined,
        threshold: it.threshold ?? undefined,
        default_max_value: it.default_max_value ?? undefined
      };
    });
    return out;
  };

  applyNames(res.inputs, state.diNames);
  applyNames(res.outputs, state.doNames);

  state.adcMeta = buildMeta(res.adcs, CFG.adcMax);
  state.dacMeta = buildMeta(res.dacs, CFG.dacMax);
  state.sensorMeta = buildMeta(res.sensors, CFG.sensorMax);

  updateUiNames();
  triggerAllNamePreviews();

  // If counts changed, rebuild grids + bottom widgets
  reRenderGrids();
  rebuildMonitorBottom();
}

  const SENSOR_UNIT_MAP = {
    0: "",
    1: "°C",
    2: "%RH",
    3: "ppm",
    4: "lux",
    5: "V",
    6: "A",
    7: "W",
    8: "kWh",
    9: "Pa",
    10: "kPa"
  };

  function sensorUnitText(u) {
    if (u === undefined || u === null) return "";
    if (typeof u === "string") return u.trim();
    const n = parseInt(u, 10);
    if (Number.isNaN(n) || n === 0) return "";
    return SENSOR_UNIT_MAP[n] || String(n);
  }

  function extractValue(it) {
    if (it === null || it === undefined) return "";
    if (typeof it === "number" || typeof it === "string" || typeof it === "boolean") return it;

    if (typeof it === "object") {
      if (it.value !== undefined) return it.value;
      if (it.val !== undefined) return it.val;
      if (it.v !== undefined) return it.v;

      const t = it.temperature ?? it.temp ?? it.t;
      const h = it.humidity ?? it.hum ?? it.rh ?? it.h;
      if (t !== undefined && h !== undefined) return `${t}°C ${h}%`;
      if (t !== undefined) return `${t}°C`;
      if (h !== undefined) return `${h}%`;

      // last resort: compact JSON
      try {
        const s = JSON.stringify(it);
        return s.length > 60 ? s.slice(0, 57) + "..." : s;
      } catch (_) { return ""; }
    }

    return String(it);
  }

  function normalizeIdValueArray(arr, maxCount) {
    if (!Array.isArray(arr)) return [];
    const max = (maxCount && maxCount > 0) ? maxCount : arr.length;
    const hasId = arr.some(it => it && typeof it === "object" && (it.id !== undefined || it.num !== undefined));
    if (!hasId) return arr.map(extractValue);

    const out = new Array(max).fill("");
    arr.forEach((it, idx) => {
      if (!it || typeof it !== "object") {
        if (idx < out.length) out[idx] = extractValue(it);
        return;
      }
      const id = parseInt(it.id ?? it.num ?? (idx + 1), 10);
      if (Number.isNaN(id) || id < 1 || id > out.length) return;
      out[id - 1] = extractValue(it);
    });
    return out;
  }

  function rebuildMonitorBottom() {
    const bottom = document.getElementById("kcs_monitor_bottom");
    if (!bottom) return;

    const adcTitle = document.getElementById("kcs_adc_title");
    const dacTitle = document.getElementById("kcs_dac_title");
    const senTitle = document.getElementById("kcs_sensor_title");
    const senModalTitle = document.getElementById("kcs_sensor_modal_title");

    if (adcTitle) adcTitle.textContent = `ADC (${CFG.adcMax || 0})`;
    if (dacTitle) dacTitle.textContent = `DAC (${CFG.dacMax || 0})`;

    const senCount = (CFG.sensorMax || 0);
    if (senTitle) senTitle.textContent = `Sensors (${senCount})`;
    if (senModalTitle) senModalTitle.textContent = `Sensors (${senCount})`;

    const adcRow = document.getElementById("kcs_adc_row");
    if (adcRow) {
      adcRow.innerHTML = "";
      for (let i = 0; i < (CFG.adcMax || 0); i++) {
        const meta = state.adcMeta && state.adcMeta[i] ? state.adcMeta[i] : null;
        const nm = (meta && meta.name) ? meta.name : `ADC${i + 1}`;
        const unit = (meta && meta.unit) ? String(meta.unit) : "";
        adcRow.appendChild(
          el("div", { class: "kcs_adc_chip", title: nm || "" },
            el("span", { class: "kcs_chip_label" }, (nm || `ADC${i + 1}`) + ":"),
            el("span", { class: "kcs_adc_val", "data-idx": i }, "—"),
            unit ? el("span", { class: "kcs_chip_unit" }, unit) : null
          )
        );
      }
    }

    const dacSec = document.getElementById("kcs_dac_row") ? document.getElementById("kcs_dac_row").parentElement : null;
    const dacRow = document.getElementById("kcs_dac_row");
    if (dacSec) dacSec.style.display = (CFG.dacMax || 0) > 0 ? "" : "none";
    if (dacRow) {
      dacRow.innerHTML = "";
      for (let i = 0; i < (CFG.dacMax || 0); i++) {
        const meta = state.dacMeta && state.dacMeta[i] ? state.dacMeta[i] : null;
        const nm = (meta && meta.name) ? meta.name : `DAC${i + 1}`;
        const unit = (meta && meta.unit) ? String(meta.unit) : "";
        dacRow.appendChild(
          el("div", { class: "kcs_adc_chip", title: nm || "" },
            el("span", { class: "kcs_chip_label" }, (nm || `DAC${i + 1}`) + ":"),
            el("span", { class: "kcs_dac_val", "data-idx": i }, "—"),
            unit ? el("span", { class: "kcs_chip_unit" }, unit) : null
          )
        );
      }
    }

    const sensorSec = document.getElementById("kcs_sensor_preview") ? document.getElementById("kcs_sensor_preview").parentElement : null;
    if (sensorSec) sensorSec.style.display = senCount > 0 ? "" : "none";

    // ---- Preview (up to 5 sensors, prioritize named ones)
    const previewGrid = document.getElementById("kcs_sensor_preview");
    if (previewGrid) {
      previewGrid.innerHTML = "";
      const idxs = [];
      for (let i = 0; i < senCount; i++) {
        const meta = state.sensorMeta && state.sensorMeta[i] ? state.sensorMeta[i] : null;
        const name = (meta && meta.name) ? String(meta.name).trim() : "";
        idxs.push({ i, pr: name ? 0 : 1 });
      }
      idxs.sort((a, b) => (a.pr - b.pr) || (a.i - b.i));
      const maxPreview = 5;
      const use = idxs.slice(0, Math.min(maxPreview, idxs.length)).map(x => x.i);

      use.forEach((i) => {
        const meta = state.sensorMeta && state.sensorMeta[i] ? state.sensorMeta[i] : null;
        const name = (meta && meta.name) ? meta.name : "";
        const unitText = sensorUnitText(meta && meta.unit);

        previewGrid.appendChild(
          el("div", { class: "kcs_sensor_card", title: name || `Sensor ${i + 1}` },
            el("div", { class: "kcs_sensor_head" },
              el("span", { class: "kcs_sensor_idx" }, `S${i + 1}`),
              el("span", { class: "kcs_sensor_name" }, name)
            ),
            el("div", { class: "kcs_sensor_value_row" },
              el("span", { class: "kcs_sensor_val", "data-idx": i }, "—"),
              unitText ? el("span", { class: "kcs_sensor_unit" }, unitText) : null
            )
          )
        );
      });
    }

    // ---- Full list (modal)
    const fullGrid = document.getElementById("kcs_sensor_grid_full");
    if (fullGrid) {
      fullGrid.innerHTML = "";
      for (let i = 0; i < senCount; i++) {
        const meta = state.sensorMeta && state.sensorMeta[i] ? state.sensorMeta[i] : null;
        const name = (meta && meta.name) ? meta.name : "";
        const unitText = sensorUnitText(meta && meta.unit);

        fullGrid.appendChild(
          el("div", { class: "kcs_sensor_card", title: name || `Sensor ${i + 1}` },
            el("div", { class: "kcs_sensor_head" },
              el("span", { class: "kcs_sensor_idx" }, `S${i + 1}`),
              el("span", { class: "kcs_sensor_name" }, name)
            ),
            el("div", { class: "kcs_sensor_value_row" },
              el("span", { class: "kcs_sensor_val", "data-idx": i }, "—"),
              unitText ? el("span", { class: "kcs_sensor_unit" }, unitText) : null
            )
          )
        );
      }
    }

    updateUiState();
  }

function startAdaptivePolling() {
      // Сбрасываем текущий таймер, чтобы не наслоились два цикла
      if(state.pollTimer) clearTimeout(state.pollTimer);

      const loop = async () => {
          // Если вкладка не активна — замедляемся до 2 сек, экономим ресурсы
          if(document.hidden) { 
              state.pollTimer = setTimeout(loop, 2000); 
              return; 
          }

          // Если WS активен
          if(state.wsConnected && state.ws.readyState === WebSocket.OPEN) {
              updateConnStatus(); const now=Date.now(); if(!state.wsInFlight || (now-(state.wsInFlightAt||0)>1500)){state.wsInFlight=true; state.wsInFlightAt=now; state.ws.send(JSON.stringify({cmd: "get all datas"}));} state.pollTimer = setTimeout(loop, CFG.pollIntervalWs);
          } else {
              // Если WS отвалился, работаем через HTTP, но редко
              try {
                  const d = await API.getAllDatas();
                  const applied = d ? handleDataPacket(d, {source:"http"}) : false;

                  // Некоторые прошивки (или настройки) любят отдать "пусто" на get_all_datas.
                  // Тогда добираем частями: inputs/outputs/adcs/dacs.
                  if(!applied) {
                      const [ri, ro, ra, rd] = await Promise.allSettled([
                          API.getInputs(),
                          API.getOutputs(),
                          API.getAdcs(),
                          API.getDacs()
                      ]);
                      if(ro.status === "fulfilled" && ro.value) handleDataPacket(ro.value, {source:"http"});
                      if(ri.status === "fulfilled" && ri.value) handleDataPacket(ri.value, {source:"http"});
                      if(ra.status === "fulfilled" && ra.value) handleDataPacket(ra.value, {source:"http"});
                      if(rd.status === "fulfilled" && rd.value) handleDataPacket(rd.value, {source:"http"});
                  }
              } catch(e) {}
              
              updateConnStatus(); 
              state.pollTimer = setTimeout(loop, CFG.pollIntervalHttp);
          }
      };
      loop();
  }

  function wsConnect(){
      if(state.ws && state.ws.readyState <= 1) return;
      state.ws = new WebSocket(WS_URL);
      state.ws.onopen = () => { state.wsConnected = true; updateConnStatus(); state.ws.send(JSON.stringify({cmd:"get all datas"})); };
      state.ws.onmessage = (e) => { try { handleDataPacket(JSON.parse(e.data)); } catch(e){} };
      state.ws.onclose = () => { state.wsConnected = false; updateConnStatus(); setTimeout(wsConnect, CFG.wsReconnectDelay); };
  }

  
  function hexToBitArray(hex) {
      const s = String(hex || "").trim();
      if(!s) return null;
      if(!/^[0-9a-fA-F]+$/.test(s)) return null;
      if(s.length % 2 !== 0) return null;

      const bytes = [];
      for(let i=s.length; i>0; i-=2) {
          const b = parseInt(s.slice(i-2, i), 16);
          if(Number.isNaN(b)) return null;
          bytes.push(b); // right-to-left: D0, D1, ...
      }
      const out = [];
      for(const b of bytes) {
          for(let bit=0; bit<8; bit++) out.push((b >> bit) & 1);
      }
      return out;
  }

  function coerceBitArray(v) {
      if(v === null || v === undefined) return null;

      if(Array.isArray(v)) {
          return v.map(x => (parseInt(x, 10) ? 1 : 0));
      }

      if(typeof v === "string") {
          const s0 = v.trim();
          if(!s0) return null;

          // maybe JSON encoded
          if(s0[0] === "[" || s0[0] === "{") {
              try {
                  const j = JSON.parse(s0);
                  if(Array.isArray(j)) return j.map(x => (parseInt(x,10) ? 1 : 0));
              } catch(_) {}
          }

          // comma-separated
          if(s0.includes(",")) {
              const parts = s0.split(",").map(t => t.trim()).filter(Boolean);
              if(parts.length) return parts.map(x => (parseInt(x,10) ? 1 : 0));
          }

          // pure binary string: "010101"
          if(/^[01]+$/.test(s0)) return s0.split("").map(ch => ch === "1" ? 1 : 0);

          // hex string used by some endpoints / firmwares
          const hexArr = hexToBitArray(s0);
          if(hexArr && hexArr.length) return hexArr;
      }

      return null;
  }

  function handleDataPacket(d, opt = {}) {
      if(!d) return false;

      // ACK/ответы на команды по WS (как в штатном мониторе)
      if(d.cmd) {
          const c = String(d.cmd).toLowerCase();
          if(c === "set output" && d.id !== undefined) {
              const id = parseInt(d.id, 10);
              const val = parseInt(d.value, 10) ? 1 : 0;
              if(!Number.isNaN(id)) {
                  state.do[id] = val;
                  state.pendingDo[id] = false;
                  state.pendingDoValue[id] = undefined;
                  if(state.pendingDoTimer[id]) { clearTimeout(state.pendingDoTimer[id]); state.pendingDoTimer[id] = null; }
                  updateUiState();
              }
              return true;
          }
      }

      // Snapshot пакет: снимаем "in-flight" (чтобы не заспамить WS запросами)
      state.wsInFlight = false;

      let updated = false;

      // ---- DI/DO ----
      const diRaw = (d.inputs !== undefined ? d.inputs : (d.input !== undefined ? d.input : (d.di !== undefined ? d.di : null)));
      const doRaw = (d.outputs !== undefined ? d.outputs : (d.output !== undefined ? d.output : (d.do !== undefined ? d.do : null)));

      const diArr = coerceBitArray(diRaw);
      if(diArr && diArr.length) {
          state.di = diArr.map(x => x ? 1 : 0);
          updated = true;
      }

      const doArr = coerceBitArray(doRaw);
      if(doArr && doArr.length) {
          state.do = doArr.map(x => x ? 1 : 0);
          updated = true;

          // если ждали конкретное значение, снимем pending только когда увидим его
          for(let i=0;i<state.do.length;i++){
              if(state.pendingDo[i] && state.pendingDoValue[i] !== undefined && state.do[i] === state.pendingDoValue[i]) {
                  state.pendingDo[i] = false;
                  state.pendingDoValue[i] = undefined;
                  if(state.pendingDoTimer[i]) { clearTimeout(state.pendingDoTimer[i]); state.pendingDoTimer[i] = null; }
              }
          }
      }

      // ---- ADC/DAC/Sensors ----
      if(Array.isArray(d.adcs)) { state.adcs = normalizeIdValueArray(d.adcs, CFG.adcMax || d.adcs.length); updated = true; }
      else if(Array.isArray(d.adc)) { state.adcs = normalizeIdValueArray(d.adc, CFG.adcMax || d.adc.length); updated = true; }

      if(Array.isArray(d.dacs)) { state.dacs = normalizeIdValueArray(d.dacs, CFG.dacMax || d.dacs.length); updated = true; }
      else if(Array.isArray(d.dac)) { state.dacs = normalizeIdValueArray(d.dac, CFG.dacMax || d.dac.length); updated = true; }

      if(Array.isArray(d.sensors)) { state.sensors = normalizeIdValueArray(d.sensors, CFG.sensorMax || d.sensors.length); updated = true; }
      else if(Array.isArray(d.sensor)) { state.sensors = normalizeIdValueArray(d.sensor, CFG.sensorMax || d.sensor.length); updated = true; }
      else if(Array.isArray(d.sensor_values)) { state.sensors = normalizeIdValueArray(d.sensor_values, CFG.sensorMax || d.sensor_values.length); updated = true; }

      if(updated) reRenderGrids();
      else updateUiState(); // хотя бы pending/таймеры отрисуем
      return updated;
  }




// Найдите переменную state и добавьте туда поле cmdLock: false
  // Но проще просто использовать глобальный флаг внутри функции, как ниже:

  let _cmdLockTimer = null;

  function toggleDo(i) {
      // Команду отправляем сразу, но UI не "угадывает" состояние (иначе мерцание и рассинхрон).
      const newVal = state.do[i] ? 0 : 1;

      // помечаем как "в работе"
      state.pendingDo[i] = true;
      state.pendingDoValue[i] = newVal;
      if(state.pendingDoTimer[i]) { clearTimeout(state.pendingDoTimer[i]); state.pendingDoTimer[i] = null; }
      // страховка: если ничего не пришло, снимем pending через 2с
      state.pendingDoTimer[i] = setTimeout(() => {
          state.pendingDo[i] = false;
          state.pendingDoValue[i] = undefined;
          updateUiState();
      }, 2000);
      updateUiState();

      // БЛОКИРУЕМ ОПРОС (мониторинг), чтобы не мешать команде
      if(state.pollTimer) clearTimeout(state.pollTimer);
      if(_cmdLockTimer) clearTimeout(_cmdLockTimer);

      // Возобновим опрос только через 600мс после последней команды
      _cmdLockTimer = setTimeout(() => {
          startAdaptivePolling();
      }, 600);

      // Отправляем команду
      if(state.wsConnected && state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({cmd:"set output", id:i, value:newVal}));
          // Подтолкнем обновление состояния (если контроллер не шлет ACK стабильно)
          setTimeout(() => {
              try {
                  if(state.wsConnected && state.ws && state.ws.readyState === WebSocket.OPEN) {
                      state.wsInFlight = false; // разрешаем следующий запрос
                      state.ws.send(JSON.stringify({cmd:"get all datas"}));
                  }
              } catch(e) {}
          }, 200);
      } else {
          // HTTP (резерв). Важно: id тут 1-based (как в ctrl.cgi протоколе).
          API.setOutput(i+1, newVal);
      }
  }

  function sendGlobalCmd(val) { 
      if(state.wsConnected) state.ws.send(JSON.stringify({cmd:"set all outputs",value:val})); 
      else API.setAllOutputs(val); 
  }
  async function handleSingleImport(e, wrap) {
      const f = e && e.target && e.target.files ? e.target.files[0] : null;
      if(!f) return;

      // allow selecting same file twice
      try { e.target.value = ""; } catch(_) {}

      const targetId = state.singleImportTargetId;
      state.singleImportTargetId = null;
      if(!targetId) { alert("Не выбран ID для импорта"); return; }

      const ok = confirm(`Импортировать правило из файла и ЗАМЕНИТЬ правило ID ${targetId}?`);
      if(!ok) return;

      const txt = await f.text();
      let parsed;
      try { parsed = parseBackupJson(txt); } catch(err) { alert("Непонятный JSON: " + (err && err.message ? err.message : err)); return; }
      const ruleFromFile = parsed.rules && parsed.rules[0] ? parsed.rules[0] : null;
      if(!ruleFromFile) { alert("В файле нет правила"); return; }

      // Force the chosen target ID (since user clicked a row)
      ruleFromFile.id = parseInt(targetId);

      const current = await getControllerMeta();
      const { rule: cleanRule, disabled, notes } = sanitizeRuleForController(ruleFromFile, current.diMax, current.doMax);

      const res = await API.save(cleanRule);
      if(res && res.ok) {
          let msg = `Готово: ID ${cleanRule.id} импортировано.`;
          if(disabled) msg += `
(Правило выключено: ${notes.join("; ")})`;
          alert(msg);
          // refresh list
          runScanner(wrap);
      } else {
          alert("Не удалось сохранить правило (API.save вернул ошибку).");
      }
  }

  function reRenderGrids(){
      const d1=document.getElementById("kcs_grid_di"), d2=document.getElementById("kcs_grid_do");
      if(d1){
          if(d1.childElementCount !== CFG.diMax){
              d1.innerHTML="";
              for(let i=0;i<CFG.diMax;i++)d1.appendChild(makeLiveCard('di',i));
          }
      }
      if(d2){
          if(d2.childElementCount !== CFG.doMax){
              d2.innerHTML="";
              for(let i=0;i<CFG.doMax;i++)d2.appendChild(makeLiveCard('do',i));
          }
      }
      updateUiState();
  }


  function makeLiveCard(t,i){
      const getName=()=> (t==='di'?state.diNames[i]:state.doNames[i])||"";
      const nb=el("div",{class:"kcs_card_name"},getName()||"..."); 
      const rename=async e=>{ if(e){e.preventDefault(); e.stopPropagation();} const cur=getName(); const n=prompt("Name:",cur); if(n!==null){await API.setName(t==='di'?'input':'output',i,n); refreshNames();}};
      nb.onclick=rename;
      const nm=getName();
      const act = (t==='di'?state.di[i]:state.do[i]) ? "active" : "";
      return el("div",{class:`kcs_live_card ${act}`,"data-type":t,"data-idx":i,title:nm?`${t.toUpperCase()} ${i+1}: ${nm}`:`${t.toUpperCase()} ${i+1}`,onclick:t==='do'?()=>{if(state.pendingDo&&state.pendingDo[i])return;toggleDo(i)}:null,oncontextmenu:rename}, el("div",{class:"kcs_card_idx"},`${t.toUpperCase()}${i+1}`), nb);
  }

  function updateUiState(){
      document.querySelectorAll(".kcs_live_card").forEach(c=>{
          const t=c.dataset.type, i=parseInt(c.dataset.idx,10), a=t==='di'?state.di:state.do;
          if(a[i]) c.classList.add("active"); else c.classList.remove("active"); if(t==="do" && state.pendingDo && state.pendingDo[i]) c.classList.add("pending"); else c.classList.remove("pending");
      });

      document.querySelectorAll(".kcs_adc_val").forEach(s=>{
          const i=parseInt(s.dataset.idx,10);
          const v = (state.adcs && state.adcs[i] !== undefined) ? state.adcs[i] : "";
          s.textContent = (v === "" || v === null || v === undefined) ? "—" : String(v);
      });

      document.querySelectorAll(".kcs_dac_val").forEach(s=>{
          const i=parseInt(s.dataset.idx,10);
          const v = (state.dacs && state.dacs[i] !== undefined) ? state.dacs[i] : "";
          s.textContent = (v === "" || v === null || v === undefined) ? "—" : String(v);
      });

      document.querySelectorAll(".kcs_sensor_val").forEach(s=>{
          const i=parseInt(s.dataset.idx,10);
          const v = (state.sensors && state.sensors[i] !== undefined) ? state.sensors[i] : "";
          s.textContent = (v === "" || v === null || v === undefined) ? "—" : String(v);
      });
  }

  function updateUiNames(){
      document.querySelectorAll(".kcs_card_name").forEach(s=>{
          const p=s.parentElement,t=p.dataset.type,i=parseInt(p.dataset.idx,10);
          const name=(t==='di'?state.diNames[i]:state.doNames[i])||"";
          s.textContent=name||"...";
          p.title = name ? `${t.toUpperCase()} ${i+1}: ${name}` : `${t.toUpperCase()} ${i+1}`;
      });
  }

  function init() {
      // 100% ORIGINAL STYLES
      const css = `#kcs_pnl{position:fixed;top:20px;right:20px;width:960px;height:700px;max-width:98vw;max-height:95vh;background:#fff;border:1px solid #ccc;box-shadow:0 15px 50px rgba(0,0,0,0.3);z-index:99999;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;border-radius:8px;font-size:13px;color:#333}#kcs_head{background:#f1f3f5;padding:8px 15px;font-weight:600;cursor:move;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dee2e6;select:none}#kcs_min{position:fixed;bottom:20px;right:20px;width:64px;height:64px;background:#fff;border:1px solid #ccc;border-radius:50%;box-shadow:0 4px 15px rgba(0,0,0,0.2);cursor:pointer;display:flex;justify-content:center;align-items:center;z-index:99999;overflow:hidden;padding:8px}#kcs_min img{width:100%;height:100%;object-fit:contain}#kcs_tabs{display:flex;background:#fff;border-bottom:1px solid #eee}.kcs_tab{flex:1;text-align:center;padding:10px;cursor:pointer;border-bottom:3px solid transparent;color:#666;transition:0.2s;font-size:14px}.kcs_tab:hover{background:#f8f9fa;color:#000}.kcs_tab.active{border-bottom:3px solid #0d6efd;color:#0d6efd;font-weight:600;background:#f1f8ff}#kcs_body{flex:1;overflow:hidden;background:#fafafa;padding:0;position:relative;display:flex;flex-direction:column;transition:opacity 0.2s}.kcs_tab_content{padding:15px;overflow:auto;flex:1}.kcs_card{background:#fff;border:1px solid #eee;border-radius:6px;padding:15px;margin-bottom:15px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}.kcs_card_head{font-weight:600;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #eee;font-size:14px}.kcs_row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.kcs_inp{width:70px;padding:5px;border:1px solid #ced4da;border-radius:4px}.kcs_inp_sm{width:100%;padding:3px;margin-left: 10px;border:1px solid #ddd;border-radius:3px;font-size:12px}.kcs_btn{padding:8px 14px;background:#e9ecef;border:none;border-radius:4px;cursor:pointer;font-weight:500;transition:0.2s}.kcs_btn:hover{background:#dee2e6}.kcs_btn.primary{background:#0d6efd;color:#fff}.kcs_btn.primary:hover{background:#0b5ed7}.kcs_btn.danger{background:#dc3545;color:#fff}.kcs_log_box{height:120px;overflow:auto;background:#212529;color:#0f0;padding:10px;border-radius:4px;font-family:monospace;font-size:11px;margin-top:10px;white-space:pre-wrap}.kcs_monitor_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:4px;grid-auto-rows:24px;overflow-y:auto;padding-right:3px;align-content:start;flex:1}.kcs_monitor_bottom{display:block}.kcs_mon_section{margin-top:6px}.kcs_mon_title{font-size:11px;color:#6c757d;margin:0 0 4px;font-weight:600}.kcs_mon_row{display:flex;flex-wrap:wrap;gap:8px;font-family:monospace;font-size:12px}.kcs_adc_chip{background:#f8f9fa;border:1px solid #ddd;padding:2px 6px;border-radius:8px;display:flex;gap:6px;align-items:baseline;min-height:22px}.kcs_chip_label{color:#495057;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kcs_chip_unit{color:#6c757d;font-size:11px}.kcs_sensor_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;max-height:170px;overflow:auto;padding-right:4px}.kcs_sensor_card{background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:6px 8px;display:flex;flex-direction:column;gap:4px}.kcs_sensor_head{display:flex;justify-content:space-between;gap:8px;align-items:center}.kcs_sensor_idx{font-family:monospace;font-size:11px;color:#6c757d;white-space:nowrap}.kcs_sensor_name{font-size:11px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:right}.kcs_sensor_value_row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-family:monospace;font-size:13px;font-weight:600}.kcs_sensor_unit{font-size:11px;color:#6c757d;font-weight:500}.kcs_live_card{background:#fff;border:1px solid #dee2e6;border-radius:4px;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;min-height:36px;font-size:12px;transition:0.1s;cursor:default;min-width:0}.kcs_live_card[data-type="do"]{cursor:pointer}.kcs_live_card[data-type="do"]:hover{border-color:#999}.kcs_live_card.active{background:#d1e7dd;border-color:#badbcc}.kcs_live_card.active .kcs_card_idx{color:#0f5132;font-weight:bold}.kcs_live_card.pending{opacity:.65;border-style:dashed}.kcs_card_idx{color:#6c757d;font-weight:500;margin-right:5px;white-space:nowrap}.kcs_card_name{color:#333;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;text-align:right;font-size:11px;min-width:0;flex:1}.kcs_card_name:hover{text-decoration:underline}.kcs_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(50px,1fr));gap:5px}.kcs_bar{height:5px;background:#eee;margin:10px 0;border-radius:3px;overflow:hidden}.kcs_bar_inner{height:100%;background:#0d6efd;width:0;transition:width 0.2s}.kcs_table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}.kcs_table td,.kcs_table th{padding:5px;border-bottom:1px solid #eee}.kcs_table th{background:#f8f9fa;text-align:left}.kcs_section{margin-bottom:15px;border:1px solid #eee;padding:10px;border-radius:4px;background:#fdfdfd}.kcs_h3{margin:15px 0 5px;font-size:14px;border-bottom:2px solid #eee;padding-bottom:5px;font-weight:bold}.kcs_btn_sm{padding:2px 6px;font-size:11px;border-radius:3px;border:1px solid #ccc;cursor:pointer;text-decoration:none;display:inline-block;color:#333}.kcs_btn_sm:hover{background:#eee}.kcs_btn_sm.primary{color:#09c}.kcs_btn_sm.danger{color:red}.kcs_loader{padding:20px;text-align:center;color:#666;font-style:italic}.kcs_empty{padding:20px;text-align:center;color:#999}.kcs_badge{padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;display:inline-block}.kcs_badge.if{background:#e7f5ff;color:#0c8599;border:1px solid #a5d8ff}.kcs_badge.on{background:#d3f9d8;color:#2b8a3e;border:1px solid #b2f2bb}.kcs_badge.off{background:#ffe3e3;color:#c92a2a;border:1px solid #ffc9c9}.kcs_badge.tog{background:#fff3bf;color:#e67700;border:1px solid #fcc419}.kcs_badge.gray{background:#f1f3f5;color:#495057;border:1px solid #dee2e6}.kcs_badge.danger{background:red;color:#fff}.kcs_badge.delay{background:#fff9db;color:#e67700;border:1px solid #ffec99}.kcs_badge.action{background:#f8f9fa;border:1px solid #ddd;font-family:monospace}.kcs_t_on{color:#2b8a3e;font-weight:bold}.kcs_t_off{color:#c92a2a}.kcs_t_tog{color:#e67700}.kcs_conflict_row{background:#fff0f0;border-left:4px solid red;padding:5px;margin-bottom:5px;font-size:12px}.kcs_ok{padding:10px;background:#ebfbee;color:#2b8a3e;text-align:center;border-radius:4px} .kcs_ws_status{font-size:11px;padding:2px 6px;border-radius:4px;margin-right:10px;transition:0.3s} .kcs_ws_status.on{background:#d1e7dd;color:#0f5132} .kcs_ws_status.warn{background:#fff3cd;color:#856404} .kcs_ws_status.off{background:#f8d7da;color:#842029}
/* === UI polish / form system === */
:root{
  --kcs-gap-1: 6px;
  --kcs-gap-2: 10px;
  --kcs-gap-3: 14px;
  --kcs-radius: 10px;
  --kcs-border: #e9ecef;
  --kcs-subtext: #6c757d;
  --kcs-bg: #fafafa;
  --kcs-focus: rgba(13,110,253,.18);
}
#kcs_pnl{width:920px;border-radius:12px;overflow:hidden;}
#kcs_body{background:var(--kcs-bg);}
.kcs_tab_content{padding:14px;}
.kcs_card{border:1px solid var(--kcs-border);border-radius:var(--kcs-radius);padding:14px;margin-bottom:12px;}
.kcs_card_head{font-size:14px;margin-bottom:10px;}
.kcs_help{font-size:12px;color:var(--kcs-subtext);margin-top:6px;line-height:1.35;}
.kcs_form{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--kcs-gap-2);align-items:start;}
.kcs_field{grid-column:span 6;min-width:220px;}
.kcs_field.sm{grid-column:span 3;min-width:160px;}
.kcs_field.full{grid-column:1 / -1;min-width:0;}
.kcs_label{display:block;font-size:12px;margin-right:10px;color:var(--kcs-subtext);margin-bottom:6px;user-select:none;}
.kcs_inp,.kcs_inp_sm{width:100%;max-width:var(--kcs-inp-max,340px);min-width:var(--kcs-inp-min,0px);box-sizing:border-box;padding:8px 10px;border:1px solid #ced4da;border-radius:8px;background:#fff;font-size:13px;}
.kcs_inp_sm{max-width:var(--kcs-inp-max,420px);font-size:12px;padding:7px 10px;margin-left:0;}
.kcs_inp:focus,.kcs_inp_sm:focus{outline:none;border-color:#0d6efd;box-shadow:0 0 0 4px var(--kcs-focus);}
.kcs_actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}
/* Rules table polish */
.kcs_table td:nth-child(2){max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.kcs_table td:nth-child(5){white-space:nowrap;}
/* Prevent long rules from creating horizontal scroll */
.kcs_table td{vertical-align:top;}
.kcs_table td:nth-child(3){white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
.kcs_badge{max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
/* Keep actions reachable even if something still overflows */
.kcs_table .kcs_actions_td{ position:sticky; right:0; background:#fff; z-index:2; box-shadow:-10px 0 12px rgba(0,0,0,0.06); }

/* Rules table layout: 4 columns, fixed widths */
.kcs_table{width:100%; table-layout:fixed;}

/* ID column: 3 digits */
.kcs_table th:nth-child(1),
.kcs_table td:nth-child(1){
  width:36px;
  white-space:nowrap;
  text-align:right;
}

/* Name column: fits 15 chars, clip */
.kcs_table th:nth-child(2),
.kcs_table td:nth-child(2){
  width:160px;
  max-width:160px; /* override your 220px */
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

/* Logic column: take the rest, allow wrapping */
.kcs_table th:nth-child(3),
.kcs_table td:nth-child(3){
  width:auto;
  white-space:normal;
  overflow-wrap:anywhere;
  word-break:break-word;
}

/* Actions column: 110px and sticky */
.kcs_table th:nth-child(4),
.kcs_table td:nth-child(4){
  width:110px;
  white-space:nowrap;
}

/* If you use sticky actions td class, ensure it respects width */
.kcs_table .kcs_actions_td{
  width:110px;
}


.kcs_actions_td{ position:sticky; right:0; background:#fff; z-index:2; box-shadow:-10px 0 12px rgba(0,0,0,0.06); }
.kcs_actions_cell{ display:flex; align-items:center; justify-content:flex-end; gap:6px; }

.kcs_chk{ display:flex; align-items:center; padding:2px 2px; margin-right:2px; margin-top: -2}
.kcs_chk input{ width:16px; height:16px; cursor:pointer; transform: scale(0.65); transform-origin: left center; }


@media (max-width: 820px){
  .kcs_field,.kcs_field.sm{grid-column:1 / -1;max-width:none;}
  .kcs_inp,.kcs_inp_sm{max-width:none;}
}
/* === Two columns for Info tab === */
.kcs_two_columns{display:flex;gap:14px;align-items:flex-start;}
.kcs_col{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;}
@media (max-width:920px){.kcs_two_columns{flex-direction:column;}.kcs_col{gap:10px;}}

/* --- Monitor: keep DI/DO always visible, sensors in modal + compact preview --- */
.kcs_monitor_grid{grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:4px;grid-auto-rows:32px}
.kcs_monitor_grid .kcs_live_card{min-height:32px;padding:2px 4px;font-size:11px;flex-direction:column;align-items:stretch;justify-content:center;gap:1px;min-width:0}
.kcs_monitor_grid .kcs_card_idx{color:#333;font-weight:700;font-size:10.5px;line-height:1;white-space:nowrap;margin-right:0}
.kcs_monitor_grid .kcs_card_name{display:block;min-width:0;max-width:none;text-align:left;font-size:9.5px;line-height:1.05;color:#495057;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kcs_mon_analog_bar{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
.kcs_mon_analog_bar .kcs_mon_section{margin-top:0}

.kcs_mon_titlebar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 4px}
.kcs_sensor_preview{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px}
.kcs_modal_overlay{position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px}
.kcs_modal_card{background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.35);width:min(980px,94vw);max-height:88vh;display:flex;flex-direction:column}
.kcs_modal_head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #eee}
.kcs_modal_title{font-weight:600;font-size:13px;color:#333}
.kcs_modal_body{padding:10px 12px;overflow:auto}
.kcs_sensor_grid_full{max-height:none;overflow:visible;padding-right:0}
.kcs_preset_grid{margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.kcs_preset_btn{border:1px solid #e9ecef;background:#fff;border-radius:12px;padding:10px;cursor:pointer;align:top;text-align:left;box-shadow:0 1px 3px rgba(0,0,0,0.05);transition:0.12s}
.kcs_preset_btn:hover{border-color:#adb5bd;transform:translateY(-1px)}
.kcs_preset_title{font-weight:600;font-size:13px;margin:0 0 4px;color:#212529}
.kcs_preset_desc{font-size:11px;color:#6c757d;line-height:1.35}
.kcs_preset_meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.kcs_preset_tag{font-size:10px;padding:2px 6px;border-radius:999px;background:#f1f3f5;border:1px solid #dee2e6;color:#495057}

`;
      const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);

      const iconUrl = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL("icon.png") : "";
      const minImg = el("img", {src: iconUrl, style:"pointer-events:none; width:100%; height:100%; object-fit:contain;"});
      minImg.onerror = () => {
          minImg.onerror = null;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <rect x="6" y="6" width="52" height="52" rx="14" ry="14" fill="#0d6efd"/>
            <path d="M36 10 L20 36 H32 L28 54 L44 28 H32 Z" fill="white"/>
          </svg>`;
          minImg.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
      };
      const minBtn = el("div", {id:"kcs_min"}, minImg);
      const pnl = el("div", {id:"kcs_pnl"},
          el("div", {id:"kcs_head"},
              el("span", {}, `KIM: KCS IFTTT Mass Mapper ${CFG.ver}`),
              el("div", {style:"display:flex;gap:10px;align-items:center"},
                  el("span", {id:"kcs_ws_badge", class:"kcs_ws_status off"}, "WS:--"),
                  el("button", {style:"border:none;background:none;cursor:pointer;font-size:18px", onclick:toggle}, "_")
              )
          ),
          el("div", {id:"kcs_tabs"}), el("div", {id:"kcs_body"})
      );

      pnl.style.display="none"; minBtn.style.display="flex";
      function toggle() { 
          if(pnl.style.display==="none"){
              pnl.style.display="flex"; 
              minBtn.style.display="none";
          }else{
              pnl.style.display="none"; 
              minBtn.style.display="flex";
          } 
      }

      let isDown=false, ox=0, oy=0;
      let isMinDown=false, mx=0, my=0, minMoved=false;

      document.body.appendChild(minBtn); 
      document.body.appendChild(pnl);

      const h=document.getElementById("kcs_head");
      h.onmousedown=e=>{
          if(e.target.tagName!=="BUTTON"){
              isDown=true; ox=e.offsetX; oy=e.offsetY;
              pnl.style.right="auto";
          }
      };

      minBtn.onmousedown = (e) => {
          if(e.button !== 0) return;
          isMinDown = true; minMoved = false;
          const r = minBtn.getBoundingClientRect();
          mx = e.clientX - r.left; my = e.clientY - r.top;
          e.preventDefault();
      };
      minBtn.onclick = (e) => {
          if(minMoved){ e.preventDefault(); e.stopPropagation(); minMoved=false; return; }
          toggle();
      };

      window.onmousemove = (e) => {
          if(isDown){ pnl.style.top=(e.clientY-oy)+"px"; pnl.style.left=(e.clientX-ox)+"px"; }
          if(isMinDown){ minMoved = true; minBtn.style.right="auto"; minBtn.style.bottom="auto"; minBtn.style.left=(e.clientX-mx)+"px"; minBtn.style.top=(e.clientY-my)+"px"; }
      };
      window.onmouseup = () => { isDown=false; isMinDown=false; };

      const tabs = [ 
          {id:"live",label:"Монитор",fn:renderLive}, 
          {id:"rules",label:"Правила",fn:renderRules}, 
          {id:"presets",label:"Пресеты",fn:renderPresets}, 
          {id:"map",label:"Маппинг",fn:renderMap}, 
          {id:"info",label:"Инфо",fn:renderInfo},
          {id:"io",label:"Импорт / Экспорт",fn:renderImpExp} 
      ];
      
      const tCont=document.getElementById("kcs_tabs"), bCont=document.getElementById("kcs_body");
      function openTab(t) { Array.from(tCont.children).forEach(c=>c.classList.remove("active")); document.getElementById(`tab_${t.id}`).classList.add("active"); bCont.innerHTML=""; bCont.appendChild(t.fn()); }
      tabs.forEach(t=>{ tCont.appendChild(el("div",{class:"kcs_tab",id:`tab_${t.id}`,onclick:()=>openTab(t)}, t.label)); });
      openTab(tabs[0]);
  }

  // ==========================================
  // BOOTSTRAP
  // ==========================================
  async function detectSecret() {
      const tests = ["", "1234", "admin", "password", "abcd", localStorage.getItem("kcs_secret") || ""];
      for (const s of tests) {
          try {
              const res = await fetch(`${BASE}/ctrl.cgi?cmd=get_inputs&id=0&value=0&secret=${encodeURIComponent(s)}`, {credentials: "include"});
              if (res.ok && (await res.text()).includes('"inputs"')) {
                  CFG.secret = s; localStorage.setItem("kcs_secret", s); return;
              }
          } catch (e) {}
      }
  }

  (async () => {
      await detectSecret();
      const src=await API.getSources();
      if(src){ if(src.di_num) CFG.diMax=parseInt(src.di_num); if(src.do_num) CFG.doMax=parseInt(src.do_num); }
      refreshNames(); init(); wsConnect(); startAdaptivePolling();
  })();

})();
})();