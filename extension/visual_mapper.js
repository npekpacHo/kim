(function () {
  if (window.KCS_VisualMapper) return;

  const HDRS_JSON = {
    accept: "*/*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };

  const HDRS_FORM = {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest"
  };

  const ZERO32 = "00000000000000000000000000000000";

  const state = {
    modal: null,
    busy: false,
    inputs: [],
    outputs: [],
    usedIds: new Set(),
    connections: [], // [{ di, doId, action }]
    selectedDis: new Set(),
    selectedDos: new Set(),
    lastValidation: null,
    lastAutolinkReport: null
  };

  const __kcsVmColorCache = new Map();

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function mk(tag, attrs, ...children) {
    const el = document.createElement(tag);

    if (attrs) {
      for (const [key, val] of Object.entries(attrs)) {
        if (val === undefined || val === null) continue;

        if (key === "class") el.className = val;
        else if (key === "style") el.style.cssText = val;
        else if (key === "checked") el.checked = !!val;
        else if (key === "value") el.value = val;
        else if (key === "selected") el.selected = !!val;
        else if (key.startsWith("on") && typeof val === "function") {
          el.addEventListener(key.slice(2), val);
        } else {
          el.setAttribute(key, val);
        }
      }
    }

    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }

    return el;
  }

  function shortName(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function normName(s) {
    return shortName(s).toLowerCase();
  }

  function looseName(s) {
    return shortName(s)
      .toLowerCase()
      .replace(/[_\-./\\]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokensOf(s) {
    return looseName(s).split(" ").filter(Boolean);
  }

  function tokenKey(s) {
    return tokensOf(s).sort().join("|");
  }

  function extractNumbers(s) {
    const m = String(s || "").match(/\d+/g);
    return m ? m : [];
  }

  function stripNumbers(s) {
    return looseName(s).replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  }

  function levenshtein(a, b) {
    a = String(a || "");
    b = String(b || "");

    const m = a.length;
    const n = b.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  function similarTextScore(a, b) {
    a = stripNumbers(a);
    b = stripNumbers(b);

    if (!a || !b) return 0;
    if (a === b) return 120;

    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);

    if (maxLen <= 2) {
      return dist <= 1 ? 80 : 0;
    }

    if (dist <= 1) return 110;
    if (dist <= 2) return 85;
    if (dist <= 3 && maxLen >= 6) return 55;

    return 0;
  }

  function parsePositiveInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function colorFromName(name) {
    const s = normName(name);
    if (!s) return "";

    if (__kcsVmColorCache.has(s)) return __kcsVmColorCache.get(s);

    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const hue = Math.abs(hash) % 360;
    const sat = 36 + (Math.abs(hash >> 5) % 8);
    const light = 91 + (Math.abs(hash >> 9) % 3);

    const color = `hsl(${hue}, ${sat}%, ${light}%)`;
    __kcsVmColorCache.set(s, color);
    return color;
  }

  function setStatus(text) {
    const el = document.getElementById("kcs_vm_status");
    if (el) el.textContent = text || "";
  }

  function setBusy(flag) {
    state.busy = !!flag;

    const ids = [
      "kcs_vm_reload",
      "kcs_vm_apply",
      "kcs_vm_close",
      "kcs_vm_start_id",
      "kcs_vm_link_btn",
      "kcs_vm_clear_links",
      "kcs_vm_clear_selection",
      "kcs_vm_validate_btn",
      "kcs_vm_autolink_btn",
      "kcs_vm_action_toggle",
      "kcs_vm_action_on",
      "kcs_vm_action_off",
      "kcs_vm_mass_mode",
      "kcs_vm_autolink_mode"
    ];

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.disabled = state.busy;
    }

    document.querySelectorAll(".kcs_vm_pick").forEach((el) => {
      el.disabled = state.busy;
    });
  }

  function ensureStyles() {
    if (document.getElementById("kcs_visual_mapper_css")) return;

    const css = `
#kcs_vm_overlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.45);
  z-index:100001;
  display:none;
  align-items:center;
  justify-content:center;
  padding:18px;
}
#kcs_vm_card{
  width:min(1450px,97vw);
  height:min(92vh,980px);
  background:#fff;
  border:1px solid #d8dee4;
  border-radius:14px;
  box-shadow:0 18px 60px rgba(0,0,0,.35);
  display:flex;
  flex-direction:column;
  overflow:hidden;
  font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
}
#kcs_vm_head{
  padding:12px 14px;
  border-bottom:1px solid #eef1f4;
  display:flex;
  align-items:center;
  gap:10px;
  background:#f8fafc;
}
#kcs_vm_title{
  font-size:15px;
  font-weight:700;
  color:#1f2328;
}
#kcs_vm_spacer{ flex:1; }

#kcs_vm_body{
  flex:1;
  display:grid;
  grid-template-columns: 1fr 1.2fr 1fr 390px;
  gap:12px;
  padding:12px;
  overflow:hidden;
}

.kcs_vm_col{
  border:1px solid #edf0f2;
  border-radius:12px;
  background:#fff;
  overflow:auto;
  min-width:0;
}
.kcs_vm_colhead{
  position:sticky;
  top:0;
  z-index:2;
  background:#fff;
  padding:10px 12px;
  border-bottom:1px solid #edf0f2;
  font-size:12px;
  font-weight:700;
  color:#222;
}
.kcs_vm_list{
  padding:8px;
}
.kcs_vm_row{
  display:grid;
  grid-template-columns:30px 62px 1fr;
  gap:8px;
  align-items:center;
  padding:8px 10px;
  border:1px solid #f1f3f5;
  border-radius:10px;
  margin-bottom:8px;
  min-height:44px;
}
.kcs_vm_row:hover{
  border-color:#cfd7df;
}
.kcs_vm_row.active{
  border-color:#4f7cff;
  box-shadow:0 0 0 2px rgba(79,124,255,.10);
}
.kcs_vm_row.linked{
  border-color:#bfd3ff;
}
.kcs_vm_num{
  font-size:12px;
  color:#667085;
  font-weight:700;
}
.kcs_vm_name{
  font-size:12px;
  color:#222;
  line-height:1.2;
  word-break:break-word;
}
.kcs_vm_empty{
  color:#98a2b3;
  font-style:italic;
}
.kcs_vm_dup{
  outline:2px solid #e5484d;
}
.kcs_vm_match{
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.03);
}
.kcs_vm_pickwrap{
  display:flex;
  align-items:center;
  justify-content:center;
}
.kcs_vm_pick{
  width:16px;
  height:16px;
  cursor:pointer;
}

#kcs_vm_center{
  border:1px solid #edf0f2;
  border-radius:12px;
  background:#fcfdff;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  min-width:0;
}
#kcs_vm_center_head{
  padding:10px 12px;
  border-bottom:1px solid #edf0f2;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
#kcs_vm_center_title{
  font-size:12px;
  font-weight:700;
  color:#222;
}
#kcs_vm_center_note{
  font-size:11px;
  color:#667085;
}
#kcs_vm_links{
  padding:12px;
  overflow:auto;
}
.kcs_vm_linkitem{
  display:grid;
  grid-template-columns: 1fr auto;
  gap:8px;
  align-items:start;
  padding:10px 12px;
  border:1px solid #e8edf4;
  border-radius:10px;
  margin-bottom:10px;
  background:#fff;
}
.kcs_vm_linkstack{
  min-width:0;
}
.kcs_vm_linkmain{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  min-width:0;
}
.kcs_vm_linkcomment{
  margin-top:6px;
  padding-left:2px;
  font-size:11px;
  color:#667085;
  line-height:1.35;
  word-break:break-word;
}
.kcs_vm_tag{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:4px 8px;
  border-radius:999px;
  background:#f3f6fb;
  border:1px solid #e3e8f1;
  font-size:12px;
  color:#334155;
  white-space:nowrap;
}
.kcs_vm_arrow{
  font-size:14px;
  color:#94a3b8;
}
.kcs_vm_actiontag{
  background:#eef4ff;
  border-color:#dbe7ff;
  color:#2957c8;
}
.kcs_vm_remove{
  white-space:nowrap;
}
#kcs_vm_links_empty{
  padding:18px;
  color:#94a3b8;
  font-size:13px;
}

#kcs_vm_side{
  border:1px solid #edf0f2;
  border-radius:12px;
  background:#fcfcfd;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
#kcs_vm_side_head{
  padding:12px;
  border-bottom:1px solid #edf0f2;
}
#kcs_vm_side_body{
  padding:12px;
  overflow:auto;
}
.kcs_vm_field{
  margin-bottom:12px;
}
.kcs_vm_field label{
  display:block;
  font-size:12px;
  font-weight:600;
  margin-bottom:6px;
  color:#333;
}
.kcs_vm_field input[type="text"],
.kcs_vm_field select{
  width:100%;
  box-sizing:border-box;
  padding:8px 10px;
  border:1px solid #d0d7de;
  border-radius:8px;
  font-size:13px;
  background:#fff;
}
.kcs_vm_checks{
  display:flex;
  gap:12px;
  flex-wrap:wrap;
}
.kcs_vm_checks label{
  display:flex;
  align-items:center;
  gap:6px;
  font-size:12px;
  font-weight:500;
}
.kcs_vm_actions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:12px;
}
.kcs_vm_hint{
  margin-top:6px;
  font-size:11px;
  color:#667085;
  line-height:1.35;
}
#kcs_vm_preview,
#kcs_vm_validation{
  border:1px solid #edf0f2;
  border-radius:10px;
  background:#fff;
  min-height:110px;
  max-height:220px;
  overflow:auto;
  padding:8px;
}
.kcs_vm_preview_item,
.kcs_vm_validation_item{
  padding:6px 8px;
  border-bottom:1px solid #f2f4f7;
  font-size:12px;
}
.kcs_vm_preview_item:last-child,
.kcs_vm_validation_item:last-child{
  border-bottom:none;
}
.kcs_vm_validation_item.ok{ color:#166534; }
.kcs_vm_validation_item.warn{ color:#9a3412; }
.kcs_vm_validation_item.err{ color:#b91c1c; }

.kcs_vm_warn{
  padding:10px 12px;
  border-top:1px solid #edf0f2;
  background:#fff7ed;
  color:#9a3412;
  font-size:12px;
  line-height:1.35;
}
#kcs_vm_foot{
  padding:12px 14px;
  border-top:1px solid #eef1f4;
  display:flex;
  align-items:center;
  gap:10px;
}
#kcs_vm_status{
  flex:1;
  font-size:12px;
  color:#555;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

@media (max-width: 1260px){
  #kcs_vm_body{
    grid-template-columns:1fr;
    grid-auto-rows:minmax(180px,auto);
  }
}
    `;

    document.head.appendChild(mk("style", { id: "kcs_visual_mapper_css" }, css));
  }

  async function postJson(path, body = null) {
    const resp = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: HDRS_JSON,
      body: body ? JSON.stringify(body) : null,
      cache: "no-store"
    });

    const text = await resp.text();

    try {
      const json = JSON.parse(text);
      if (json && json.data && typeof json.data === "object") {
        return json.data;
      }
      return json;
    } catch (_) {
      return {
        ok: resp.ok,
        status: resp.status,
        text
      };
    }
  }

  async function listRules() {
    const allRows = [];
    let offset = 0;
    const chunk = 50;

    while (offset < 2000) {
      const resp = await fetch("/ifttt/get", {
        method: "POST",
        credentials: "include",
        headers: HDRS_FORM,
        body: new URLSearchParams({
          limit: String(chunk),
          offset: String(offset),
          keyword: ""
        }),
        cache: "no-store"
      });

      if (!resp.ok) break;

      const json = await resp.json();
      if (!json || !Array.isArray(json.rows) || !json.rows.length) break;

      allRows.push(...json.rows);

      if (json.rows.length < chunk) break;
      offset += chunk;
      await sleep(80);
    }

    return allRows;
  }

  function normalizeIoList(src, declaredCount) {
    const count = Math.max(
      parsePositiveInt(declaredCount) || 0,
      Array.isArray(src) ? src.length : 0
    );

    const out = new Array(count).fill(null).map((_, idx) => ({
      id: idx + 1,
      name: ""
    }));

    if (!Array.isArray(src)) return out;

    if (src.length === 0 || typeof src[0] === "string") {
      src.forEach((name, idx) => {
        if (idx < out.length) {
          out[idx] = { id: idx + 1, name: shortName(name) };
        }
      });
      return out;
    }

    src.forEach((it, idx) => {
      if (!it || typeof it !== "object") return;

      const id = parsePositiveInt(it.id ?? it.num ?? (idx + 1)) || (idx + 1);
      const name = shortName(it.name ?? "");

      const arrIdx = id - 1;
      if (arrIdx < 0) return;

      if (arrIdx >= out.length) out.length = arrIdx + 1;
      out[arrIdx] = { id, name };
    });

    return out.map((item, idx) => ({
      id: parsePositiveInt(item?.id) || (idx + 1),
      name: shortName(item?.name || "")
    }));
  }

  async function loadIo() {
    const raw = await postJson("/monitor/get", null);
    const res = (raw && raw.data) ? raw.data : raw;

    if (!res || typeof res !== "object") {
      return { inputs: [], outputs: [] };
    }

    const inputsRaw = Array.isArray(res.inputs) ? res.inputs : [];
    const outputsRaw = Array.isArray(res.outputs) ? res.outputs : [];

    const inputNum = parsePositiveInt(res.input_num) || inputsRaw.length;
    const outputNum = parsePositiveInt(res.output_num) || outputsRaw.length;

    return {
      inputs: normalizeIoList(inputsRaw, inputNum),
      outputs: normalizeIoList(outputsRaw, outputNum)
    };
  }

  function getDuplicateNames(items) {
    const counts = new Map();

    for (const item of items) {
      const name = normName(item.name);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const duplicates = new Set();
    for (const [name, count] of counts.entries()) {
      if (count > 1) duplicates.add(name);
    }

    return duplicates;
  }

  function makeHexMask(indices) {
    const nibbles = new Array(32).fill(0);

    for (const idx of indices) {
      if (!Number.isFinite(idx) || idx < 1 || idx > 128) continue;

      const nibIdx = Math.floor((idx - 1) / 4);
      const bitPos = (idx - 1) % 4;
      const mask = 1 << (3 - bitPos);

      if (nibIdx >= 0 && nibIdx < 32) {
        nibbles[nibIdx] |= mask;
      }
    }

    return nibbles.map((n) => n.toString(16)).join("");
  }

  function ruleName(action, di, doId) {
    if (action === "toggle") return `tog${di}=${doId}`;
    if (action === "on") return `on${di}=${doId}`;
    if (action === "off") return `off${di}=${doId}`;
    return `r${di}=${doId}`;
  }

  function buildRule({ id, name, di, doId, action }) {
    const on = [];
    const off = [];
    const toggle = [];

    if (action === "toggle") toggle.push(doId);
    if (action === "on") on.push(doId);
    if (action === "off") off.push(doId);

    return {
      id,
      name,
      enable: 1,
      relation: 0,
      scenario_mode: 0,
      if_items: [
        {
          type: 1,
          index: di - 1,
          triggle: 0
        }
      ],
      if_count: 1,
      then_items: [
        {
          type: 9,
          on: on.length ? makeHexMask(on) : ZERO32,
          off: off.length ? makeHexMask(off) : ZERO32,
          toggle: toggle.length ? makeHexMask(toggle) : ZERO32
        }
      ],
      then_count: 1
    };
  }

  function getSelectedAction() {
    if (document.getElementById("kcs_vm_action_on")?.checked) return "on";
    if (document.getElementById("kcs_vm_action_off")?.checked) return "off";
    return "toggle";
  }

  function getStartId() {
    const raw = document.getElementById("kcs_vm_start_id")?.value || "1";
    return parsePositiveInt(raw) || 1;
  }

  function getMassMode() {
    return document.getElementById("kcs_vm_mass_mode")?.value || "pairwise";
  }

  function getAutolinkMode() {
    return document.getElementById("kcs_vm_autolink_mode")?.value || "smart";
  }

  function getConnectionByDi(di) {
    return state.connections.find((x) => x.di === di) || null;
  }

  function clearSelection() {
    state.selectedDis.clear();
    state.selectedDos.clear();
    renderLists();
  }

  function toggleDiSelection(di, checked) {
    if (checked) state.selectedDis.add(di);
    else state.selectedDis.delete(di);
    renderLists();
  }

  function toggleDoSelection(doId, checked) {
    if (checked) state.selectedDos.add(doId);
    else state.selectedDos.delete(doId);
    renderLists();
  }

  function addOrReplaceConnection(di, doId, action) {
    state.connections = state.connections.filter((x) => x.di !== di);
    state.connections.push({ di, doId, action });
    state.connections.sort((a, b) => a.di - b.di || a.doId - b.doId);
  }

  function removeConnection(di, doId, action) {
    state.connections = state.connections.filter(
      (x) => !(x.di === di && x.doId === doId && x.action === action)
    );
  }

  function clearConnections() {
    state.connections = [];
    state.lastAutolinkReport = null;
    renderLinks();
    renderPreview();
    renderValidation();
    renderLists();
  }

  function linkSelected() {
    const dis = [...state.selectedDis].sort((a, b) => a - b);
    const dos = [...state.selectedDos].sort((a, b) => a - b);
    const action = getSelectedAction();
    const mode = getMassMode();

    if (!dis.length) {
      alert("Выбери хотя бы один DI");
      return;
    }
    if (!dos.length) {
      alert("Выбери хотя бы один DO");
      return;
    }

    let linked = 0;
    const notes = [];

    if (mode === "pairwise") {
      const count = Math.min(dis.length, dos.length);
      if (dis.length !== dos.length) {
        notes.push(`В режиме pairwise использовано только ${count} пар из-за разного количества выбранных DI и DO.`);
      }
      for (let i = 0; i < count; i++) {
        addOrReplaceConnection(dis[i], dos[i], action);
        linked++;
      }
    } else if (mode === "all_di_to_one_do") {
      if (dos.length !== 1) {
        alert("Для режима all_di_to_one_do нужно выбрать ровно один DO");
        return;
      }
      for (const di of dis) {
        addOrReplaceConnection(di, dos[0], action);
        linked++;
      }
    }

    state.lastAutolinkReport = notes.length ? { notes } : null;
    clearSelection();
    renderLinks();
    renderPreview();
    renderValidation();
    if (notes.length) {
      setStatus(`Связано: ${linked}. ${notes.join(" ")}`);
    }
  }

  function scoreNameMatch(diName, doName, mode) {
    const n1 = normName(diName);
    const n2 = normName(doName);
    const l1 = looseName(diName);
    const l2 = looseName(doName);
    const t1 = tokenKey(diName);
    const t2 = tokenKey(doName);

    if (!n1 || !n2) return 0;

    if (mode === "exact") {
      return n1 === n2 ? 300 : 0;
    }

    if (mode === "loose") {
      if (n1 === n2) return 300;
      if (l1 && l1 === l2) return 260;
      if (t1 && t1 === t2) return 220;
      return 0;
    }

    // smart
    if (n1 === n2) return 300;
    if (l1 && l1 === l2) return 270;
    if (t1 && t1 === t2) return 240;

    const nums1 = extractNumbers(diName);
    const nums2 = extractNumbers(doName);

    const sameNumbers =
      nums1.length > 0 &&
      nums2.length > 0 &&
      nums1.join("|") === nums2.join("|");

    if (sameNumbers) {
      const txtScore = similarTextScore(diName, doName);

      if (txtScore >= 85) return 235 + txtScore;
      return 200 + Math.min(txtScore, 30);
    }

    if (l1 && l2 && l1.length >= 3 && l2.length >= 3) {
      if (l1.includes(l2) || l2.includes(l1)) return 180;
    }

    const a = new Set(tokensOf(diName));
    const b = new Set(tokensOf(doName));
    if (a.size && b.size) {
      let common = 0;
      for (const x of a) if (b.has(x)) common++;
      if (common) return 100 + common * 10;
    }

    return 0;
  }

  function autolinkByNames() {
    const mode = getAutolinkMode();
    const action = getSelectedAction();
    const availableOutputs = [...state.outputs];
    const usedDos = new Set();
    let linked = 0;
    let skippedNoMatch = 0;
    let skippedAmbiguous = 0;

    for (const inp of state.inputs) {
      const candidates = [];

      for (const out of availableOutputs) {
        if (usedDos.has(out.id)) continue;
        const score = scoreNameMatch(inp.name, out.name, mode);
        if (score > 0) {
          candidates.push({ out, score });
        }
      }

      if (!candidates.length) {
        skippedNoMatch++;
        continue;
      }

      candidates.sort((a, b) => b.score - a.score || a.out.id - b.out.id);

      const best = candidates[0];
      const tied = candidates.filter((x) => x.score === best.score);

      if (tied.length > 1) {
        skippedAmbiguous++;
        continue;
      }

      addOrReplaceConnection(inp.id, best.out.id, action);
      usedDos.add(best.out.id);
      linked++;
    }

    state.lastAutolinkReport = {
      mode,
      linked,
      skippedNoMatch,
      skippedAmbiguous
    };

    renderLinks();
    renderPreview();
    renderValidation();
    renderLists();

    setStatus(
      `Автосвязка: связано ${linked}, без совпадений ${skippedNoMatch}, неоднозначных ${skippedAmbiguous}`
    );
  }

  function getPreviewPlan() {
    const startId = getStartId();
    const plan = [];
    let nextId = startId;

    for (const link of state.connections) {
      const id = nextId++;
      plan.push({
        id,
        di: link.di,
        doId: link.doId,
        action: link.action,
        name: ruleName(link.action, link.di, link.doId),
        overwrite: state.usedIds.has(id)
      });
    }

    return plan;
  }

  function validateConnections() {
    const result = {
      ok: [],
      warn: [],
      err: []
    };

    if (!state.connections.length) {
      result.warn.push("Связок пока нет.");
      return result;
    }

    const diIds = new Set(state.inputs.map((x) => x.id));
    const doIds = new Set(state.outputs.map((x) => x.id));

    const doUse = new Map();

    for (const link of state.connections) {
      if (!diIds.has(link.di)) result.err.push(`DI${link.di} отсутствует в текущем контроллере.`);
      if (!doIds.has(link.doId)) result.err.push(`DO${link.doId} отсутствует в текущем контроллере.`);

      if (!doUse.has(link.doId)) doUse.set(link.doId, []);
      doUse.get(link.doId).push(link.di);
    }

    for (const [doId, dis] of doUse.entries()) {
      if (dis.length > 1) {
        result.warn.push(`DO${doId} используется несколькими входами: ${dis.map((x) => `DI${x}`).join(", ")}.`);
      }
    }

    const dupDi = getDuplicateNames(state.inputs).size;
    const dupDo = getDuplicateNames(state.outputs).size;
    if (dupDi) result.warn.push(`Есть дубли имен среди DI: ${dupDi}.`);
    if (dupDo) result.warn.push(`Есть дубли имен среди DO: ${dupDo}.`);

    const plan = getPreviewPlan();
    const overwriteCount = plan.filter((x) => x.overwrite).length;
    if (overwriteCount) {
      result.warn.push(`При записи будет перезаписано правил по ID: ${overwriteCount}.`);
    } else {
      result.ok.push("Перезаписи ID не обнаружены.");
    }

    const mismatchedNames = [];
    for (const link of state.connections) {
      const di = state.inputs.find((x) => x.id === link.di);
      const out = state.outputs.find((x) => x.id === link.doId);
      const a = normName(di?.name || "");
      const b = normName(out?.name || "");
      if (a && b && a !== b) {
        mismatchedNames.push(`DI${link.di} ↔ DO${link.doId}`);
      }
    }
    if (mismatchedNames.length) {
      result.warn.push(`Есть связки с разными именами: ${mismatchedNames.slice(0, 8).join(", ")}${mismatchedNames.length > 8 ? " ..." : ""}`);
    } else {
      result.ok.push("У всех именованных пар названия совпадают.");
    }

    if (state.lastAutolinkReport) {
      if (state.lastAutolinkReport.mode) {
        result.ok.push(
          `Последняя автосвязка (${state.lastAutolinkReport.mode}): связано ${state.lastAutolinkReport.linked}, без совпадений ${state.lastAutolinkReport.skippedNoMatch}, неоднозначных ${state.lastAutolinkReport.skippedAmbiguous}.`
        );
      } else if (Array.isArray(state.lastAutolinkReport.notes)) {
        result.warn.push(...state.lastAutolinkReport.notes);
      }
    }

    if (!result.err.length) {
      result.ok.push("Критических ошибок не найдено.");
    }

    return result;
  }

  function linkComment(diObj, doObj) {
    const diName = shortName(diObj?.name || "");
    const doName = shortName(doObj?.name || "");
    const diId = diObj?.id ?? "?";
    const doId = doObj?.id ?? "?";

    if (diName && doName) {
      return normName(diName) === normName(doName)
        ? diName
        : `${diName} → ${doName}`;
    }

    if (diName) return `${diName} → DO${doId}`;
    if (doName) return `DI${diId} → ${doName}`;

    return "";
  }

  function renderLists() {
    const diWrap = document.getElementById("kcs_vm_list_di");
    const doWrap = document.getElementById("kcs_vm_list_do");
    if (!diWrap || !doWrap) return;

    diWrap.innerHTML = "";
    doWrap.innerHTML = "";

    const dupDi = getDuplicateNames(state.inputs);
    const dupDo = getDuplicateNames(state.outputs);

    for (const di of state.inputs) {
      const nameKey = normName(di.name);
      const linked = !!getConnectionByDi(di.id);
      const row = mk(
        "div",
        {
          class:
            "kcs_vm_row" +
            (state.selectedDis.has(di.id) ? " active" : "") +
            (linked ? " linked" : "")
        },
        mk(
          "div",
          { class: "kcs_vm_pickwrap" },
          mk("input", {
            type: "checkbox",
            class: "kcs_vm_pick",
            checked: state.selectedDis.has(di.id),
            onchange: (e) => toggleDiSelection(di.id, e.target.checked)
          })
        ),
        mk("div", { class: "kcs_vm_num" }, `DI${Number.isFinite(di.id) ? di.id : "?"}`),
        mk("div", { class: "kcs_vm_name" }, di.name || mk("span", { class: "kcs_vm_empty" }, "без имени"))
      );

      if (nameKey) {
        row.style.background = colorFromName(di.name);
        row.classList.add("kcs_vm_match");
      }
      if (dupDi.has(nameKey)) row.classList.add("kcs_vm_dup");

      diWrap.appendChild(row);
    }

    for (const doItem of state.outputs) {
      const nameKey = normName(doItem.name);
      const row = mk(
        "div",
        {
          class: "kcs_vm_row" + (state.selectedDos.has(doItem.id) ? " active" : "")
        },
        mk(
          "div",
          { class: "kcs_vm_pickwrap" },
          mk("input", {
            type: "checkbox",
            class: "kcs_vm_pick",
            checked: state.selectedDos.has(doItem.id),
            onchange: (e) => toggleDoSelection(doItem.id, e.target.checked)
          })
        ),
        mk("div", { class: "kcs_vm_num" }, `DO${Number.isFinite(doItem.id) ? doItem.id : "?"}`),
        mk("div", { class: "kcs_vm_name" }, doItem.name || mk("span", { class: "kcs_vm_empty" }, "без имени"))
      );

      if (nameKey) {
        row.style.background = colorFromName(doItem.name);
        row.classList.add("kcs_vm_match");
      }
      if (dupDo.has(nameKey)) row.classList.add("kcs_vm_dup");

      doWrap.appendChild(row);
    }
  }

  function renderLinks() {
    const wrap = document.getElementById("kcs_vm_links");
    if (!wrap) return;

    wrap.innerHTML = "";

    if (!state.connections.length) {
      wrap.appendChild(
        mk("div", { id: "kcs_vm_links_empty" }, "Связок пока нет. Можно выбрать DI и DO вручную, либо использовать автосвязку по именам.")
      );
      return;
    }

    for (const link of state.connections) {
      const di = state.inputs.find((x) => x.id === link.di);
      const out = state.outputs.find((x) => x.id === link.doId);

      const diText = di?.name ? `DI${link.di} · ${di.name}` : `DI${link.di}`;
      const doText = out?.name ? `DO${link.doId} · ${out.name}` : `DO${link.doId}`;
      const comment = linkComment(di, out);

      const item = mk(
        "div",
        { class: "kcs_vm_linkitem" },
        mk(
          "div",
          { class: "kcs_vm_linkstack" },
          mk(
            "div",
            { class: "kcs_vm_linkmain" },
            mk("span", { class: "kcs_vm_tag" }, diText),
            mk("span", { class: "kcs_vm_arrow" }, "→"),
            mk("span", { class: "kcs_vm_tag" }, doText),
            mk("span", { class: "kcs_vm_tag kcs_vm_actiontag" }, link.action)
          ),
          comment ? mk("div", { class: "kcs_vm_linkcomment" }, comment) : null
        ),
        mk(
          "button",
          {
            type: "button",
            class: "kcs_btn kcs_vm_remove",
            onclick: () => {
              removeConnection(link.di, link.doId, link.action);
              renderLinks();
              renderPreview();
              renderValidation();
              renderLists();
            }
          },
          "Удалить"
        )
      );

      wrap.appendChild(item);
    }
  }

  function renderPreview() {
    const preview = document.getElementById("kcs_vm_preview");
    const warn = document.getElementById("kcs_vm_warn");
    if (!preview || !warn) return;

    const plan = getPreviewPlan();
    preview.innerHTML = "";

    if (!plan.length) {
      preview.appendChild(
        mk("div", { class: "kcs_vm_preview_item" }, "Ничего не будет создано. Сначала собери хотя бы одну связку.")
      );
      warn.textContent = "Пока писать нечего.";
      setStatus(`Связок: ${state.connections.length}`);
      return;
    }

    let overwriteCount = 0;
    for (const item of plan) {
      if (item.overwrite) overwriteCount++;
      preview.appendChild(
        mk(
          "div",
          { class: "kcs_vm_preview_item" },
          `${item.id}. ${item.name} | DI${item.di} -> DO${item.doId} | ${item.action}${item.overwrite ? " | ПЕРЕЗАПИСЬ" : ""}`
        )
      );
    }

    const notes = [];
    if (overwriteCount) notes.push(`Под перезапись по ID: ${overwriteCount}`);
    notes.push(`Связок: ${state.connections.length}`);
    warn.textContent = "Предпросмотр перед записью. " + notes.join(" | ");

    setStatus(`Связок: ${state.connections.length} | Подготовлено правил: ${plan.length}`);
  }

  function renderValidation() {
    const wrap = document.getElementById("kcs_vm_validation");
    if (!wrap) return;

    const data = validateConnections();
    state.lastValidation = data;
    wrap.innerHTML = "";

    const items = [];

    for (const x of data.err) items.push({ cls: "err", text: "Ошибка: " + x });
    for (const x of data.warn) items.push({ cls: "warn", text: "Предупреждение: " + x });
    for (const x of data.ok) items.push({ cls: "ok", text: x });

    if (!items.length) {
      items.push({ cls: "ok", text: "Проверка пока ничего не выявила." });
    }

    for (const item of items) {
      wrap.appendChild(
        mk("div", { class: "kcs_vm_validation_item " + item.cls }, item.text)
      );
    }
  }

  function runValidation() {
    renderValidation();
    const errCount = state.lastValidation?.err?.length || 0;
    const warnCount = state.lastValidation?.warn?.length || 0;
    setStatus(`Проверка завершена: ошибок ${errCount}, предупреждений ${warnCount}`);
  }

  async function reloadAll() {
    setBusy(true);
    try {
      setStatus("Читаю входы и выходы...");
      const io = await loadIo();

      setStatus("Читаю существующие правила...");
      const rules = await listRules();

      state.inputs = io.inputs;
      state.outputs = io.outputs;
      state.usedIds = new Set(
        (rules || [])
          .map((r) => parsePositiveInt(r?.id))
          .filter((n) => n !== null)
      );

      state.connections = state.connections.filter((link) => {
        const okDi = state.inputs.some((x) => x.id === link.di);
        const okDo = state.outputs.some((x) => x.id === link.doId);
        return okDi && okDo;
      });

      state.selectedDis = new Set([...state.selectedDis].filter((id) => state.inputs.some((x) => x.id === id)));
      state.selectedDos = new Set([...state.selectedDos].filter((id) => state.outputs.some((x) => x.id === id)));

      renderLists();
      renderLinks();
      renderPreview();
      renderValidation();

      setStatus(`Загружено: DI=${state.inputs.length}, DO=${state.outputs.length}, правил=${state.usedIds.size}`);
    } catch (err) {
      console.error(err);
      setStatus(`Ошибка загрузки: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    runValidation();

    const plan = getPreviewPlan();
    if (!plan.length) {
      alert("Нет правил для записи");
      return;
    }

    const errCount = state.lastValidation?.err?.length || 0;
    const warnCount = state.lastValidation?.warn?.length || 0;
    const overwriteCount = plan.filter((x) => x.overwrite).length;

    const message =
      `Будет записано правил: ${plan.length}\n` +
      `Связок: ${state.connections.length}\n` +
      `Ошибок проверки: ${errCount}\n` +
      `Предупреждений: ${warnCount}\n` +
      (overwriteCount ? `Под перезапись по ID: ${overwriteCount}\n` : "") +
      `\nПродолжить?`;

    if (!confirm(message)) return;

    if (errCount > 0) {
      alert("Есть критические ошибки проверки. Сначала исправь их.");
      return;
    }

    setBusy(true);

    try {
      let saved = 0;

      for (const item of plan) {
        const rule = buildRule({
          id: item.id,
          name: item.name,
          di: item.di,
          doId: item.doId,
          action: item.action
        });

        const result = await postJson("/ifttt/save_channel", rule);
        saved++;

        setStatus(`Записано ${saved}/${plan.length}: ${item.name}`);

        if (result && result.ok === false && !result.code && !result.status) {
          throw new Error(`Не удалось сохранить ${item.name}`);
        }

        await sleep(saved % 10 === 0 ? 500 : 140);
      }

      alert(`Готово. Записано правил: ${saved}`);
      await reloadAll();
    } catch (err) {
      console.error(err);
      alert(`Ошибка записи: ${err?.message || err}`);
      setStatus(`Ошибка записи: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!state.modal || state.busy) return;
    state.modal.style.display = "none";
    setStatus("");
  }

  function bindEvents() {
    document.getElementById("kcs_vm_close")?.addEventListener("click", close);
    document.getElementById("kcs_vm_reload")?.addEventListener("click", reloadAll);
    document.getElementById("kcs_vm_apply")?.addEventListener("click", applyPlan);
    document.getElementById("kcs_vm_link_btn")?.addEventListener("click", linkSelected);
    document.getElementById("kcs_vm_clear_links")?.addEventListener("click", clearConnections);
    document.getElementById("kcs_vm_clear_selection")?.addEventListener("click", clearSelection);
    document.getElementById("kcs_vm_validate_btn")?.addEventListener("click", runValidation);
    document.getElementById("kcs_vm_autolink_btn")?.addEventListener("click", autolinkByNames);

    [
      "kcs_vm_start_id",
      "kcs_vm_action_toggle",
      "kcs_vm_action_on",
      "kcs_vm_action_off",
      "kcs_vm_mass_mode",
      "kcs_vm_autolink_mode"
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        renderPreview();
        renderValidation();
      });
      el.addEventListener("change", () => {
        renderPreview();
        renderValidation();
      });
    });

    document.addEventListener("keydown", (e) => {
      if (!state.modal || state.modal.style.display !== "flex") return;
      if (e.key === "Escape" && !state.busy) close();
    });
  }

  function buildModal() {
    ensureStyles();

    state.modal = mk(
      "div",
      { id: "kcs_vm_overlay" },
      mk(
        "div",
        {
          id: "kcs_vm_card",
          onclick: (e) => e.stopPropagation()
        },

        mk(
          "div",
          { id: "kcs_vm_head" },
          mk("div", { id: "kcs_vm_title" }, "Визуальный редактор маппинга DI → DO"),
          mk("div", { id: "kcs_vm_spacer" }),
          mk("button", { class: "kcs_btn", id: "kcs_vm_close", type: "button" }, "Закрыть")
        ),

        mk(
          "div",
          { id: "kcs_vm_body" },

          mk(
            "div",
            { class: "kcs_vm_col" },
            mk("div", { class: "kcs_vm_colhead" }, "Входы (DI)"),
            mk("div", { class: "kcs_vm_list", id: "kcs_vm_list_di" })
          ),

          mk(
            "div",
            { id: "kcs_vm_center" },
            mk(
              "div",
              { id: "kcs_vm_center_head" },
              mk("div", { id: "kcs_vm_center_title" }, "Связки"),
              mk("div", { id: "kcs_vm_center_note" }, "Один DI - одна связка. Новая заменяет старую.")
            ),
            mk("div", { id: "kcs_vm_links" })
          ),

          mk(
            "div",
            { class: "kcs_vm_col" },
            mk("div", { class: "kcs_vm_colhead" }, "Выходы (DO)"),
            mk("div", { class: "kcs_vm_list", id: "kcs_vm_list_do" })
          ),

          mk(
            "div",
            { id: "kcs_vm_side" },
            mk("div", { id: "kcs_vm_side_head" }, "Параметры"),
            mk(
              "div",
              { id: "kcs_vm_side_body" },

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", null, "Действие"),
                mk(
                  "div",
                  { class: "kcs_vm_checks" },
                  mk("label", null, mk("input", {
                    id: "kcs_vm_action_toggle",
                    type: "radio",
                    name: "kcs_vm_action",
                    checked: true
                  }), "toggle"),
                  mk("label", null, mk("input", {
                    id: "kcs_vm_action_on",
                    type: "radio",
                    name: "kcs_vm_action"
                  }), "on"),
                  mk("label", null, mk("input", {
                    id: "kcs_vm_action_off",
                    type: "radio",
                    name: "kcs_vm_action"
                  }), "off")
                ),
                mk("div", { class: "kcs_vm_hint" }, "Применяется к создаваемым связкам")
              ),

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", { for: "kcs_vm_autolink_mode" }, "Автосвязка по именам"),
                mk(
                  "select",
                  { id: "kcs_vm_autolink_mode" },
                  mk("option", { value: "exact" }, "Строгое соответствие"),
                  mk("option", { value: "loose" }, "Мягкая нормализация"),
                  mk("option", { value: "smart", selected: true }, "Умный подбор")
                ),
                mk("div", { class: "kcs_vm_hint" }, "Умный подбор учитывает одинаковые числа в именах, мягкую нормализацию, совпадение слов и небольшую разницу текстовой части.")
              ),

              mk(
                "div",
                { class: "kcs_vm_actions" },
                mk("button", { class: "kcs_btn", id: "kcs_vm_autolink_btn", type: "button" }, "Связать"),
                mk("button", { class: "kcs_btn", id: "kcs_vm_clear_links", type: "button" }, "Очистить")
              ),

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", { for: "kcs_vm_mass_mode" }, "Массовый режим"),
                mk(
                  "select",
                  { id: "kcs_vm_mass_mode" },
                  mk("option", { value: "pairwise", selected: true }, "DI и DO по порядку"),
                  mk("option", { value: "all_di_to_one_do" }, "Все DI к одному DO")
                )
              ),

              mk(
                "div",
                { class: "kcs_vm_actions" },
                mk("button", { class: "kcs_btn primary", id: "kcs_vm_link_btn", type: "button" }, "Связать выбранное"),
                mk("button", { class: "kcs_btn", id: "kcs_vm_clear_selection", type: "button" }, "Снять выделение")
              ),

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", null, "Стартовый ID"),
                mk("input", {
                  id: "kcs_vm_start_id",
                  type: "text",
                  value: "1",
                  inputmode: "numeric"
                })
              ),

              mk(
                "div",
                { class: "kcs_vm_actions" },
                mk("button", { class: "kcs_btn", id: "kcs_vm_validate_btn", type: "button" }, "Проверить")
              ),

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", null, "Валидация"),
                mk("div", { id: "kcs_vm_validation" })
              ),

              mk(
                "div",
                { class: "kcs_vm_field" },
                mk("label", null, "Предпросмотр записи"),
                mk("div", { id: "kcs_vm_preview" })
              )
            ),
            mk("div", { id: "kcs_vm_warn", class: "kcs_vm_warn" }, "")
          )
        ),

        mk(
          "div",
          { id: "kcs_vm_foot" },
          mk("button", { class: "kcs_btn", id: "kcs_vm_reload", type: "button" }, "Обновить"),
          mk("button", { class: "kcs_btn primary", id: "kcs_vm_apply", type: "button" }, "Применить"),
          mk("div", { id: "kcs_vm_status" }, "")
        )
      )
    );

    document.body.appendChild(state.modal);
    bindEvents();

    state.modal.addEventListener("click", (e) => {
      if (e.target === state.modal && !state.busy) close();
    });
  }

  async function open() {
    if (!state.modal) buildModal();
    state.modal.style.display = "flex";
    await reloadAll();
  }

  window.KCS_VisualMapper = {
    open,
    close,
    reload: reloadAll
  };
})();