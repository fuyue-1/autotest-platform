/* 自动化测试平台 v1.1 前端 */
"use strict";

let CURRENT_USER = "";
let _tipTimer = null;

function isDemoMode() {
  return typeof window !== "undefined" && window.DEMO_MODE === true;
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(v) {
  return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, s => ESC_MAP[s]);
}
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
function tip(msg, isErr) {
  const t = document.getElementById("msgTip");
  if (!t) return;
  t.textContent = msg;
  t.style.display = "block";
  t.style.background = isErr ? "#f5222d" : "#52c41a";
  if (_tipTimer) clearTimeout(_tipTimer);
  _tipTimer = setTimeout(() => { t.style.display = "none"; }, 2600);
}
function statusTag(value) {
  const v = String(value || "");
  const cls = ["启用", "开启", "成功"].includes(v) ? "ok"
    : ["停用", "停止", "失败", "异常"].includes(v) ? "fail" : "warn";
  return `<span class="tag ${cls}">${esc(v)}</span>`;
}

async function rawRequest(method, url, body) {
  if (isDemoMode() && url.startsWith("/api/")) {
    const demo = await window.demoRequest(method, url, body);
    if (demo.status === 401) {
      showLogin();
      throw new Error("登录已过期，请重新登录");
    }
    if (demo.code !== 0) {
      tip(demo.msg || "操作失败", true);
      throw new Error(demo.msg || "操作失败");
    }
    return demo.data;
  }
  const opts = { method, credentials: "same-origin", headers: { "Accept": "application/json" } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, opts);
  } catch (e) {
    throw new Error("无法连接服务器，请确认 app.py 已启动");
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (response.status === 401) {
    showLogin();
    throw new Error("登录已过期，请重新登录");
  }
  if (!data) {
    throw new Error(`服务器返回异常（HTTP ${response.status}）`);
  }
  if (data.code !== 0) {
    tip(data.msg || "操作失败", true);
    throw new Error(data.msg || "操作失败");
  }
  return data.data;
}
function jget(url) { return rawRequest("GET", url); }
function jpost(url, body) { return rawRequest("POST", url, body || {}); }

/* ------------------------------------------------------------------ */
/* 登录 / 会话                                                         */
/* ------------------------------------------------------------------ */
function showLogin() {
  const main = document.getElementById("mainPage");
  const login = document.getElementById("loginPage");
  if (main) main.style.display = "none";
  if (login) login.style.display = "flex";
}
function enterMain() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("mainPage").style.display = "block";
  document.getElementById("whoami").textContent = "当前用户：" + CURRENT_USER + (isDemoMode() ? "（演示模式）" : "");
  buildNav();
  switchPanel("interface");
  if (isDemoMode() && typeof window.demoStartScheduler === "function") {
    window.demoStartScheduler();
  }
}
function loginError(msg) {
  const el = document.getElementById("loginError");
  if (el) el.textContent = msg || "";
}
async function doLogin() {
  loginError("");
  const username = val("loginUser").trim();
  const password = val("loginPwd");
  if (!username || !password) { loginError("请输入用户名和密码"); return; }
  if (isDemoMode()) {
    const demo = await window.demoRequest("POST", "/api/login", { username, password });
    if (demo.code === 0) {
      CURRENT_USER = demo.data.username;
      enterMain();
    } else {
      loginError(demo.msg || "登录失败");
    }
    return;
  }
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (data.code === 0) {
      CURRENT_USER = data.data.username;
      enterMain();
    } else {
      loginError(data.msg || "登录失败");
    }
  } catch (e) {
    loginError("无法连接服务器，请确认 app.py 已启动");
  }
}
async function doRegister() {
  loginError("");
  const username = val("loginUser").trim();
  const password = val("loginPwd");
  if (!username || !password) { loginError("请输入用户名和密码"); return; }
  if (password.length < 6) { loginError("密码长度至少 6 位"); return; }
  if (isDemoMode()) {
    const demo = await window.demoRequest("POST", "/api/register", { username, password });
    if (demo.code === 0) tip("注册成功，请登录");
    else loginError(demo.msg || "注册失败");
    return;
  }
  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (data.code === 0) tip("注册成功，请登录");
    else loginError(data.msg || "注册失败");
  } catch (e) {
    loginError("无法连接服务器，请确认 app.py 已启动");
  }
}
async function doLogout() {
  if (isDemoMode()) {
    if (typeof window.demoStopScheduler === "function") window.demoStopScheduler();
    try { await window.demoRequest("POST", "/api/logout"); } catch (e) { /* ignore */ }
  } else {
    try { await fetch("/api/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  }
  CURRENT_USER = "";
  showLogin();
}
async function restoreSession() {
  try {
    const me = await rawRequest("GET", "/api/me");
    CURRENT_USER = me.username;
    enterMain();
  } catch (e) {
    showLogin();
  }
}

/* ------------------------------------------------------------------ */
/* 模块定义                                                            */
/* ------------------------------------------------------------------ */
const MODULES = [
  {
    key: "interface", name: "接口管理", table: "interface",
    cols: [
      { k: "name", label: "接口名称" }, { k: "chinese_name", label: "接口中文名" },
      { k: "type", label: "接口类型" }, { k: "protocol", label: "协议" },
      { k: "status", label: "状态" }, { k: "create_time", label: "创建时间" }
    ],
    fields: [
      { k: "name", label: "接口名称", required: true },
      { k: "chinese_name", label: "接口中文名" },
      { k: "type", label: "接口类型", type: "select", opts: ["HTTP接口", "WebService", "Socket", "数据库"] },
      { k: "protocol", label: "协议", type: "select", opts: ["HTTP", "HTTPS", "TCP", "SOAP"] },
      { k: "status", label: "状态", type: "select", opts: ["启用", "停用"] }
    ]
  },
  {
    key: "message", name: "报文管理", table: "message",
    cols: [
      { k: "interface_name", label: "接口名" }, { k: "message_name", label: "报文名" },
      { k: "type", label: "报文类型" }, { k: "create_time", label: "创建时间" },
      { k: "content", label: "报文内容", render: r => `<span title="${esc(r.content)}">${esc(String(r.content || "").slice(0, 40))}${String(r.content || "").length > 40 ? "…" : ""}</span>` }
    ],
    fields: [
      { k: "interface_name", label: "接口名", required: true },
      { k: "message_name", label: "报文名", required: true },
      { k: "type", label: "报文类型", type: "select", opts: ["JSON", "XML", "报文文本"] },
      { k: "content", label: "报文内容", type: "textarea", ph: "GET /api/user/list\nContent-Type: application/json\n\n{\"name\":\"test\"}；支持 ${变量名} 替换" },
      { k: "operation", label: "操作记录", type: "textarea" }
    ]
  },
  {
    key: "scene", name: "组合场景", table: "scene",
    cols: [
      { k: "name", label: "场景名称" },
      { k: "message_ids", label: "关联报文", render: r => `${String(r.message_ids || "").split(",").filter(Boolean).length} 条` },
      { k: "independent_client", label: "独立客户端测试" },
      { k: "create_time", label: "创建时间" }, { k: "remark", label: "备注" }
    ],
    fields: [
      { k: "name", label: "场景名称", required: true },
      { k: "independent_client", label: "独立客户端测试", type: "select", opts: ["是", "否"] },
      { k: "remark", label: "备注", type: "textarea" },
      { k: "message_ids", label: "关联报文", type: "multimsg" }
    ]
  },
  {
    key: "testset", name: "测试集管理", table: "testset",
    cols: [
      {
        k: "name", label: "名称", render: r => {
          const depth = Number(r._depth || 0);
          const icon = r.type === "目录" ? "[目录]" : "[测试集]";
          return `${"　".repeat(depth)}${icon} ${esc(r.name)}`;
        }
      },
      { k: "type", label: "类型" }, { k: "status", label: "状态" },
      { k: "scene_ids", label: "包含场景", render: r => `${String(r.scene_ids || "").split(",").filter(Boolean).length} 个` },
      { k: "create_time", label: "创建时间" }
    ],
    fields: [
      { k: "name", label: "名称", required: true },
      { k: "type", label: "类型", type: "select", opts: ["目录", "测试集"] },
      { k: "parent_dir_id", label: "父目录", type: "parent" },
      { k: "status", label: "状态", type: "select", opts: ["启用", "停用"] },
      { k: "scene_ids", label: "关联组合场景", type: "multiscene" }
    ]
  },
  {
    key: "task", name: "定时任务", table: "task",
    cols: [
      { k: "name", label: "任务名称" }, { k: "type", label: "任务类型" },
      { k: "testset", label: "测试集" },
      { k: "cron_expression", label: "定时规则", render: r => `${esc(r.cron_expression || "")}${r.cron_valid ? "" : ' <span class="tag fail">无效</span>'}` },
      { k: "execute_count", label: "已执行次数" }, { k: "last_execute_time", label: "最后执行时间" },
      { k: "status", label: "开启状态" }, { k: "create_user", label: "创建用户" }
    ],
    fields: [
      { k: "name", label: "任务名称", required: true },
      { k: "type", label: "任务类型", type: "select", opts: ["测试集执行", "数据清理"] },
      { k: "testset", label: "测试集", type: "select-ts-name", required: true },
      { k: "cron_expression", label: "定时规则(cron)", ph: "*/5 * * * * 每5分钟；0 8 * * * 每天8点（开启时必填）" },
      { k: "status", label: "开启状态", type: "select", opts: ["开启", "停止"] },
      { k: "email_notify", label: "邮件通知", type: "select", opts: ["是", "否"] },
      { k: "create_user", label: "创建用户", readonly: true }
    ]
  },
  {
    key: "datapool", name: "数据池", table: "datapool",
    cols: [
      { k: "name", label: "数据池名称" }, { k: "type", label: "类型" },
      { k: "create_time", label: "创建时间" }
    ],
    fields: [
      { k: "name", label: "数据池名称", required: true },
      { k: "type", label: "类型", type: "select", opts: ["CSV", "Excel", "SQL结果集"] },
      { k: "content", label: "数据内容", type: "textarea", ph: "每行一条测试数据" }
    ]
  },
  {
    key: "env", name: "测试环境", table: "env",
    cols: [
      { k: "name", label: "环境名称" }, { k: "ip", label: "IP地址" },
      { k: "protocol", label: "协议类型" }, { k: "use_proxy", label: "使用代理" },
      { k: "proxy_address", label: "代理地址" }
    ],
    fields: [
      { k: "name", label: "环境名称", required: true },
      { k: "ip", label: "IP地址(或域名:端口)", required: true, ph: "127.0.0.1:8080" },
      { k: "protocol", label: "协议类型", type: "select", opts: ["HTTP", "HTTPS", "TCP", "SOAP"] },
      { k: "use_proxy", label: "是否使用代理", type: "select", opts: ["N", "Y"] },
      { k: "proxy_address", label: "代理地址", ph: "http://127.0.0.1:8888" }
    ]
  },
  {
    key: "variable", name: "变量模板", table: "variable",
    cols: [
      { k: "name", label: "变量名" }, { k: "value", label: "变量值" },
      { k: "remark", label: "备注" }, { k: "create_time", label: "创建时间" }
    ],
    fields: [
      { k: "name", label: "变量名", required: true, ph: "例如 base_url" },
      { k: "value", label: "变量值", required: true },
      { k: "remark", label: "备注" }
    ]
  },
  {
    key: "datasource", name: "数据源配置", table: "datasource",
    cols: [
      { k: "type", label: "数据源类型" }, { k: "db_name", label: "数据库名" },
      { k: "username", label: "用户名" }, { k: "address", label: "地址" },
      { k: "remark", label: "备注" }
    ],
    fields: [
      { k: "type", label: "数据源类型", type: "select", opts: ["MySQL", "Oracle", "SQLServer", "PostgreSQL"] },
      { k: "db_name", label: "数据库名", required: true },
      { k: "username", label: "用户名", required: true },
      { k: "password", label: "密码", type: "password", required: true },
      { k: "address", label: "地址", required: true, ph: "127.0.0.1:3306" },
      { k: "remark", label: "备注" }
    ]
  }
];

const PAGES = [
  { key: "execute", name: "测试执行" },
  { key: "report", name: "测试报告" },
  { key: "jsonfmt", name: "JSON格式化" },
  { key: "xmlfmt", name: "XML格式化" },
  { key: "dashboard", name: "测试报表" }
];

function modKey(table) {
  return {
    interface: "interface_id", message: "message_id", scene: "scene_id",
    testset: "testset_id", report: "report_id", task: "task_id",
    env: "env_id", datasource: "datasource_id", datapool: "pool_id", variable: "variable_id"
  }[table];
}

/* ------------------------------------------------------------------ */
/* 导航                                                                */
/* ------------------------------------------------------------------ */
function buildNav() {
  const nav = document.getElementById("nav");
  let html = "";
  MODULES.forEach(m => { html += `<div class="item" data-k="${m.key}">${esc(m.name)}</div>`; });
  PAGES.forEach(p => { html += `<div class="item" data-k="${p.key}">${esc(p.name)}</div>`; });
  nav.innerHTML = html;
  nav.querySelectorAll(".item").forEach(el => { el.onclick = () => switchPanel(el.dataset.k); });
}

async function switchPanel(key) {
  document.querySelectorAll("nav .item").forEach(e => e.classList.toggle("active", e.dataset.k === key));
  const main = document.getElementById("main");
  const mod = MODULES.find(m => m.key === key);
  try {
    if (mod) {
      main.innerHTML = listPanelHTML(mod);
      bindListPanel(mod);
      await loadList(mod);
      return;
    }
    if (key === "execute") return await renderExecute(main);
    if (key === "report") return await renderReport(main);
    if (key === "jsonfmt") return renderJsonFmt(main);
    if (key === "xmlfmt") return renderXmlFmt(main);
    if (key === "dashboard") return await renderDashboard(main);
  } catch (e) {
    main.innerHTML = `<div class="panel active"><h3>加载失败</h3><div class="empty">${esc(e.message)}</div></div>`;
  }
}

/* ------------------------------------------------------------------ */
/* 通用列表                                                            */
/* ------------------------------------------------------------------ */
function listPanelHTML(mod) {
  return `<div class="panel active"><h3>${esc(mod.name)}</h3>
    <div class="toolbar">
      <input type="text" id="kw" placeholder="搜索关键字" onkeyup="if(event.key==='Enter')searchList()">
      <button class="btn" onclick="searchList()">搜索</button>
      <button class="btn green" onclick="openForm('${mod.key}')">＋ 添加</button>
      <span id="listCount" style="color:#999;font-size:13px"></span>
    </div>
    <div id="listBody" class="table-wrap">加载中…</div></div>`;
}

function bindListPanel(mod) {
  window._currentMod = mod;
}

async function searchList() {
  if (window._currentMod) await loadList(window._currentMod, val("kw").trim());
}

function orderTestsets(rows) {
  const list = rows.map(r => Object.assign({}, r));
  const byParent = new Map();
  list.forEach(r => {
    const p = r.parent_dir_id === null || r.parent_dir_id === undefined || r.parent_dir_id === "" ? 0 : Number(r.parent_dir_id);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r);
  });
  const out = [];
  const seen = new Set();
  function walk(parent, depth) {
    const children = byParent.get(parent) || [];
    children.sort((a, b) => a.testset_id - b.testset_id);
    children.forEach(child => {
      if (seen.has(child.testset_id)) return;
      seen.add(child.testset_id);
      child._depth = depth;
      out.push(child);
      walk(Number(child.testset_id), depth + 1);
    });
  }
  walk(0, 0);
  list.forEach(r => {
    if (!seen.has(r.testset_id)) { r._depth = 0; out.push(r); }
  });
  return out;
}

async function loadList(mod, kw) {
  const listEl = document.getElementById("listBody");
  if (!listEl || !mod) return;
  const keyword = kw !== undefined ? kw : val("kw").trim();
  listEl.innerHTML = `<div class="empty">加载中…</div>`;
  let data;
  try {
    data = await jget(`/api/${mod.table}/list` + (keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""));
  } catch (e) {
    if (document.body.contains(listEl)) listEl.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
    return;
  }
  if (!document.body.contains(listEl)) return;
  if (!Array.isArray(data)) data = [];
  if (mod.key === "testset") data = orderTestsets(data);
  const countEl = document.getElementById("listCount");
  if (countEl) countEl.textContent = `共 ${data.length} 条`;
  if (!data.length) {
    listEl.innerHTML = `<div class="empty">暂无数据，点击「＋ 添加」新增</div>`;
    return;
  }
  let html = `<table><tr>${mod.cols.map(c => `<th>${esc(c.label)}</th>`).join("")}<th>操作</th></tr>`;
  data.forEach(row => {
    html += "<tr>" + mod.cols.map(c => {
      if (c.render) return `<td>${c.render(row)}</td>`;
      const value = row[c.k];
      if (c.k === "status") return `<td>${statusTag(value)}</td>`;
      return `<td>${esc(value)}</td>`;
    }).join("");
    const pk = modKey(mod.table);
    const id = row[pk];
    html += `<td><span class="op" onclick="openForm('${mod.key}', ${Number(id)})">编辑</span>
      <span class="op danger" onclick="delRow('${mod.key}', ${Number(id)})">删除</span></td></tr>`;
  });
  listEl.innerHTML = html + "</table>";
}

/* ------------------------------------------------------------------ */
/* 通用表单                                                            */
/* ------------------------------------------------------------------ */
function maskHTML(inner, wide) {
  const dialog = document.getElementById("dialog");
  dialog.className = "dialog" + (wide ? " wide" : "");
  dialog.innerHTML = inner;
  document.getElementById("mask").classList.add("show");
}
function closeMask() {
  document.getElementById("mask").classList.remove("show");
}

async function fieldHTML(f, row, id) {
  const required = f.required && !(f.type === "password" && id);
  const star = required ? " *" : "";
  if (f.type === "multimsg" || f.type === "multiscene") {
    const isMsg = f.type === "multimsg";
    const listName = isMsg ? "message" : "scene";
    const pk = isMsg ? "message_id" : "scene_id";
    const labelCol = isMsg ? "message_name" : "name";
    const items = (await jget(`/api/${listName}/list`)) || [];
    const selected = new Set(String(row[f.k] || "").split(",").filter(Boolean));
    return `<div style="grid-column:1/-1"><label>${esc(f.label)}</label>
      <select id="f_${f.k}" multiple size="6" style="height:auto">
        ${items.map(i => `<option value="${Number(i[pk])}" ${selected.has(String(i[pk])) ? "selected" : ""}>${esc(i[labelCol])} #${Number(i[pk])}</option>`).join("")}
      </select><span class="hint">按住 Ctrl / Shift 多选</span></div>`;
  }
  if (f.type === "select-ts-name") {
    let items = await jget("/api/testset/list");
    items = (items || []).filter(i => i.type === "测试集");
    const current = row[f.k] || "";
    if (current && !items.some(i => i.name === current)) items.unshift({ name: current });
    return `<div><label>${esc(f.label)}${star}</label><select id="f_${f.k}">
      ${items.length ? items.map(i => `<option value="${esc(i.name)}" ${current === i.name ? "selected" : ""}>${esc(i.name)}</option>`).join("") : `<option value="">请先创建测试集</option>`}
    </select></div>`;
  }
  if (f.type === "parent") {
    let items = await jget("/api/testset/list");
    items = (items || []).filter(i => i.type === "目录" && Number(i.testset_id) !== Number(id || 0));
    const current = row[f.k] === null || row[f.k] === undefined ? "" : String(row[f.k]);
    return `<div><label>${esc(f.label)}</label><select id="f_${f.k}">
      <option value="">（根目录）</option>
      ${items.map(i => `<option value="${Number(i.testset_id)}" ${current === String(i.testset_id) ? "selected" : ""}>${esc(i.name)}</option>`).join("")}
    </select></div>`;
  }
  if (f.type === "textarea") {
    return `<div style="grid-column:1/-1"><label>${esc(f.label)}${star}</label>
      <textarea id="f_${f.k}" placeholder="${esc(f.ph || "")}">${esc(row[f.k])}</textarea></div>`;
  }
  if (f.type === "select") {
    const current = row[f.k] === null || row[f.k] === undefined ? "" : String(row[f.k]);
    let opts = (f.opts || []).slice();
    if (current && !opts.includes(current)) opts.unshift(current);
    return `<div><label>${esc(f.label)}${star}</label><select id="f_${f.k}">
      ${opts.map(o => `<option value="${esc(o)}" ${current === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select></div>`;
  }
  if (f.type === "password") {
    return `<div><label>${esc(f.label)}${star}</label>
      <input type="password" id="f_${f.k}" value="" placeholder="${id && row.has_password ? "已设置，留空则不修改" : "请输入密码"}">
      ${id && row.has_password ? `<div class="hint">已保存密码，留空表示不修改</div>` : ""}</div>`;
  }
  return `<div><label>${esc(f.label)}${star}</label>
    <input id="f_${f.k}" value="${esc(row[f.k])}" placeholder="${esc(f.ph || "")}" ${f.readonly ? "readonly" : ""}></div>`;
}

async function openForm(key, id) {
  const mod = MODULES.find(m => m.key === key);
  if (!mod) return;
  let row = {};
  if (id) {
    try { row = (await jget(`/api/${mod.table}/get/${id}`)) || {}; }
    catch (e) { return; }
  }
  let inner = `<h4>${id ? "编辑" : "添加"}${esc(mod.name)}</h4><div class="form-grid">`;
  try {
    for (const f of mod.fields) inner += await fieldHTML(f, row, id);
  } catch (e) {
    tip("加载表单选项失败：" + e.message, true);
    return;
  }
  inner += `</div><div class="foot"><button class="btn gray" onclick="closeMask()">取消</button>
    <button class="btn" onclick="saveForm('${mod.key}', ${id || "null"})">保存</button></div>`;
  maskHTML(inner);
  if (mod.key === "testset") {
    const typeEl = document.getElementById("f_type");
    if (typeEl) typeEl.onchange = toggleTestsetFields;
    toggleTestsetFields();
  }
}

function toggleTestsetFields() {
  const type = document.getElementById("f_type");
  const scenes = document.getElementById("f_scene_ids");
  if (type && scenes) scenes.disabled = type.value === "目录";
}

async function saveForm(key, id) {
  const mod = MODULES.find(m => m.key === key);
  if (!mod) return;
  const body = {};
  for (const f of mod.fields) {
    const el = document.getElementById("f_" + f.k);
    if (!el || el.disabled) continue;
    const value = el.multiple ? [...el.selectedOptions].map(o => o.value).join(",") : el.value;
    if (f.type === "password" && id && !value) continue;
    if (f.required && String(value).trim() === "" && !(f.type === "password" && id)) {
      tip(`${f.label}不能为空`, true);
      return;
    }
    body[f.k] = value;
  }
  if (mod.key === "task" && !body.create_user) body.create_user = CURRENT_USER;
  try {
    await jpost(`/api/${mod.table}/save`, body);
    closeMask();
    tip(id ? "修改成功" : "添加成功");
    if (window._currentMod === mod && document.getElementById("listBody")) await loadList(mod);
  } catch (e) { /* jpost 已提示 */ }
}

async function delRow(key, id) {
  const mod = key === "report" ? { table: "report" } : MODULES.find(m => m.key === key);
  if (!mod) return;
  if (!confirm("确定删除该条记录？")) return;
  try {
    await jpost(`/api/${mod.table}/del`, { [modKey(mod.table)]: id });
    tip("删除成功");
    const active = document.querySelector("nav .item.active");
    if (active) await switchPanel(active.dataset.k);
  } catch (e) { /* jpost 已提示 */ }
}

/* ------------------------------------------------------------------ */
/* 测试执行                                                            */
/* ------------------------------------------------------------------ */
async function renderExecute(main) {
  const [testsets, envs] = await Promise.all([jget("/api/testset/list"), jget("/api/env/list")]);
  const runSets = (testsets || []).filter(t => t.type === "测试集");
  main.innerHTML = `<div class="panel active"><h3>测试执行</h3>
    <div class="form-grid">
      <div><label>选择测试集</label><select id="execTs">
        ${runSets.length
          ? `<option value="">请选择测试集</option>` + runSets.map(t => `<option value="${Number(t.testset_id)}">${esc(t.name)}</option>`).join("")
          : `<option value="">请先创建测试集</option>`}
      </select></div>
      <div><label>选择测试环境</label><select id="execEnv">
        ${(envs || []).length
          ? envs.map(e => `<option value="${Number(e.env_id)}">${esc(e.name)}（${esc(e.protocol)}://${esc(e.ip)}）</option>`).join("")
          : `<option value="">请先配置测试环境</option>`}
      </select></div>
    </div>
    <div class="toolbar" style="margin-top:16px">
      <button class="btn green" id="runBtn" onclick="runExec()">▶ 执行测试</button>
      <span class="hint" id="execHint">${isDemoMode() ? "演示模式：执行结果为前端模拟，不会发送真实请求" : ""}</span>
    </div>
    <div id="execResult"></div></div>`;
}

async function runExec() {
  const testsetId = val("execTs");
  const envId = val("execEnv");
  if (!testsetId) { tip("请先选择测试集", true); return; }
  const btn = document.getElementById("runBtn");
  const hint = document.getElementById("execHint");
  if (btn) { btn.disabled = true; btn.textContent = "执行中…"; }
  if (hint) hint.textContent = isDemoMode() ? "正在生成模拟报告，请稍候…" : "正在发送请求并生成报告，请稍候…";
  try {
    const report = await jpost("/api/execute/run", {
      testset_id: Number(testsetId),
      env_id: envId ? Number(envId) : null
    });
    document.getElementById("execResult").innerHTML = `
      <table><tr><th>报告ID</th><th>场景数</th><th>成功</th><th>失败</th><th>异常中断</th><th>成功率</th><th>状态</th><th>耗时(ms)</th><th>操作</th></tr>
      <tr><td>${Number(report.report_id)}</td><td>${Number(report.scene_count)}</td>
      <td><span class="tag ok">${Number(report.success_count)}</span></td>
      <td><span class="tag fail">${Number(report.fail_count)}</span></td>
      <td><span class="tag warn">${Number(report.exception_count)}</span></td>
      <td><b>${Number(report.success_rate)}%</b></td><td>${esc(report.status)}</td><td>${Number(report.cost_time)}</td>
      <td><span class="op" onclick="viewReport(${Number(report.report_id)})">查看明细</span></td></tr></table>`;
    tip("执行完成，报告已生成");
  } catch (e) {
    tip(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "▶ 执行测试"; }
    if (hint) hint.textContent = "";
  }
}

/* ------------------------------------------------------------------ */
/* 测试报告                                                            */
/* ------------------------------------------------------------------ */
async function renderReport(main) {
  const data = await jget("/api/report/list");
  main.innerHTML = `<div class="panel active"><h3>测试报告</h3>
    <div class="toolbar"><button class="btn" onclick="switchPanel('report')">刷新</button></div>
    <div id="reportBody" class="table-wrap">${(data || []).length ? reportTable(data) : `<div class="empty">暂无报告，请先在「测试执行」中执行测试</div>`}</div></div>`;
}

function reportTable(data) {
  let html = `<table><tr><th>报告ID</th><th>测试场景数</th><th>成功数</th><th>失败数</th><th>异常中断数</th>
    <th>成功率</th><th>测试环境</th><th>执行日期</th><th>状态</th><th>耗时(ms)</th><th>操作</th></tr>`;
  data.forEach(r => {
    const rate = Number(r.success_rate || 0);
    const cls = rate >= 90 ? "ok" : rate >= 60 ? "warn" : "fail";
    html += `<tr><td>${Number(r.report_id)}</td><td>${Number(r.scene_count)}</td>
      <td><span class="tag ok">${Number(r.success_count)}</span></td>
      <td><span class="tag fail">${Number(r.fail_count)}</span></td>
      <td><span class="tag warn">${Number(r.exception_count)}</span></td>
      <td><span class="tag ${cls}">${rate}%</span></td>
      <td>${esc(r.env || "-")}</td><td>${esc(r.execute_date)}</td><td>${esc(r.status || "-")}</td>
      <td>${r.cost_time === null ? "-" : Number(r.cost_time)}</td>
      <td><span class="op" onclick="viewReport(${Number(r.report_id)})">查看</span>
      <span class="op danger" onclick="delRow('report', ${Number(r.report_id)})">删除</span></td></tr>`;
  });
  return html + "</table>";
}

async function viewReport(id) {
  let payload;
  try { payload = await jget(`/api/report/detail/${id}`); }
  catch (e) { return; }
  const report = payload.report || {};
  const details = payload.details || [];
  let html = `<h4>测试报告详情 #${Number(id)}</h4>
    <table>
      <tr><th>接口名</th><td>${esc(report.interface_name || "-")}</td><th>协议</th><td>${esc(report.protocol || "-")}</td></tr>
      <tr><th>格式</th><td>${esc(report.format || "-")}</td><th>报文</th><td>${esc(report.message || "-")}</td></tr>
      <tr><th>场景</th><td>${esc(report.scene || "-")}</td><th>测试环境</th><td>${esc(report.env || "-")}</td></tr>
      <tr><th>场景数</th><td>${Number(report.scene_count)}</td><th>成功率</th><td><b>${Number(report.success_rate)}%</b></td></tr>
      <tr><th>成功/失败/异常</th><td>${Number(report.success_count)} / ${Number(report.fail_count)} / ${Number(report.exception_count)}</td><th>耗时</th><td>${Number(report.cost_time)} ms</td></tr>
    </table>`;
  if (details.length) {
    html += `<h4 style="margin-top:20px">逐条执行明细</h4><div class="table-wrap"><table>
      <tr><th>场景</th><th>报文</th><th>接口</th><th>协议</th><th>状态</th><th>响应码</th><th>耗时(ms)</th><th>响应/错误</th></tr>`;
    details.forEach(d => {
      html += `<tr><td>${esc(d.scene_name)}</td><td>${esc(d.message_name)}</td><td>${esc(d.interface_name)}</td>
        <td>${esc(d.protocol)}</td><td>${statusTag(d.status)}</td><td>${esc(d.response_code || "-")}</td>
        <td>${Number(d.cost_time)}</td><td><pre class="detail">${esc(d.detail || "")}</pre></td></tr>`;
    });
    html += `</table></div>`;
  } else {
    html += `<div class="hint" style="margin-top:14px">该报告由旧版本生成，没有逐条明细。</div>`;
  }
  html += `<div class="foot" style="text-align:right;margin-top:16px"><button class="btn gray" onclick="closeMask()">关闭</button></div>`;
  maskHTML(html, true);
}

/* ------------------------------------------------------------------ */
/* JSON / XML 格式化                                                   */
/* ------------------------------------------------------------------ */
function renderJsonFmt(main) {
  main.innerHTML = `<div class="panel active"><h3>JSON 格式化</h3>
    <div class="fmt-wrap"><div class="cols">
      <div><label>输入</label><textarea id="jsonIn" placeholder='{"name":"自动化测试平台","version":1.1}'></textarea></div>
      <div><label>格式化结果</label><textarea id="jsonOut" readonly></textarea></div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn" onclick="fmtJson(2)">格式化(2空格)</button>
      <button class="btn orange" onclick="fmtJson(0)">压缩</button>
      <button class="btn green" onclick="checkJson()">校验合法性</button>
      <button class="btn gray" onclick="clearJson()">清空</button>
    </div><div id="jsonMsg" style="margin-top:8px"></div></div></div>`;
}
function fmtJson(indent) {
  const source = val("jsonIn");
  const msg = document.getElementById("jsonMsg");
  if (!source.trim()) { msg.innerHTML = `<span class="tag fail">请输入 JSON 内容</span>`; return; }
  try {
    const obj = JSON.parse(source);
    document.getElementById("jsonOut").value = indent ? JSON.stringify(obj, null, indent) : JSON.stringify(obj);
    msg.innerHTML = `<span class="tag ok">JSON 合法</span>`;
  } catch (e) {
    msg.innerHTML = `<span class="tag fail">JSON 非法：${esc(e.message)}</span>`;
  }
}
function checkJson() { fmtJson(2); }
function clearJson() {
  document.getElementById("jsonIn").value = "";
  document.getElementById("jsonOut").value = "";
  document.getElementById("jsonMsg").innerHTML = "";
}

function xmlEscape(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function prettyXml(node, level) {
  const pad = "  ".repeat(level);
  if (node.nodeType === 3) {
    const text = node.nodeValue.trim();
    return text ? pad + xmlEscape(text) + "\n" : "";
  }
  if (node.nodeType === 4) return pad + "<![CDATA[" + node.nodeValue + "]]>\n";
  if (node.nodeType === 8) return pad + "<!--" + node.nodeValue + "-->\n";
  if (node.nodeType === 9) {
    let out = "";
    node.childNodes.forEach(child => { out += prettyXml(child, level); });
    return out;
  }
  if (node.nodeType !== 1) return "";
  const attrs = Array.from(node.attributes || []).map(a => ` ${a.name}="${xmlEscape(a.value)}"`).join("");
  const children = Array.from(node.childNodes).filter(n => n.nodeType !== 3 || n.nodeValue.trim());
  if (!children.length) return `${pad}<${node.nodeName}${attrs}/>\n`;
  if (children.length === 1 && children[0].nodeType === 3) {
    return `${pad}<${node.nodeName}${attrs}>${xmlEscape(children[0].nodeValue.trim())}</${node.nodeName}>\n`;
  }
  let out = `${pad}<${node.nodeName}${attrs}>\n`;
  children.forEach(child => { out += prettyXml(child, level + 1); });
  out += `${pad}</${node.nodeName}>\n`;
  return out;
}
function renderXmlFmt(main) {
  main.innerHTML = `<div class="panel active"><h3>XML 格式化</h3>
    <div class="fmt-wrap"><div class="cols">
      <div><label>输入</label><textarea id="xmlIn" placeholder="<root><name>自动化测试平台</name></root>"></textarea></div>
      <div><label>格式化结果</label><textarea id="xmlOut" readonly></textarea></div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn" onclick="fmtXml()">格式化</button>
      <button class="btn orange" onclick="minifyXml()">压缩</button>
      <button class="btn green" onclick="checkXml()">校验合法性</button>
      <button class="btn gray" onclick="clearXml()">清空</button>
    </div><div id="xmlMsg" style="margin-top:8px"></div></div></div>`;
}
function parseXmlSource() {
  const source = val("xmlIn").trim();
  const msg = document.getElementById("xmlMsg");
  if (!source) { msg.innerHTML = `<span class="tag fail">请输入 XML 内容</span>`; return null; }
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    msg.innerHTML = `<span class="tag fail">XML 非法：${esc(err.textContent.trim().split("\n")[0])}</span>`;
    return null;
  }
  msg.innerHTML = `<span class="tag ok">XML 合法</span>`;
  return { doc, source };
}
function fmtXml() {
  const parsed = parseXmlSource();
  if (!parsed) return;
  let out = "";
  if (/^\s*<\?xml/i.test(parsed.source)) out += `<?xml version="1.0" encoding="UTF-8"?>\n`;
  parsed.doc.childNodes.forEach(child => { out += prettyXml(child, 0); });
  document.getElementById("xmlOut").value = out;
}
function minifyXml() {
  const parsed = parseXmlSource();
  if (!parsed) return;
  const text = new XMLSerializer().serializeToString(parsed.doc).replace(/>\s+</g, "><").trim();
  document.getElementById("xmlOut").value = text;
}
function checkXml() { fmtXml(); }
function clearXml() {
  document.getElementById("xmlIn").value = "";
  document.getElementById("xmlOut").value = "";
  document.getElementById("xmlMsg").innerHTML = "";
}

/* ------------------------------------------------------------------ */
/* 测试报表                                                            */
/* ------------------------------------------------------------------ */
async function renderDashboard(main) {
  const [summary, stats] = await Promise.all([jget("/api/report/summary"), jget("/api/stats")]);
  const t = summary.totals || {};
  main.innerHTML = `<div class="panel active"><h3>测试报表</h3>
    <div class="stat-cards">
      <div class="stat-card"><div class="num" style="color:#2f6fed">${Number(t.total || 0)}</div><div class="label">报告总数</div></div>
      <div class="stat-card"><div class="num" style="color:#52c41a">${Number(t.success || 0)}</div><div class="label">累计成功用例</div></div>
      <div class="stat-card"><div class="num" style="color:#f5222d">${Number(t.fail || 0)}</div><div class="label">累计失败用例</div></div>
      <div class="stat-card"><div class="num" style="color:#fa8c16">${Number(t.exception || 0)}</div><div class="label">累计异常中断</div></div>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${Number(stats.interface || 0)}</div><div class="label">接口数</div></div>
      <div class="stat-card"><div class="num">${Number(stats.message || 0)}</div><div class="label">报文数</div></div>
      <div class="stat-card"><div class="num">${Number(stats.scene || 0)}</div><div class="label">组合场景数</div></div>
      <div class="stat-card"><div class="num">${Number(stats.testset || 0)}</div><div class="label">测试集数</div></div>
    </div>
    <div class="chart-box"><canvas id="rateChart"></canvas></div>
    <div style="margin-top:10px" id="dashTable" class="table-wrap"></div></div>`;
  if (window._chart) { try { window._chart.destroy(); } catch (e) { /* ignore */ } }
  const labels = (summary.by_date || []).map(x => x.d);
  const values = (summary.by_date || []).map(x => Number(x.rate || 0));
  if (typeof Chart === "undefined") {
    const canvas = document.getElementById("rateChart");
    if (canvas) canvas.outerHTML = `<div class="empty">图表库未加载（请确认 /static/chart.umd.min.js 可访问）</div>`;
  } else {
    const ctx = document.getElementById("rateChart");
    if (ctx) {
      window._chart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "每日平均成功率(%)", data: values,
            borderColor: "#2f6fed", backgroundColor: "rgba(47,111,237,.15)", fill: true, tension: .35
          }]
        },
        options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } }
      });
    }
  }
  const reports = await jget("/api/report/list");
  document.getElementById("dashTable").innerHTML = (reports || []).length
    ? `<h4 style="margin:8px 0">最近报告</h4>` + reportTable((reports || []).slice(0, 10))
    : `<div class="empty">暂无报告</div>`;
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
function boot() {
  const pwd = document.getElementById("loginPwd");
  if (pwd) pwd.addEventListener("keyup", e => { if (e.key === "Enter") doLogin(); });
  const mask = document.getElementById("mask");
  if (mask) mask.addEventListener("click", e => { if (e.target.id === "mask") closeMask(); });
  if (isDemoMode()) {
    const tipEl = document.getElementById("loginTip");
    if (tipEl) {
      tipEl.innerHTML = '演示账号：admin / admin123　·　在线演示模式（数据保存在当前浏览器）' +
        '　·　<a href="#" onclick="window.demoReset();return false;">重置演示数据</a>';
    }
  }
  restoreSession();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
