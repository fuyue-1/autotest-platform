/*!
 * 自动化测试平台 - GitHub Pages 前端演示模式
 * ------------------------------------------------------------
 * GitHub Pages 只能托管静态文件，不能运行 Flask/Python。
 * 因此在 github.io、file:// 或带 ?demo=1 时启用本文件：
 *   - 数据保存在浏览器 localStorage；
 *   - 接口、报文、场景、测试集、执行、报告、任务等全部在前端模拟；
 *   - 不会向任何服务器发送真实请求。
 * 本地 python app.py 启动时不会进入演示模式，使用真实 Flask 后端。
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const isPages = /\.github\.io$/i.test(window.location.hostname);
  const isFile = window.location.protocol === "file:";
  window.DEMO_MODE = isPages || isFile || params.get("demo") === "1";
  if (!window.DEMO_MODE) return;

  const STORAGE_KEY = "autotest_platform_demo_v1";

  const RES = {
    interface: { pk: "interface_id", required: ["name"], defaults: { status: "启用" } },
    message: { pk: "message_id", required: ["interface_name", "message_name"], defaults: {} },
    scene: { pk: "scene_id", required: ["name"], defaults: { independent_client: "否", include_scene_count: 0 } },
    testset: { pk: "testset_id", required: ["name", "type"], defaults: { status: "启用" } },
    task: { pk: "task_id", required: ["name", "testset"], defaults: { status: "开启", execute_count: 0, email_notify: "否" } },
    env: { pk: "env_id", required: ["name", "ip", "protocol"], defaults: { use_proxy: "N" } },
    datasource: { pk: "datasource_id", required: ["type", "db_name", "username", "password", "address"], defaults: {} },
    datapool: { pk: "pool_id", required: ["name"], defaults: { type: "CSV" } },
    variable: { pk: "variable_id", required: ["name", "value"], defaults: {} },
    report: { pk: "report_id", required: [], defaults: {}, readonly: true },
  };

  const LABEL = {
    name: "名称", interface_name: "接口名", message_name: "报文名", testset: "测试集",
    db_name: "数据库名", username: "用户名", password: "密码", address: "地址",
    ip: "IP地址", protocol: "协议类型", value: "变量值", type: "类型",
  };

  let db = null;
  let timer = null;

  function pad(n) { return String(n).padStart(2, "0"); }
  function nowStr(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function seed() {
    const t = nowStr();
    const d = todayStr();
    db = {
      version: 1,
      session: null,
      seq: {
        interface: 1, message: 5, scene: 1, testset: 1, task: 1, env: 1,
        datapool: 1, variable: 1, datasource: 1, report: 1, report_detail: 5,
      },
      users: [{ username: "admin", password: "admin123", role: "admin" }],
      interface: [{
        interface_id: 1, name: "demo_api", chinese_name: "演示接口", type: "HTTP接口",
        protocol: "HTTP", create_time: t, status: "启用",
      }],
      variable: [{
        variable_id: 1, name: "base_url", value: "http://127.0.0.1:8080",
        remark: "演示环境地址", create_time: t,
      }],
      message: [
        { message_id: 1, interface_name: "demo_api", message_name: "健康检查", type: "JSON", create_time: t, operation: "", content: "GET ${base_url}/healthz" },
        { message_id: 2, interface_name: "demo_api", message_name: "404页面", type: "JSON", create_time: t, operation: "", content: "GET ${base_url}/not-exist-page" },
        { message_id: 3, interface_name: "demo_api", message_name: "登录接口", type: "JSON", create_time: t, operation: "", content: "POST ${base_url}/api/login\nContent-Type: application/json\n\n{\"username\":\"admin\",\"password\":\"admin123\"}" },
        { message_id: 4, interface_name: "demo_api", message_name: "未定义变量", type: "JSON", create_time: t, operation: "", content: "GET ${not_defined}/healthz" },
        { message_id: 5, interface_name: "demo_api", message_name: "首页", type: "JSON", create_time: t, operation: "", content: "GET ${base_url}/" },
      ],
      scene: [{
        scene_id: 1, name: "演示冒烟场景", include_scene_count: 0, create_time: t,
        independent_client: "否", remark: "演示数据", message_ids: "1,2,3,4,5",
      }],
      testset: [{
        testset_id: 1, name: "演示冒烟测试集", type: "测试集", parent_dir_id: null,
        status: "启用", create_time: t, scene_ids: "1",
      }],
      task: [{
        task_id: 1, name: "演示定时任务", type: "测试集执行", testset: "演示冒烟测试集",
        cron_expression: "*/5 * * * *", execute_count: 0, last_execute_time: "",
        create_time: t, status: "停止", email_notify: "否", create_user: "admin",
      }],
      env: [{
        env_id: 1, name: "本机环境", ip: "127.0.0.1:8080", protocol: "HTTP",
        use_proxy: "N", proxy_address: "",
      }],
      datapool: [{ pool_id: 1, name: "演示数据池", type: "CSV", content: "username,password\nadmin,admin123", create_time: t }],
      datasource: [{
        datasource_id: 1, type: "MySQL", db_name: "demo_db", username: "demo",
        password: "demo123", address: "127.0.0.1:3306", remark: "演示配置",
      }],
      report: [{
        report_id: 1, scene_count: 1, success_count: 3, fail_count: 1, execute_date: d,
        exception_count: 1, success_rate: 60, interface_name: "demo_api", protocol: "HTTP",
        format: "JSON", message: "首页", scene: "演示冒烟场景", env: "本机环境",
        data_pool: "", status: "手动执行完成", cost_time: 36,
      }],
      report_detail: [
        { detail_id: 1, report_id: 1, scene_name: "演示冒烟场景", message_name: "健康检查", interface_name: "demo_api", protocol: "HTTP", format: "JSON", status: "成功", response_code: "200", cost_time: 8, detail: "{\"ok\":true}", create_time: t },
        { detail_id: 2, report_id: 1, scene_name: "演示冒烟场景", message_name: "404页面", interface_name: "demo_api", protocol: "HTTP", format: "JSON", status: "失败", response_code: "404", cost_time: 6, detail: "404 Not Found", create_time: t },
        { detail_id: 3, report_id: 1, scene_name: "演示冒烟场景", message_name: "登录接口", interface_name: "demo_api", protocol: "HTTP", format: "JSON", status: "成功", response_code: "200", cost_time: 9, detail: "{\"code\":0}", create_time: t },
        { detail_id: 4, report_id: 1, scene_name: "演示冒烟场景", message_name: "未定义变量", interface_name: "demo_api", protocol: "HTTP", format: "JSON", status: "异常", response_code: "", cost_time: 1, detail: "ValueError: 存在未定义的变量：${not_defined}", create_time: t },
        { detail_id: 5, report_id: 1, scene_name: "演示冒烟场景", message_name: "首页", interface_name: "demo_api", protocol: "HTTP", format: "JSON", status: "成功", response_code: "200", cost_time: 12, detail: "<!doctype html> ...", create_time: t },
      ],
    };
    persist();
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && parsed.users) { db = parsed; return; }
      }
    } catch (e) { /* ignore */ }
    seed();
  }

  function ok(data, msg) { return { status: 200, code: 0, msg: msg || "success", data: data }; }
  function err(msg, status, code) { return { status: status || 200, code: code || 1, msg: msg, data: null }; }
  function unauth() { return { status: 401, code: 401, msg: "未登录或会话已过期", data: null }; }

  function currentUser() {
    if (!db.session) return null;
    return db.users.find(u => u.username === db.session) || null;
  }

  function nextId(res) {
    db.seq[res] = Number(db.seq[res] || 0) + 1;
    return db.seq[res];
  }

  function findRow(res, id) {
    const meta = RES[res];
    return (db[res] || []).find(r => Number(r[meta.pk]) === Number(id));
  }

  function parseIds(value) {
    if (value === null || value === undefined || String(value).trim() === "") return [];
    const out = [];
    String(value).replace(/，/g, ",").split(",").forEach(part => {
      part = part.trim();
      if (!part) return;
      const n = Number(part);
      if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    });
    return out;
  }

  function refsExist(ids, res) {
    return ids.every(id => !!findRow(res, id));
  }

  function maskDatasource(row) {
    return Object.assign({}, row, { has_password: !!row.password, password: "" });
  }

  function isCronValid(expr) {
    expr = String(expr || "").trim();
    if (!expr || expr.split(/\s+/).length !== 5) return false;
    const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
    return expr.split(/\s+/).every((field, i) => {
      if (field === "*") return true;
      return field.split(",").every(part => {
        let base = part, step = 1;
        if (part.includes("/")) {
          const bits = part.split("/");
          base = bits[0];
          step = Number(bits[1]);
          if (!Number.isInteger(step) || step <= 0) return false;
        }
        if (base === "*") return true;
        if (base.includes("-")) {
          const [a, b] = base.split("-").map(Number);
          return Number.isInteger(a) && Number.isInteger(b) && a >= ranges[i][0] && b <= ranges[i][1] && a <= b;
        }
        const n = Number(base);
        return Number.isInteger(n) && n >= ranges[i][0] && n <= ranges[i][1];
      });
    });
  }

  function validate(res, data, existing, isCreate) {
    const meta = RES[res];
    for (const field of meta.required) {
      if (isCreate || Object.prototype.hasOwnProperty.call(data, field)) {
        const value = data[field] !== undefined ? data[field] : (existing || {})[field];
        if (value === null || value === undefined || String(value).trim() === "") {
          throw new Error((LABEL[field] || field) + "不能为空");
        }
      }
    }
    if (res === "interface" && data.status && !["启用", "停用"].includes(data.status)) throw new Error("状态只能是启用或停用");
    if (res === "scene" && data.message_ids !== undefined) {
      const ids = parseIds(data.message_ids);
      if (!refsExist(ids, "message")) throw new Error("关联报文中存在不存在的记录");
      data.message_ids = ids.join(",");
    }
    if (res === "testset") {
      if (data.type && !["目录", "测试集"].includes(data.type)) throw new Error("类型只能是目录或测试集");
      if (data.scene_ids !== undefined) {
        const ids = parseIds(data.scene_ids);
        if (!refsExist(ids, "scene")) throw new Error("关联组合场景中存在不存在的记录");
        data.scene_ids = ids.join(",");
      }
      const type = data.type || (existing || {}).type;
      const sceneIds = data.scene_ids !== undefined ? data.scene_ids : (existing || {}).scene_ids;
      if (type === "目录" && String(sceneIds || "").trim()) throw new Error("目录不能关联组合场景");
      let parent = data.parent_dir_id !== undefined ? data.parent_dir_id : (existing || {}).parent_dir_id;
      parent = parent === "" || parent === null || parent === undefined ? null : Number(parent);
      if (parent !== null) {
        const parentRow = findRow("testset", parent);
        if (!parentRow) throw new Error("父目录不存在");
        if (parentRow.type !== "目录") throw new Error("父级必须是目录");
        if (existing && Number(parent) === Number(existing.testset_id)) throw new Error("不能把自身设为父目录");
        let cur = parentRow;
        const seen = new Set();
        while (cur) {
          if (seen.has(Number(cur.testset_id))) break;
          seen.add(Number(cur.testset_id));
          if (existing && Number(cur.testset_id) === Number(existing.testset_id)) throw new Error("父目录不能是自身的子目录");
          if (!cur.parent_dir_id) break;
          cur = findRow("testset", cur.parent_dir_id);
        }
      }
      data.parent_dir_id = parent;
    }
    if (res === "task") {
      const expr = String((data.cron_expression !== undefined ? data.cron_expression : (existing || {}).cron_expression) || "").trim();
      const status = (data.status !== undefined ? data.status : (existing || {}).status) || "开启";
      if (status === "开启") {
        if (!expr) throw new Error("开启状态下必须填写 cron 表达式");
        if (!isCronValid(expr)) throw new Error("cron 表达式不合法，应为标准 5 段格式，例如 */5 * * * *");
        data.cron_expression = expr;
      }
      const testsetName = String((data.testset !== undefined ? data.testset : (existing || {}).testset) || "").trim();
      if (testsetName && !db.testset.some(t => t.name === testsetName && t.type === "测试集")) {
        throw new Error("测试集不存在或不是可执行的测试集");
      }
    }
    if (res === "env") {
      if (data.protocol) {
        data.protocol = String(data.protocol).toUpperCase();
        if (!["HTTP", "HTTPS", "TCP", "SOAP"].includes(data.protocol)) throw new Error("协议类型只能是 HTTP/HTTPS/TCP/SOAP");
      }
      if (data.use_proxy) {
        data.use_proxy = String(data.use_proxy).toUpperCase();
        if (!["Y", "N"].includes(data.use_proxy)) throw new Error("是否使用代理只能是 Y 或 N");
      }
      const useProxy = data.use_proxy !== undefined ? data.use_proxy : (existing || {}).use_proxy;
      const proxy = data.proxy_address !== undefined ? data.proxy_address : (existing || {}).proxy_address;
      if (useProxy === "Y" && !String(proxy || "").trim()) throw new Error("使用代理时必须填写代理地址");
    }
    if (res === "datasource" && isCreate && !String(data.password || "").trim()) throw new Error("密码不能为空");
    if (res === "variable" && data.name !== undefined && !/^[^\s${}]{1,255}$/.test(String(data.name))) {
      throw new Error("变量名不能为空，且不能包含空格、$ 或 {}");
    }
  }

  function listRows(res, keyword) {
    const meta = RES[res];
    let rows = (db[res] || []).map(r => Object.assign({}, r));
    keyword = String(keyword || "").trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(row => Object.keys(row).some(k => k !== "password" && String(row[k] === null || row[k] === undefined ? "" : row[k]).toLowerCase().includes(keyword)));
    }
    rows.sort((a, b) => Number(b[meta.pk]) - Number(a[meta.pk]));
    if (res === "datasource") rows = rows.map(maskDatasource);
    if (res === "task") rows = rows.map(r => Object.assign({}, r, { cron_valid: isCronValid(r.cron_expression) }));
    return rows;
  }

  function saveRow(res, body) {
    const meta = RES[res];
    if (meta.readonly) return err("该资源只读，不能通过此接口修改");
    const pk = meta.pk;
    const data = Object.assign({}, body || {});
    let id = data[pk];
    delete data[pk];
    const conn = db[res] || (db[res] = []);
    let existing = null;
    if (id !== undefined && id !== null && id !== "") {
      existing = findRow(res, id);
      if (!existing) return err("记录不存在", 404, 404);
      if (res === "datasource" && !String(data.password || "").trim()) delete data.password;
      if (data.create_time) delete data.create_time;
    } else {
      id = null;
      for (const key of Object.keys(meta.defaults)) {
        if (data[key] === undefined || data[key] === null || data[key] === "") data[key] = meta.defaults[key];
      }
      data.create_time = nowStr();
      if (res === "task" && !data.create_user) data.create_user = (currentUser() || {}).username || "admin";
      if (res === "task") data.execute_count = Number(data.execute_count || 0);
    }
    try {
      validate(res, data, existing, !existing);
    } catch (e) {
      return err(e.message);
    }
    if (existing) {
      Object.assign(existing, data);
      persist();
      return ok({ [pk]: Number(existing[pk]) }, "修改成功");
    }
    data[pk] = nextId(res);
    conn.push(data);
    persist();
    return ok({ [pk]: data[pk] }, "添加成功");
  }

  function deleteRow(res, id) {
    const meta = RES[res];
    const row = findRow(res, id);
    if (!row) return err("记录不存在", 404, 404);
    if (res === "testset") {
      if (db.testset.some(t => Number(t.parent_dir_id) === Number(id))) return err("该目录下还有子目录或测试集，请先删除子项");
      if (db.task.some(t => t.testset === row.name)) return err("该测试集已被定时任务引用，请先删除相关任务");
    }
    if (res === "report") db.report_detail = (db.report_detail || []).filter(d => Number(d.report_id) !== Number(id));
    if (res === "message") {
      db.scene.forEach(s => {
        const ids = parseIds(s.message_ids).filter(x => x !== Number(id));
        s.message_ids = ids.join(",");
      });
    }
    if (res === "scene") {
      db.testset.forEach(t => {
        const ids = parseIds(t.scene_ids).filter(x => x !== Number(id));
        t.scene_ids = ids.join(",");
      });
    }
    db[res] = (db[res] || []).filter(r => Number(r[meta.pk]) !== Number(id));
    persist();
    return ok(null, "删除成功");
  }

  function renderVars(content, env) {
    const mapping = {};
    (db.variable || []).forEach(v => { mapping[v.name] = v.value; });
    if (env) {
      mapping["env.name"] = env.name || "";
      mapping["env.ip"] = env.ip || "";
      mapping["env.protocol"] = env.protocol || "";
    }
    return String(content || "").replace(/\$\{([^}]+)\}/g, (m, key) => mapping[key] !== undefined ? String(mapping[key]) : m);
  }

  function runDemoMessage(msg, env) {
    const started = Date.now();
    let content = renderVars(msg.content || "", env);
    if (content.includes("${")) {
      return { status: "异常", code: "", detail: "ValueError: 存在未定义的变量：" + (content.match(/\$\{[^}]+\}/) || [""])[0], cost: 1 };
    }
    if (String(env.protocol || "").toUpperCase() === "TCP") {
      return { status: "成功", code: "200", detail: "echo:" + content, cost: Math.max(1, Date.now() - started) };
    }
    const first = content.split("\n")[0].trim();
    const validStart = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+/i.test(first) ||
      first.startsWith("/") || /^https?:\/\//i.test(first);
    if (!validStart) {
      return { status: "异常", code: "", detail: "ValueError: 报文首行应为“METHOD URL”或请求地址，例如：GET /api/user/list", cost: 1 };
    }
    if (/not-exist|404|\/fail/i.test(content)) {
      return { status: "失败", code: "404", detail: "404 Not Found", cost: 4 };
    }
    return { status: "成功", code: "200", detail: "{\"ok\":true}", cost: 5 };
  }

  function executeDemo(testsetId, envId, trigger) {
    trigger = trigger || "手动";
    const testset = findRow("testset", testsetId);
    if (!testset) return err("测试集不存在");
    if (testset.type !== "测试集") return err("只能执行类型为“测试集”的记录");
    const sceneIds = parseIds(testset.scene_ids);
    if (!sceneIds.length) return err("测试集尚未关联组合场景");
    let env = null;
    if (envId) {
      env = findRow("env", envId);
      if (!env) return err("测试环境不存在");
    }
    if (!env) env = (db.env || [])[0];
    if (!env) return err("请先在“测试环境”中配置至少一个环境");

    let sceneCount = 0, success = 0, fail = 0, exception = 0, totalCost = 0;
    const details = [];
    sceneIds.forEach(sceneId => {
      const scene = findRow("scene", sceneId);
      if (!scene) return;
      sceneCount += 1;
      parseIds(scene.message_ids).forEach(messageId => {
        const msg = findRow("message", messageId);
        if (!msg) return;
        const result = runDemoMessage(msg, env);
        totalCost += result.cost;
        if (result.status === "成功") success += 1;
        else if (result.status === "失败") fail += 1;
        else exception += 1;
        details.push({
          scene_name: scene.name,
          message_name: msg.message_name,
          interface_name: msg.interface_name,
          protocol: env.protocol,
          format: msg.type,
          status: result.status,
          response_code: result.code,
          cost_time: result.cost,
          detail: result.detail,
        });
      });
    });
    const total = success + fail + exception;
    const rate = total ? Number((success * 100 / total).toFixed(2)) : 0;
    const last = details[details.length - 1] || {};
    const reportId = nextId("report");
    const report = {
      report_id: reportId,
      scene_count: sceneCount,
      success_count: success,
      fail_count: fail,
      execute_date: todayStr(),
      exception_count: exception,
      success_rate: rate,
      interface_name: last.interface_name,
      protocol: last.protocol,
      format: last.format,
      message: last.message_name,
      scene: last.scene_name,
      env: env.name,
      data_pool: "",
      status: trigger + "执行完成",
      cost_time: totalCost,
    };
    db.report.push(report);
    details.forEach(d => {
      db.report_detail.push(Object.assign({
        detail_id: nextId("report_detail"),
        report_id: reportId,
        create_time: nowStr(),
      }, d));
    });
    persist();
    return ok(Object.assign({}, report, { detail_count: details.length }), "执行完成");
  }

  function summaryDemo() {
    const map = {};
    (db.report || []).forEach(r => {
      const d = r.execute_date;
      if (!map[d]) map[d] = { d: d, rates: [], c: 0 };
      map[d].rates.push(Number(r.success_rate || 0));
      map[d].c += 1;
    });
    const byDate = Object.keys(map).sort().map(d => ({
      d: d,
      rate: Number((map[d].rates.reduce((a, b) => a + b, 0) / map[d].rates.length).toFixed(2)),
      c: map[d].c,
    }));
    const totals = { total: (db.report || []).length, success: 0, fail: 0, exception: 0 };
    (db.report || []).forEach(r => {
      totals.success += Number(r.success_count || 0);
      totals.fail += Number(r.fail_count || 0);
      totals.exception += Number(r.exception_count || 0);
    });
    return { by_date: byDate, totals: totals };
  }

  function statsDemo() {
    return {
      interface: (db.interface || []).length,
      message: (db.message || []).length,
      scene: (db.scene || []).length,
      testset: (db.testset || []).length,
      report: (db.report || []).length,
      task: (db.task || []).length,
    };
  }

  function handle(method, url, body) {
    const raw = String(url || "");
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    let path = raw.split("?")[0];
    const apiIndex = path.indexOf("/api/");
    if (apiIndex >= 0) path = path.slice(apiIndex);
    const query = new URLSearchParams(qs);

    if (path === "/api/login" && method === "POST") {
      const username = String((body || {}).username || "").trim();
      const password = String((body || {}).password || "");
      const user = db.users.find(u => u.username === username && u.password === password);
      if (!user) return err("用户名或密码错误");
      db.session = user.username;
      persist();
      return ok({ username: user.username, role: user.role }, "登录成功");
    }
    if (path === "/api/register" && method === "POST") {
      const username = String((body || {}).username || "").trim();
      const password = String((body || {}).password || "");
      if (!username || !password) return err("用户名和密码不能为空");
      if (password.length < 6) return err("密码长度至少 6 位");
      if (db.users.some(u => u.username === username)) return err("用户名已存在");
      db.users.push({ username: username, password: password, role: "user" });
      persist();
      return ok(null, "注册成功");
    }
    if (path === "/api/logout" && method === "POST") {
      db.session = null;
      persist();
      return ok(null, "已退出登录");
    }
    if (path === "/api/me") {
      const user = currentUser();
      if (!user) return unauth();
      return ok({ username: user.username, role: user.role });
    }

    const user = currentUser();
    if (!user) return unauth();

    if (path === "/api/execute/run" && method === "POST") {
      return executeDemo((body || {}).testset_id, (body || {}).env_id, "手动");
    }
    if (path === "/api/report/summary") return ok(summaryDemo());
    if (path === "/api/stats") return ok(statsDemo());
    let m = path.match(/^\/api\/report\/detail\/(\d+)$/);
    if (m) {
      const reportId = Number(m[1]);
      const report = findRow("report", reportId);
      if (!report) return err("报告不存在", 404, 404);
      return ok({
        report: Object.assign({}, report),
        details: (db.report_detail || []).filter(d => Number(d.report_id) === reportId),
      });
    }

    m = path.match(/^\/api\/([a-z]+)\/list$/);
    if (m && method === "GET") {
      const res = m[1];
      if (!RES[res]) return err("资源不存在", 404, 404);
      return ok(listRows(res, query.get("keyword")));
    }
    m = path.match(/^\/api\/([a-z]+)\/get\/(\d+)$/);
    if (m && method === "GET") {
      const res = m[1];
      if (!RES[res]) return err("资源不存在", 404, 404);
      const row = findRow(res, m[2]);
      if (!row) return err("记录不存在", 404, 404);
      return ok(res === "datasource" ? maskDatasource(row) : Object.assign({}, row));
    }
    m = path.match(/^\/api\/([a-z]+)\/save$/);
    if (m && method === "POST") {
      const res = m[1];
      if (!RES[res]) return err("资源不存在", 404, 404);
      return saveRow(res, body || {});
    }
    m = path.match(/^\/api\/([a-z]+)\/del$/);
    if (m && method === "POST") {
      const res = m[1];
      if (!RES[res]) return err("资源不存在", 404, 404);
      return deleteRow(res, (body || {})[RES[res].pk]);
    }
    return err("接口不存在", 404, 404);
  }

  /* 简易 cron 匹配：支持星号、步长、范围、列表、具体数字 */
  function fieldMatch(field, value, minVal, maxVal) {
    if (!field) return false;
    return field.split(",").some(part => {
      let base = part, step = 1;
      if (part.includes("/")) {
        const bits = part.split("/");
        base = bits[0];
        step = Number(bits[1]) || 1;
      }
      if (base === "*") return value % step === 0;
      if (base.includes("-")) {
        const [a, b] = base.split("-").map(Number);
        return value >= a && value <= b && (value - a) % step === 0;
      }
      const n = Number(base);
      return n === value || (n === 7 && value === 0);
    });
  }

  function cronMatch(expr, dateObj) {
    if (!isCronValid(expr)) return false;
    const f = expr.trim().split(/\s+/);
    return fieldMatch(f[0], dateObj.getMinutes(), 0, 59) &&
      fieldMatch(f[1], dateObj.getHours(), 0, 23) &&
      fieldMatch(f[2], dateObj.getDate(), 1, 31) &&
      fieldMatch(f[3], dateObj.getMonth() + 1, 1, 12) &&
      fieldMatch(f[4], dateObj.getDay(), 0, 7);
  }

  function tick() {
    if (!currentUser()) return;
    const now = new Date();
    const minute = nowStr(now).slice(0, 16);
    (db.task || []).forEach(task => {
      if (task.status !== "开启") return;
      if (!cronMatch(task.cron_expression, now)) return;
      if (task.last_execute_time && String(task.last_execute_time).slice(0, 16) === minute) return;
      const testset = db.testset.find(t => t.name === task.testset && t.type === "测试集");
      const env = (db.env || [])[0];
      if (!testset || !env) return;
      task.execute_count = Number(task.execute_count || 0) + 1;
      task.last_execute_time = nowStr(now);
      executeDemo(testset.testset_id, env.env_id, "定时");
    });
    persist();
  }

  window.demoStartScheduler = function () {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 15000);
    setTimeout(tick, 1500);
  };
  window.demoStopScheduler = function () {
    if (timer) clearInterval(timer);
    timer = null;
  };
  window.demoRequest = async function (method, url, body) {
    return handle(String(method || "GET").toUpperCase(), url, body);
  };
  window.demoReset = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    seed();
    window.location.reload();
  };

  load();
})();
