const KEY_LAST = "kcs_last_origin";
const KEY_AUTOSTART = "kcs_autostart_origin";
const KEY_ACTIVE = "kcs_active_origin";
const KEY_CONTROLLERS = "kcs_controllers_v1";
const KEY_ENABLED = "kim_enabled";

const $ = (id) => document.getElementById(id);
const hostInp = $("host");
const st = $("status");
const listEl = $("list");
const netHint = $("netHint");
const swEnabled = $("swEnabled");
const enabledLabel = $("enabledLabel");
const enabledHint = $("enabledHint");
const START_FILES = [
  "content.js",
  "io_name_editor.js",
  "presets/local_master.js",
  "presets/global_master.js",
  "presets/bathroom_vent.js"
];

// --- HELPERS ---

function setStatus(text, ok=null) {
  st.textContent = text || " ";
  st.className = "status" + (ok===true ? " ok" : ok===false ? " bad" : "");
}

function hasStorage() { return chrome?.storage?.local; }

function storageGet(keys) {
  return new Promise((resolve) => {
    try { hasStorage() ? chrome.storage.local.get(keys, resolve) : resolve({}); }
    catch(e) { resolve({}); }
  });
}
function storageSet(obj) {
  return new Promise((resolve) => {
    try { hasStorage() ? chrome.storage.local.set(obj, resolve) : resolve(); }
    catch(e) { resolve(); }
  });
}
function storageRemove(keys) {
  return new Promise((resolve) => {
    try { hasStorage() ? chrome.storage.local.remove(keys, resolve) : resolve(); }
    catch(e) { resolve(); }
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) return resolve({ ok: false, error: String(err.message || err) });
        resolve({ ok: true, response });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

function normalizeToOrigin(input) {
  const raw = (input || "").trim();
  if (!raw) return null;
  const withScheme = /^(https?:\/\/)/i.test(raw) ? raw : `http://${raw}`;
  let u;
  try { u = new URL(withScheme); }
  catch { return null; }
  if (u.protocol === "ws:" || u.protocol === "wss:") {
    u = new URL((u.protocol === "wss:" ? "https:" : "http:") + "//" + u.host + "/");
  }
  return u.origin;
}

function isIPv4Host(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function prefix24FromOrigin(origin) {
  try {
    const u = new URL(origin);
    if (!isIPv4Host(u.hostname)) return null;
    const parts = u.hostname.split(".");
    return parts.slice(0, 3).join(".");
  } catch {
    return null;
  }
}

function tryGetIp(url) {
    try { return new URL(url).hostname; } catch { return url; }
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

// --- CORE LOGIC ---

async function fetchIndex(origin, timeoutMs=700) {
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const r = await fetch(origin + "/index", {
      method: "POST",
      mode: "cors",
      credentials: "include",
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest"
      },
      body: null,
      signal
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== "object") return null;
    // Валидация
    if (!j.model && !j.serial_number && !j.lan_mac && !j.wifi_mac) return null;
    return j;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

function controllerKey(info, origin) {
  const sn = (info?.serial_number || "").toString().trim();
  const wm = (info?.wifi_mac || "").toString().trim();
  const lm = (info?.lan_mac || "").toString().trim();
  if (sn) return `sn:${sn}`;
  if (wm) return `wm:${wm}`;
  if (lm) return `lm:${lm}`;
  return `or:${origin}`;
}

// --- STORAGE MANAGE ---

async function loadControllers() {
  const saved = await storageGet([KEY_CONTROLLERS]);
  return Array.isArray(saved?.[KEY_CONTROLLERS]) ? saved[KEY_CONTROLLERS] : [];
}

async function saveControllers(arr) {
  await storageSet({ [KEY_CONTROLLERS]: arr });
}

// Обновленная функция: сохраняет пользовательское имя
function upsertController(list, origin, info, online) {
  const now = Date.now();
  const key = controllerKey(info, origin);
  const idx = list.findIndex(x => x.key === key);
  
  // Берем старое имя, если есть
  const oldEntry = idx >= 0 ? list[idx] : {};
  
  const entry = {
    key,
    origin,
    ip: (info?.lan_ip || info?.wifi_ip || "").toString(),
    model: (info?.model || "").toString(),
    version: (info?.version || "").toString(),
    serial_number: (info?.serial_number || "").toString(),
    lan_mac: (info?.lan_mac || "").toString(),
    wifi_mac: (info?.wifi_mac || "").toString(),
    
    // ВАЖНО: сохраняем кастомное имя
    customName: oldEntry.customName || "", 
    
    lastSeen: online ? now : (info?.time ? Number(info.time) : now),
    lastCheck: now,
    online: !!online
  };

  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.unshift(entry);
  }
  if (list.length > 50) list.length = 50;
  return list;
}

// Новые функции управления
async function updateControllerName(key, newName) {
  let list = await loadControllers();
  const idx = list.findIndex(c => c.key === key);
  if (idx >= 0) {
    list[idx].customName = newName.trim();
    await saveControllers(list);
    renderControllers(list);
  }
}

async function removeController(key) {
  if(!confirm("Удалить контроллер из списка?")) return;
  let list = await loadControllers();
  list = list.filter(c => c.key !== key);
  await saveControllers(list);
  renderControllers(list);
}

// --- RENDER ---

function renderControllers(list) {
  listEl.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Список пуст. Нажмите «Автопоиск» или откройте контроллер в браузере.";
    listEl.appendChild(empty);
    return;
  }

  const sorted = [...list].sort((a,b) => {
    if (!!b.online !== !!a.online) return (b.online ? 1 : 0) - (a.online ? 1 : 0);
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });

  for (const c of sorted) {
    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "itemLeft";
    left.style.width = "100%";

    // Верхняя строка
    const headRow = document.createElement("div");
    headRow.className = "itemHeadRow";

    const titleGroup = document.createElement("div");
    titleGroup.className = "itemTitleGroup";

    // Бейдж
    const badge = document.createElement("span");
    badge.className = "badge " + (c.online ? "ok" : "bad");
    badge.textContent = c.online ? "ON" : "OFF";
    titleGroup.appendChild(badge);

    // Имя
    const displayName = c.customName || c.model || "Unknown";
    const nameEl = document.createElement("div");
    nameEl.className = "itemName";
    nameEl.textContent = displayName;
    nameEl.title = c.key;
    
    // Редактирование имени
    let isEditing = false;
    const toggleEdit = () => {
        if(isEditing) return;
        isEditing = true;
        nameEl.style.display = "none";
        const inp = document.createElement("input");
        inp.className = "nameEditInp";
        inp.value = c.customName || c.model || "";
        inp.placeholder = "Название...";
        const save = async () => { await updateControllerName(c.key, inp.value); };
        inp.onblur = save;
        inp.onkeydown = (e) => { if(e.key === "Enter") save(); };
        titleGroup.insertBefore(inp, editBtn);
        inp.focus();
    };
    titleGroup.appendChild(nameEl);

    // Кнопка Edit
    const editBtn = document.createElement("button");
    editBtn.className = "iconBtn";
    editBtn.innerHTML = "✏️";
    editBtn.title = "Переименовать";
    editBtn.onclick = toggleEdit;
    titleGroup.appendChild(editBtn);

    headRow.appendChild(titleGroup);

    // Кнопка Delete
    const delBtn = document.createElement("button");
    delBtn.className = "iconBtn del";
    delBtn.innerHTML = "🗑";
    delBtn.title = "Забыть устройство";
    delBtn.onclick = () => removeController(c.key);
    headRow.appendChild(delBtn);

    left.appendChild(headRow);

    // Подстрока
    const sub = document.createElement("div");
    sub.className = "itemSub";
    const ip = c.ip || tryGetIp(c.origin);
    const mac = c.wifi_mac || c.lan_mac || "";
    sub.textContent = `${ip} • ${mac} • ${c.version || "?"}`;
    left.appendChild(sub);
    
    // Кнопки действий
    const actionRow = document.createElement("div");
    actionRow.style.marginTop = "8px";
    actionRow.style.display = "flex";
    actionRow.style.gap = "8px";

    const bOpen = document.createElement("button");
    bOpen.className = "smallBtn primary";
    bOpen.textContent = "Открыть UI";
    bOpen.onclick = async () => {
      hostInp.value = c.origin;
      await openController();
    };

    const bUse = document.createElement("button");
    bUse.className = "smallBtn";
    bUse.textContent = "Вставить IP";
    bUse.onclick = async () => {
      hostInp.value = c.origin;
      setStatus("Адрес подставлен", true);
    };

    actionRow.appendChild(bOpen);
    actionRow.appendChild(bUse);
    left.appendChild(actionRow);

    item.appendChild(left);
    listEl.appendChild(item);
  }
}

// --- ACTIONS ---

async function setFromThisPage() {
  const tab = await getActiveTab();
  if (!tab?.url) return setStatus("Не вижу URL активной вкладки", false);
  try {
    const u = new URL(tab.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return setStatus("Эта вкладка не http/https", false);
    hostInp.value = u.origin;
    await storageSet({ [KEY_LAST]: u.origin, [KEY_ACTIVE]: u.origin });
    await rememberController(u.origin);
    setStatus("Подставил origin текущей страницы", true);
  } catch {
    setStatus("Не смог разобрать URL текущей вкладки", false);
  }
}

async function rememberController(origin) {
  const info = await fetchIndex(origin, 700);
  if (!info) return;
  let list = await loadControllers();
  list = upsertController(list, origin, info, true);
  await saveControllers(list);
  renderControllers(list);
}

async function openController() {
  const origin = normalizeToOrigin(hostInp.value);
  if (!origin) return setStatus("Адрес не похож на адрес.", false);
  const tab = await getActiveTab();
  await storageSet({ [KEY_LAST]: origin, [KEY_ACTIVE]: origin, [KEY_AUTOSTART]: origin });
  await rememberController(origin);
  await chrome.tabs.update(tab.id, { url: origin + "/" });
  setStatus("Открываю контроллер...", true);
  window.close();
}

async function startOnThisPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return setStatus("Не вижу активную вкладку", false);
  if (!(await isEnabled())) return setStatus("KIM сейчас выключен (ползунок вверху).", false);

  const origin = normalizeToOrigin(hostInp.value);
  if (origin) await storageSet({ [KEY_LAST]: origin, [KEY_ACTIVE]: origin });

  const probe = async () => {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          loaded: !!window.__KCS_HELPER_LOADED__,
          hasPanel: !!document.getElementById("kcs_pnl"),
          hasMin: !!document.getElementById("kcs_min"),
          presets: Array.isArray(window.__KCS_PRESET_REGISTRY__) ? window.__KCS_PRESET_REGISTRY__.length : 0,
        }),
      });
      return res?.[0]?.result || { loaded: false, hasPanel: false, hasMin: false, presets: 0 };
    } catch (e) {
      return null;
    }
  };

  const before = await probe();
  if (before && (before.hasPanel || before.hasMin)) return setStatus("UI уже запущен", true);

  const wake = await sendTabMessage(tab.id, { type: "kim_enabled", enabled: true });
  if (wake.ok) {
    await new Promise((r) => setTimeout(r, 200));
    const afterWake = await probe();
    if (afterWake && (afterWake.hasPanel || afterWake.hasMin || afterWake.loaded)) {
      return setStatus(`UI запущен ✅${afterWake.presets ? ` Пресетов: ${afterWake.presets}` : ""}`, true);
    }
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"],
    });
  } catch (e) {}

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: START_FILES });
  } catch (e) {
    return setStatus("Не могу внедрить скрипт. Страница не подходит.", false);
  }

  await new Promise((r) => setTimeout(r, 250));
  const after = await probe();
  if (after && (after.hasPanel || after.hasMin || after.loaded)) {
    return setStatus(`UI запущен ✅${after.presets ? ` Пресетов: ${after.presets}` : ""}`, true);
  }
  setStatus("Скрипт внедрен, но UI не появился.", false);
}

// Исправленный Scan LAN
async function scanLan() {
  console.log(">>> Запуск сканирования...");
  const tab = await getActiveTab();
  const originFromTab = (() => { try { return tab?.url ? new URL(tab.url).origin : null; } catch { return null; } })();
  const originFromInput = normalizeToOrigin(hostInp.value);
  
  let prefix = prefix24FromOrigin(originFromInput || originFromTab || "");
  console.log("Определенный префикс:", prefix);

  if (!prefix) {
      console.warn("Не удалось определить подсеть. Пробую 192.168.1");
      prefix = "192.168.1"; 
      // Если у вас 192.168.0.x, поменяйте на "192.168.0"
  }

  setStatus(`Сканирую сеть ${prefix}.1-254 ...`, null);

  const targets = [];
  for (let n = 1; n <= 254; n++) targets.push(`http://${prefix}.${n}`);

  const conc = 20; 
  let idx = 0;
  let list = await loadControllers();
  let foundNew = 0;

  async function worker() {
    while (idx < targets.length) {
      const myUrl = targets[idx++];
      try {
          const info = await fetchIndex(myUrl, 1000); 
          if (info) {
            console.log("НАЙДЕНО:", myUrl, info);
            list = upsertController(list, myUrl, info, true);
            foundNew++;
            renderControllers(list); 
          }
      } catch (e) {}
      if(idx % 10 === 0) setStatus(`Сканирую ${prefix}.* (${Math.round(idx/2.54)}%)...`, null);
    }
  }

  await Promise.all(Array.from({length: conc}, worker));
  await saveControllers(list);
  renderControllers(list);
  
  if (foundNew > 0) setStatus(`Готово. Найдено: ${foundNew}`, true);
  else setStatus(`В сети ${prefix}.* ничего нет.`, false);
}

async function refreshOnline() {
  let list = await loadControllers();
  if (!list.length) return setStatus("Список пуст", false);
  setStatus("Проверяю онлайн...", null);
  
  const conc = 6;
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      const c = list[idx];
      const info = await fetchIndex(c.origin, 600);
      if (info) list = upsertController(list, c.origin, info, true);
      else list[idx] = { ...list[idx], online: false, lastCheck: Date.now() };
    }
  }
  await Promise.all(Array.from({length: conc}, worker));
  await saveControllers(list);
  renderControllers(list);
  setStatus("Проверка онлайн завершена", true);
}

async function clearAll() {
  if (!confirm("Вы уверены? Это очистит весь список сохраненных контроллеров.")) return;
  await storageRemove([KEY_LAST, KEY_AUTOSTART, KEY_ACTIVE, KEY_CONTROLLERS]);
  hostInp.value = "";
  listEl.innerHTML = "";
  renderControllers([]);
  setStatus("Настройки сброшены", true);
}

async function isEnabled() {
  const v = await storageGet([KEY_ENABLED]);
  return v?.[KEY_ENABLED] !== false; // default ON
}

function applyEnabledUi(enabled) {
  if (swEnabled) swEnabled.checked = !!enabled;
  if (enabledLabel) enabledLabel.textContent = enabled ? "😄 включено" : "😴 выключено";
  if (enabledHint) enabledHint.style.opacity = enabled ? "1" : "0.85";
  const btnStart = $("btnStart");
  if (btnStart) btnStart.disabled = !enabled;
}

// --- INIT ---

(async function init() {
  const saved = await storageGet([KEY_LAST, KEY_ENABLED]);
if (saved?.[KEY_LAST]) hostInp.value = saved[KEY_LAST];
applyEnabledUi(saved?.[KEY_ENABLED] !== false);
  const list = await loadControllers();
  renderControllers(list);
  netHint.textContent = "LAN / Wi-Fi";
  if (list.length) refreshOnline();
})();

// LISTENERS
swEnabled.addEventListener("change", async () => {
  const enabled = !!swEnabled.checked;
  await storageSet({ [KEY_ENABLED]: enabled });
  applyEnabledUi(enabled);

  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: "kim_enabled", enabled }, () => {
      const err = chrome.runtime.lastError;
      if (!err) return;

      const msg = String(err.message || "");
      if (
        msg.includes("Could not establish connection") ||
        msg.includes("Receiving end does not exist")
      ) {
        // Это нормально: на вкладке просто нет content script
        return;
      }

      console.warn("kim_enabled sendMessage error:", err.message);
    });
  } catch (e) {
    console.warn("kim_enabled toggle failed:", e);
  }
});
$("btnThis").addEventListener("click", setFromThisPage);
$("btnOpen").addEventListener("click", openController);
$("btnStart").addEventListener("click", startOnThisPage);
$("btnClear").addEventListener("click", clearAll);
$("btnScan").addEventListener("click", scanLan);
$("btnRefresh").addEventListener("click", refreshOnline);