# -*- coding: utf-8 -*-
"""
自动化测试平台 v1.1
====================

按《自动化测试平台功能说明》实现的完整可运行平台（Flask + SQLite + 单页前端）。

功能：
  用户登录 / 接口管理 / 报文管理 / 组合场景 / 测试集管理 / 测试执行 /
  测试报告 / 定时任务 / 数据池 / 测试环境 / 变量模板 / 数据源配置 /
  JSON 格式化 / XML 格式化 / 测试报表

运行：
  pip install -r requirements.txt
  python app.py
  浏览器打开 http://127.0.0.1:8080

环境变量：
  AUTOTEST_DB        数据库文件路径（默认 ./autotest.db）
  AUTOTEST_HOST      监听地址（默认 0.0.0.0）
  AUTOTEST_PORT      监听端口（默认 8080）
  AUTOTEST_SECRET    Flask session 密钥
  AUTOTEST_SCHEDULER 设为 0 可关闭后台定时任务线程
  AUTOTEST_HTTP_TIMEOUT HTTP 请求超时秒数（默认 10）
"""
import logging
import os
import re
import socket
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from functools import wraps

try:
    import requests
    import urllib3
    from croniter import croniter
except ImportError as exc:  # pragma: no cover - 仅用于给出友好提示
    raise SystemExit(
        "缺少依赖：%s\n请先执行：pip install -r requirements.txt" % exc
    )

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------------------------------------------------------
# 基础配置
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get("AUTOTEST_DB") or os.path.join(BASE_DIR, "autotest.db")
HOST = os.environ.get("AUTOTEST_HOST", "0.0.0.0")
PORT = int(os.environ.get("AUTOTEST_PORT", "8080"))
HTTP_TIMEOUT = float(os.environ.get("AUTOTEST_HTTP_TIMEOUT", "10"))
SCHEDULER_ENABLED = os.environ.get("AUTOTEST_SCHEDULER", "1").lower() not in ("0", "false", "no")
SCHEDULER_INTERVAL = int(os.environ.get("AUTOTEST_SCHEDULER_INTERVAL", "20"))
SECRET_KEY = os.environ.get("AUTOTEST_SECRET") or "autotest-platform-v1.1-dev-secret"

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("autotest")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(hours=12)
app.json.ensure_ascii = False

# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS user_info (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    create_time DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS interface_info (
    interface_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    chinese_name VARCHAR(255),
    type VARCHAR(50),
    protocol VARCHAR(50),
    create_time DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT '启用'
);
CREATE TABLE IF NOT EXISTS message_info (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    interface_name VARCHAR(255) NOT NULL,
    message_name VARCHAR(255) NOT NULL,
    type VARCHAR(50),
    create_time DATETIME NOT NULL,
    operation TEXT,
    content TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS scene_info (
    scene_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    include_scene_count INTEGER NOT NULL DEFAULT 0,
    create_time DATETIME NOT NULL,
    independent_client VARCHAR(20) NOT NULL DEFAULT '否',
    remark VARCHAR(500),
    message_ids TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS testset_info (
    testset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    parent_dir_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT '启用',
    create_time DATETIME NOT NULL,
    scene_ids TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS report_info (
    report_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_count INTEGER NOT NULL,
    success_count INTEGER NOT NULL,
    fail_count INTEGER NOT NULL,
    execute_date DATE NOT NULL,
    exception_count INTEGER NOT NULL,
    success_rate DECIMAL(5,2) NOT NULL,
    interface_name VARCHAR(255),
    protocol VARCHAR(50),
    format VARCHAR(50),
    message VARCHAR(255),
    scene VARCHAR(255),
    env VARCHAR(255),
    data_pool VARCHAR(255),
    status VARCHAR(20),
    cost_time INTEGER
);
CREATE TABLE IF NOT EXISTS report_detail_info (
    detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    scene_name VARCHAR(255),
    message_name VARCHAR(255),
    interface_name VARCHAR(255),
    protocol VARCHAR(50),
    format VARCHAR(50),
    status VARCHAR(20),
    response_code VARCHAR(100),
    cost_time INTEGER,
    detail TEXT,
    create_time DATETIME NOT NULL,
    FOREIGN KEY (report_id) REFERENCES report_info(report_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_info (
    task_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50),
    testset VARCHAR(255) NOT NULL,
    cron_expression VARCHAR(255),
    execute_count INTEGER NOT NULL DEFAULT 0,
    last_execute_time DATETIME,
    create_time DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT '开启',
    email_notify VARCHAR(20) NOT NULL DEFAULT '否',
    create_user VARCHAR(50) NOT NULL
);
CREATE TABLE IF NOT EXISTS env_info (
    env_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    ip VARCHAR(50) NOT NULL,
    protocol VARCHAR(50) NOT NULL,
    use_proxy VARCHAR(1) NOT NULL DEFAULT 'N',
    proxy_address VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS datasource_info (
    datasource_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50) NOT NULL,
    db_name VARCHAR(255) NOT NULL,
    username VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL,
    remark VARCHAR(500)
);
CREATE TABLE IF NOT EXISTS data_pool_info (
    pool_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'CSV',
    content TEXT DEFAULT '',
    create_time DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS variable_info (
    variable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    remark VARCHAR(500),
    create_time DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_date ON report_info(execute_date);
CREATE INDEX IF NOT EXISTS idx_detail_report ON report_detail_info(report_id);
CREATE INDEX IF NOT EXISTS idx_testset_parent ON testset_info(parent_dir_id);
"""


def connect_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect_db()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """建表、建默认管理员。重复调用安全。"""
    conn = connect_db()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        row = conn.execute("SELECT COUNT(*) AS c FROM user_info").fetchone()
        if row["c"] == 0:
            conn.execute(
                "INSERT INTO user_info(username,password,role,create_time) VALUES(?,?,?,?)",
                ("admin", generate_password_hash("admin123"), "admin", now()),
            )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------------------
def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def api_ok(data=None, msg="success"):
    return jsonify({"code": 0, "msg": msg, "data": data})


def api_err(msg, code=1, http_status=200):
    return jsonify({"code": code, "msg": msg, "data": None}), http_status


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user" not in session:
            return api_err("未登录或会话已过期", 401, 401)
        return fn(*args, **kwargs)

    return wrapper


def table_columns(table):
    if not hasattr(table_columns, "_cache"):
        table_columns._cache = {}
    if table not in table_columns._cache:
        rows = get_db().execute("PRAGMA table_info(%s)" % table).fetchall()
        table_columns._cache[table] = [r["name"] for r in rows]
    return table_columns._cache[table]


def parse_id_list(value):
    """把 "1,2,3" 规范化为去重后的整数列表；非法值抛 ValueError。"""
    if value is None or str(value).strip() == "":
        return []
    result = []
    for part in str(value).replace("，", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            num = int(part)
        except ValueError:
            raise ValueError("关联 ID 必须是整数：%s" % part)
        if num <= 0:
            raise ValueError("关联 ID 必须为正整数：%s" % part)
        if num not in result:
            result.append(num)
    return result


def ids_to_text(ids):
    return ",".join(str(x) for x in ids)


def valid_cron(expr):
    expr = (expr or "").strip()
    if not expr:
        return False
    if len(expr.split()) != 5:
        return False
    try:
        return bool(croniter.is_valid(expr))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# 资源定义
# ---------------------------------------------------------------------------
RESOURCES = {
    "interface": {
        "table": "interface_info",
        "pk": "interface_id",
        "label": "接口",
        "required": ("name",),
        "defaults": {"status": "启用"},
    },
    "message": {
        "table": "message_info",
        "pk": "message_id",
        "label": "报文",
        "required": ("interface_name", "message_name"),
        "defaults": {},
    },
    "scene": {
        "table": "scene_info",
        "pk": "scene_id",
        "label": "组合场景",
        "required": ("name",),
        "defaults": {"independent_client": "否", "include_scene_count": 0},
    },
    "testset": {
        "table": "testset_info",
        "pk": "testset_id",
        "label": "测试集",
        "required": ("name", "type"),
        "defaults": {"status": "启用"},
    },
    "report": {
        "table": "report_info",
        "pk": "report_id",
        "label": "测试报告",
        "required": (),
        "defaults": {},
        "readonly": True,
    },
    "task": {
        "table": "task_info",
        "pk": "task_id",
        "label": "定时任务",
        "required": ("name", "testset"),
        "defaults": {"status": "开启", "execute_count": 0, "email_notify": "否"},
    },
    "env": {
        "table": "env_info",
        "pk": "env_id",
        "label": "测试环境",
        "required": ("name", "ip", "protocol"),
        "defaults": {"use_proxy": "N"},
    },
    "datasource": {
        "table": "datasource_info",
        "pk": "datasource_id",
        "label": "数据源",
        "required": ("type", "db_name", "username", "password", "address"),
        "defaults": {},
    },
    "datapool": {
        "table": "data_pool_info",
        "pk": "pool_id",
        "label": "数据池",
        "required": ("name",),
        "defaults": {"type": "CSV"},
    },
    "variable": {
        "table": "variable_info",
        "pk": "variable_id",
        "label": "变量",
        "required": ("name", "value"),
        "defaults": {},
    },
}

INT_FIELDS = {"parent_dir_id", "include_scene_count", "execute_count"}


def get_resource(resource):
    res = RESOURCES.get(resource)
    if res is None:
        return None
    res = dict(res)
    res.setdefault("readonly", False)
    return res


# ---------------------------------------------------------------------------
# 用户登录
# ---------------------------------------------------------------------------
@app.post("/api/login")
def login():
    body = json_body()
    if body is None:
        return api_err("请求格式错误")
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not username or not password:
        return api_err("用户名和密码不能为空")
    user = get_db().execute(
        "SELECT * FROM user_info WHERE username=?", (username,)
    ).fetchone()
    if user and check_password_hash(user["password"], password):
        session.clear()
        session.permanent = True
        session["user"] = user["username"]
        session["role"] = user["role"]
        return api_ok({"username": user["username"], "role": user["role"]}, "登录成功")
    return api_err("用户名或密码错误")


@app.post("/api/register")
def register():
    body = json_body() or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not username or not password:
        return api_err("用户名和密码不能为空")
    if len(username) > 50:
        return api_err("用户名不能超过 50 个字符")
    if len(password) < 6:
        return api_err("密码长度至少 6 位")
    conn = get_db()
    if conn.execute("SELECT 1 FROM user_info WHERE username=?", (username,)).fetchone():
        return api_err("用户名已存在")
    role = "admin" if conn.execute("SELECT COUNT(*) AS c FROM user_info").fetchone()["c"] == 0 else "user"
    try:
        conn.execute(
            "INSERT INTO user_info(username,password,role,create_time) VALUES(?,?,?,?)",
            (username, generate_password_hash(password), role, now()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        return api_err("用户名已存在")
    return api_ok(msg="注册成功")


@app.post("/api/logout")
def logout():
    session.clear()
    return api_ok(msg="已退出登录")


@app.get("/api/me")
def me():
    if "user" not in session:
        return api_err("未登录", 401, 401)
    return api_ok({"username": session["user"], "role": session.get("role", "user")})


# ---------------------------------------------------------------------------
# 校验
# ---------------------------------------------------------------------------
def merged_row(conn, res, rid, data):
    if rid is None:
        return dict(data)
    row = conn.execute(
        "SELECT * FROM %s WHERE %s=?" % (res["table"], res["pk"]), (rid,)
    ).fetchone()
    if row is None:
        return None
    merged = dict(row)
    merged.update(data)
    return merged


def ensure_refs(conn, ids, table, pk, label):
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    found = {
        r[0]
        for r in conn.execute(
            "SELECT %s FROM %s WHERE %s IN (%s)" % (pk, table, pk, placeholders), ids
        ).fetchall()
    }
    missing = [str(x) for x in ids if x not in found]
    if missing:
        raise ValueError("%s不存在：%s" % (label, "、".join(missing)))


def validate_payload(resource, conn, merged, data, is_create):
    """校验并就地规范化 data / merged。抛 ValueError 表示用户输入错误。"""
    res = RESOURCES[resource]
    # 通用必填（新增时全部校验，编辑时只校验本次提交的字段）
    for field in res["required"]:
        if is_create or field in data:
            value = merged.get(field)
            if value is None or str(value).strip() == "":
                raise ValueError("%s不能为空" % field)

    if resource == "interface":
        if "status" in data and data["status"] not in ("启用", "停用"):
            raise ValueError("状态只能是“启用”或“停用”")

    elif resource == "message":
        if "type" in data and data["type"] not in ("JSON", "XML", "报文文本", ""):
            raise ValueError("报文类型不合法")

    elif resource == "scene":
        if "independent_client" in data and data["independent_client"] not in ("是", "否"):
            raise ValueError("独立客户端测试只能是“是”或“否”")
        if "message_ids" in data:
            ids = parse_id_list(data["message_ids"])
            ensure_refs(conn, ids, "message_info", "message_id", "报文")
            data["message_ids"] = ids_to_text(ids)

    elif resource == "testset":
        if "type" in data and data["type"] not in ("目录", "测试集"):
            raise ValueError("类型只能是“目录”或“测试集”")
        if "status" in data and data["status"] not in ("启用", "停用"):
            raise ValueError("状态只能是“启用”或“停用”")
        if "scene_ids" in data:
            ids = parse_id_list(data["scene_ids"])
            ensure_refs(conn, ids, "scene_info", "scene_id", "组合场景")
            data["scene_ids"] = ids_to_text(ids)
        if merged.get("type") == "目录":
            if "scene_ids" in data and str(data.get("scene_ids") or "").strip():
                raise ValueError("目录不能关联组合场景")
            # 从“测试集”改为“目录”时自动清空场景关联
            if "type" in data and data.get("type") == "目录":
                data["scene_ids"] = ""
        parent_id = merged.get("parent_dir_id")
        if parent_id not in (None, "", 0, "0"):
            try:
                parent_id = int(parent_id)
            except (TypeError, ValueError):
                raise ValueError("父目录不合法")
            node_id = merged.get(res["pk"])
            if node_id is not None and int(parent_id) == int(node_id):
                raise ValueError("不能把自身设为父目录")
            parent = conn.execute(
                "SELECT * FROM testset_info WHERE testset_id=?", (parent_id,)
            ).fetchone()
            if parent is None:
                raise ValueError("父目录不存在")
            if parent["type"] != "目录":
                raise ValueError("父级必须是目录")
            # 防止形成环
            current = parent
            seen = set()
            while current is not None:
                if int(current["testset_id"]) in seen:
                    break
                seen.add(int(current["testset_id"]))
                if node_id is not None and int(current["testset_id"]) == int(node_id):
                    raise ValueError("父目录不能是自身的子目录")
                if current["parent_dir_id"] in (None, "", 0, "0"):
                    break
                current = conn.execute(
                    "SELECT * FROM testset_info WHERE testset_id=?",
                    (current["parent_dir_id"],),
                ).fetchone()
        if "parent_dir_id" in data and data["parent_dir_id"] in ("", None, 0, "0"):
            data["parent_dir_id"] = None

    elif resource == "task":
        expr = str(merged.get("cron_expression") or "").strip()
        status = merged.get("status") or "开启"
        if status not in ("开启", "停止"):
            raise ValueError("开启状态只能是“开启”或“停止”")
        if status == "开启":
            if not expr:
                raise ValueError("开启状态下必须填写 cron 表达式")
            if not valid_cron(expr):
                raise ValueError("cron 表达式不合法，应为标准 5 段格式，例如 */5 * * * *")
            data["cron_expression"] = expr
        elif expr and valid_cron(expr):
            data["cron_expression"] = expr
        testset = str(merged.get("testset") or "").strip()
        if testset:
            exists = conn.execute(
                "SELECT 1 FROM testset_info WHERE name=? AND type='测试集'", (testset,)
            ).fetchone()
            if not exists:
                raise ValueError("测试集不存在或不是可执行的测试集")
        if "email_notify" in data and data["email_notify"] not in ("是", "否"):
            raise ValueError("邮件通知只能是“是”或“否”")

    elif resource == "env":
        if "protocol" in data:
            data["protocol"] = str(data["protocol"]).upper()
            if data["protocol"] not in ("HTTP", "HTTPS", "TCP", "SOAP"):
                raise ValueError("协议类型只能是 HTTP/HTTPS/TCP/SOAP")
        if "use_proxy" in data:
            data["use_proxy"] = str(data["use_proxy"]).upper()
            if data["use_proxy"] not in ("Y", "N"):
                raise ValueError("是否使用代理只能是 Y 或 N")
        if merged.get("use_proxy") == "Y" and not str(merged.get("proxy_address") or "").strip():
            raise ValueError("使用代理时必须填写代理地址")

    elif resource == "datasource":
        if is_create and not str(merged.get("password") or ""):
            raise ValueError("密码不能为空")

    elif resource == "variable":
        if "name" in data and not re.match(r"^[^\s${}]{1,255}$", str(data["name"])):
            raise ValueError("变量名不能为空，且不能包含空格、$ 或 {}")


# ---------------------------------------------------------------------------
# 通用 CRUD
# ---------------------------------------------------------------------------
@app.get("/api/<resource>/list")
@login_required
def list_rows(resource):
    res = get_resource(resource)
    if res is None:
        return api_err("资源不存在", 404, 404)
    table, pk = res["table"], res["pk"]
    cols = table_columns(table)
    keyword = request.args.get("keyword", "").strip()
    sql = "SELECT * FROM %s" % table
    args = []
    if keyword:
        search_cols = [c for c in cols if c != pk and c != "password"]
        if search_cols:
            sql += " WHERE " + " OR ".join("%s LIKE ?" % c for c in search_cols)
            args = ["%%%s%%" % keyword] * len(search_cols)
    sql += " ORDER BY %s DESC" % pk
    rows = [dict(r) for r in get_db().execute(sql, args).fetchall()]
    if resource == "datasource":
        for row in rows:
            row["has_password"] = bool(row.get("password"))
            row["password"] = ""
    if resource == "task":
        for row in rows:
            row["cron_valid"] = valid_cron(row.get("cron_expression"))
    return api_ok(rows)


@app.get("/api/<resource>/get/<int:rid>")
@login_required
def get_row(resource, rid):
    res = get_resource(resource)
    if res is None:
        return api_err("资源不存在", 404, 404)
    row = get_db().execute(
        "SELECT * FROM %s WHERE %s=?" % (res["table"], res["pk"]), (rid,)
    ).fetchone()
    if row is None:
        return api_err("记录不存在", 404, 404)
    data = dict(row)
    if resource == "datasource":
        data["has_password"] = bool(data.get("password"))
        data["password"] = ""
    return api_ok(data)


@app.post("/api/<resource>/save")
@login_required
def save_row(resource):
    res = get_resource(resource)
    if res is None:
        return api_err("资源不存在", 404, 404)
    if res["readonly"]:
        return api_err("该资源只读，不能通过此接口修改")
    body = json_body()
    if body is None:
        return api_err("请求格式错误")
    table, pk = res["table"], res["pk"]
    cols = table_columns(table)
    rid = body.pop(pk, None)
    if rid in ("", None):
        rid = None
    else:
        try:
            rid = int(rid)
        except (TypeError, ValueError):
            return api_err("记录 ID 不合法")
    data = {k: v for k, v in body.items() if k in cols and k != pk}

    conn = get_db()
    is_create = rid is None
    if is_create:
        for key, value in res["defaults"].items():
            if key in cols and data.get(key) in (None, ""):
                data[key] = value
        if "create_time" in cols:
            data["create_time"] = now()
        if resource == "task" and not str(data.get("create_user") or "").strip():
            data["create_user"] = session["user"]
        if resource == "report" and "execute_date" in cols:
            data["execute_date"] = now()[:10]
    else:
        existing = conn.execute(
            "SELECT * FROM %s WHERE %s=?" % (table, pk), (rid,)
        ).fetchone()
        if existing is None:
            return api_err("记录不存在", 404, 404)
        data.pop("create_time", None)
        if resource == "datasource" and data.get("password") in ("", "******", None):
            data.pop("password", None)

    # 整数字段规范化
    for field in INT_FIELDS:
        if field in data:
            if data[field] in ("", None):
                data[field] = 0 if field != "parent_dir_id" else None
            else:
                try:
                    data[field] = int(data[field])
                except (TypeError, ValueError):
                    return api_err("%s 必须是整数" % field)

    try:
        merged = merged_row(conn, res, rid, data)
        if merged is None:
            return api_err("记录不存在", 404, 404)
        validate_payload(resource, conn, merged, data, is_create)
    except ValueError as exc:
        return api_err(str(exc))

    if is_create:
        if not data:
            return api_err("没有有效字段")
        keys = ", ".join(data.keys())
        placeholders = ", ".join("?" for _ in data)
        try:
            cur = conn.execute(
                "INSERT INTO %s(%s) VALUES(%s)" % (table, keys, placeholders),
                tuple(data.values()),
            )
            conn.commit()
        except sqlite3.Error as exc:
            conn.rollback()
            log.exception("insert failed")
            return api_err("保存失败：%s" % exc)
        return api_ok({pk: cur.lastrowid}, "添加成功")

    if not data:
        return api_err("没有需要修改的字段")
    sets = ", ".join("%s=?" % k for k in data)
    try:
        conn.execute(
            "UPDATE %s SET %s WHERE %s=?" % (table, sets, pk),
            (*data.values(), rid),
        )
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        log.exception("update failed")
        return api_err("保存失败：%s" % exc)
    return api_ok({pk: rid}, "修改成功")


@app.post("/api/<resource>/del")
@login_required
def del_row(resource):
    res = get_resource(resource)
    if res is None:
        return api_err("资源不存在", 404, 404)
    body = json_body() or {}
    rid = body.get(res["pk"])
    try:
        rid = int(rid)
    except (TypeError, ValueError):
        return api_err("记录 ID 不合法")
    table, pk = res["table"], res["pk"]
    conn = get_db()
    row = conn.execute("SELECT * FROM %s WHERE %s=?" % (table, pk), (rid,)).fetchone()
    if row is None:
        return api_err("记录不存在", 404, 404)

    if resource == "testset":
        child = conn.execute(
            "SELECT 1 FROM testset_info WHERE parent_dir_id=? LIMIT 1", (rid,)
        ).fetchone()
        if child:
            return api_err("该目录下还有子目录或测试集，请先删除子项")
        used = conn.execute(
            "SELECT 1 FROM task_info WHERE testset=? LIMIT 1", (row["name"],)
        ).fetchone()
        if used:
            return api_err("该测试集已被定时任务引用，请先删除相关任务")

    if resource == "report":
        conn.execute("DELETE FROM report_detail_info WHERE report_id=?", (rid,))

    if resource == "message":
        # 从组合场景中移除该报文
        for scene in conn.execute("SELECT scene_id, message_ids FROM scene_info").fetchall():
            ids = [x for x in (scene["message_ids"] or "").split(",") if x.strip()]
            if str(rid) in ids:
                ids = [x for x in ids if x != str(rid)]
                conn.execute(
                    "UPDATE scene_info SET message_ids=? WHERE scene_id=?",
                    (ids_to_text([int(x) for x in ids]), scene["scene_id"]),
                )

    if resource == "scene":
        # 从测试集中移除该场景
        for testset in conn.execute("SELECT testset_id, scene_ids FROM testset_info").fetchall():
            ids = [x for x in (testset["scene_ids"] or "").split(",") if x.strip()]
            if str(rid) in ids:
                ids = [x for x in ids if x != str(rid)]
                conn.execute(
                    "UPDATE testset_info SET scene_ids=? WHERE testset_id=?",
                    (ids_to_text([int(x) for x in ids]), testset["testset_id"]),
                )

    conn.execute("DELETE FROM %s WHERE %s=?" % (table, pk), (rid,))
    conn.commit()
    return api_ok(msg="删除成功")


# ---------------------------------------------------------------------------
# 测试执行
# ---------------------------------------------------------------------------
METHOD_RE = re.compile(r"^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s*$", re.I)
HEADER_RE = re.compile(r"^([A-Za-z0-9!#$&'*+.^_`|~-]+)\s*:\s*(.*)$")


def render_vars(text, conn, env):
    """替换 ${变量}，并额外支持 ${env.name}/${env.ip}/${env.protocol}。"""
    if not text:
        return text
    mapping = {r["name"]: r["value"] for r in conn.execute("SELECT name,value FROM variable_info")}
    if env:
        mapping.setdefault("env.name", env["name"] or "")
        mapping.setdefault("env.ip", env["ip"] or "")
        mapping.setdefault("env.protocol", env["protocol"] or "")

    def repl(match):
        key = match.group(1).strip()
        return str(mapping.get(key, match.group(0)))

    return re.sub(r"\$\{([^}]+)\}", repl, str(text))


def parse_http_message(content, protocol):
    """解析报文内容。

    支持：
        GET http://host:port/path
        POST /api/login
        Content-Type: application/json
        X-Token: abc

        {"username":"admin"}
    """
    text = (content or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    if start >= len(lines):
        raise ValueError("报文内容为空")
    first = lines[start].strip()
    method = None
    url = None
    match = METHOD_RE.match(first)
    if match:
        method, url = match.group(1).upper(), match.group(2)
    elif first.startswith(("http://", "https://", "/")):
        method, url = "GET", first
    else:
        raise ValueError("报文首行应为“METHOD URL”或请求地址，例如：GET /api/user/list")
    if protocol == "SOAP" and method == "GET":
        method = "POST"

    headers = {}
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            break
        hm = HEADER_RE.match(line)
        if not hm:
            break
        headers[hm.group(1)] = hm.group(2).strip()
        i += 1
    body = "\n".join(lines[i:])
    return method, url, headers, body


def build_url(url, env):
    protocol = (env["protocol"] or "HTTP").upper()
    scheme = "https" if protocol == "HTTPS" else "http"
    host = str(env["ip"] or "").strip().rstrip("/")
    if host.startswith("http://") or host.startswith("https://"):
        base = host
    else:
        base = "%s://%s" % (scheme, host)
    if url.startswith("//"):
        return "%s:%s" % (scheme, url)
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if not url.startswith("/"):
        url = "/" + url
    return base + url


def split_host_port(value, default_port):
    value = str(value or "").strip()
    if value.startswith("http://") or value.startswith("https://"):
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    if value.startswith("["):
        end = value.find("]")
        host = value[1:end]
        port = default_port
        if end + 1 < len(value) and value[end + 1] == ":":
            port = int(value[end + 2:])
        return host, port
    if ":" in value:
        host, port = value.rsplit(":", 1)
        return host, int(port)
    return value, default_port


def run_tcp(content, env):
    host, port = split_host_port(env["ip"], 80)
    started = time.time()
    with socket.create_connection((host, port), timeout=HTTP_TIMEOUT) as sock:
        sock.settimeout(HTTP_TIMEOUT)
        payload = (content or "").encode("utf-8")
        if payload:
            sock.sendall(payload)
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        received = b""
        try:
            while len(received) < 4096:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                received += chunk
        except socket.timeout:
            pass
    cost = int((time.time() - started) * 1000)
    return "成功", cost, "200", received.decode("utf-8", "replace")[:1000]


def run_message(message, env, conn):
    """执行单条报文，返回 (status, cost_ms, response_code, detail)。"""
    started = time.time()
    try:
        content = render_vars(message["content"] or "", conn, env)
        if "${" in content:
            raise ValueError("存在未定义的变量：%s" % re.findall(r"\$\{[^}]+\}", content)[0])
        protocol = (env["protocol"] or "HTTP").upper()
        if protocol == "TCP":
            status, cost, code, detail = run_tcp(content, env)
            return status, cost, code, detail

        method, url, headers, body = parse_http_message(content, protocol)
        full_url = build_url(url, env)
        if body:
            if not any(k.lower() == "content-type" for k in headers):
                if protocol == "SOAP" or (message["type"] or "").upper() == "XML":
                    headers["Content-Type"] = "text/xml; charset=utf-8"
                elif (message["type"] or "").upper() == "JSON":
                    headers["Content-Type"] = "application/json; charset=utf-8"
                else:
                    headers["Content-Type"] = "text/plain; charset=utf-8"
        headers.setdefault("User-Agent", "AutoTestPlatform/1.1")
        proxies = None
        if (env["use_proxy"] or "N").upper() == "Y" and env["proxy_address"]:
            proxies = {"http": env["proxy_address"], "https": env["proxy_address"]}
        # 不使用系统环境里的代理变量，代理只由测试环境配置明确指定
        with requests.Session() as http:
            http.trust_env = False
            response = http.request(
                method,
                full_url,
                data=body.encode("utf-8") if body else None,
                headers=headers,
                timeout=HTTP_TIMEOUT,
                proxies=proxies,
                verify=False,
                allow_redirects=True,
            )
        cost = int((time.time() - started) * 1000)
        status = "成功" if response.status_code < 400 else "失败"
        detail = (response.text or "")[:1000]
        return status, cost, str(response.status_code), detail
    except Exception as exc:  # noqa: BLE001 - 执行引擎需要把任何异常记录为“异常”
        cost = int((time.time() - started) * 1000)
        return "异常", cost, "", "%s: %s" % (type(exc).__name__, str(exc)[:500])


def execute_testset(testset_id, env_id=None, trigger="手动", db=None):
    """执行测试集并写入报告，返回 report_id。"""
    conn = db if db is not None else get_db()
    testset = conn.execute(
        "SELECT * FROM testset_info WHERE testset_id=?", (testset_id,)
    ).fetchone()
    if testset is None:
        raise ValueError("测试集不存在")
    if testset["type"] != "测试集":
        raise ValueError("只能执行类型为“测试集”的记录")
    scene_ids = parse_id_list(testset["scene_ids"])
    if not scene_ids:
        raise ValueError("测试集尚未关联组合场景")
    env = None
    if env_id:
        env = conn.execute("SELECT * FROM env_info WHERE env_id=?", (env_id,)).fetchone()
        if env is None:
            raise ValueError("测试环境不存在")
    if env is None:
        env = conn.execute("SELECT * FROM env_info ORDER BY env_id LIMIT 1").fetchone()
    if env is None:
        raise ValueError("请先在“测试环境”中配置至少一个环境")

    scene_count = success = fail = exception = total_cost = 0
    details = []
    for scene_id in scene_ids:
        scene = conn.execute("SELECT * FROM scene_info WHERE scene_id=?", (scene_id,)).fetchone()
        if scene is None:
            continue
        scene_count += 1
        message_ids = parse_id_list(scene["message_ids"])
        for message_id in message_ids:
            message = conn.execute(
                "SELECT * FROM message_info WHERE message_id=?", (message_id,)
            ).fetchone()
            if message is None:
                continue
            status, cost, code, detail = run_message(message, env, conn)
            total_cost += cost
            if status == "成功":
                success += 1
            elif status == "失败":
                fail += 1
            else:
                exception += 1
            details.append(
                {
                    "scene_name": scene["name"],
                    "message_name": message["message_name"],
                    "interface_name": message["interface_name"],
                    "protocol": env["protocol"],
                    "format": message["type"],
                    "status": status,
                    "response_code": code,
                    "cost_time": cost,
                    "detail": detail,
                }
            )
    total = success + fail + exception
    rate = round(success * 100.0 / total, 2) if total else 0
    last = details[-1] if details else {}
    cur = conn.execute(
        "INSERT INTO report_info(scene_count,success_count,fail_count,execute_date,exception_count,"
        "success_rate,interface_name,protocol,format,message,scene,env,data_pool,status,cost_time)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            scene_count,
            success,
            fail,
            now()[:10],
            exception,
            rate,
            last.get("interface_name"),
            last.get("protocol"),
            last.get("format"),
            last.get("message_name"),
            last.get("scene_name"),
            env["name"],
            "",
            "%s执行完成" % trigger,
            total_cost,
        ),
    )
    report_id = cur.lastrowid
    if details:
        conn.executemany(
            "INSERT INTO report_detail_info(report_id,scene_name,message_name,interface_name,protocol,"
            "format,status,response_code,cost_time,detail,create_time) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    report_id,
                    d["scene_name"],
                    d["message_name"],
                    d["interface_name"],
                    d["protocol"],
                    d["format"],
                    d["status"],
                    d["response_code"],
                    d["cost_time"],
                    d["detail"],
                    now(),
                )
                for d in details
            ],
        )
    conn.commit()
    return report_id


@app.post("/api/execute/run")
@login_required
def execute_run():
    body = json_body() or {}
    try:
        testset_id = int(body.get("testset_id"))
    except (TypeError, ValueError):
        return api_err("请选择测试集")
    env_id = body.get("env_id")
    if env_id in ("", None):
        env_id = None
    else:
        try:
            env_id = int(env_id)
        except (TypeError, ValueError):
            return api_err("测试环境不合法")
    try:
        report_id = execute_testset(testset_id, env_id, trigger="手动")
    except ValueError as exc:
        return api_err(str(exc))
    report = get_db().execute(
        "SELECT * FROM report_info WHERE report_id=?", (report_id,)
    ).fetchone()
    data = dict(report)
    data["detail_count"] = get_db().execute(
        "SELECT COUNT(*) AS c FROM report_detail_info WHERE report_id=?", (report_id,)
    ).fetchone()["c"]
    return api_ok(data, "执行完成")


@app.get("/api/report/detail/<int:report_id>")
@login_required
def report_detail(report_id):
    conn = get_db()
    report = conn.execute(
        "SELECT * FROM report_info WHERE report_id=?", (report_id,)
    ).fetchone()
    if report is None:
        return api_err("报告不存在", 404, 404)
    details = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM report_detail_info WHERE report_id=? ORDER BY detail_id",
            (report_id,),
        ).fetchall()
    ]
    return api_ok({"report": dict(report), "details": details})


@app.get("/api/report/summary")
@login_required
def report_summary():
    conn = get_db()
    by_date = [
        dict(r)
        for r in conn.execute(
            "SELECT execute_date AS d, ROUND(AVG(success_rate),2) AS rate, COUNT(*) AS c "
            "FROM report_info GROUP BY execute_date ORDER BY execute_date"
        ).fetchall()
    ]
    totals = dict(
        conn.execute(
            "SELECT COUNT(*) AS total, IFNULL(SUM(success_count),0) AS success, "
            "IFNULL(SUM(fail_count),0) AS fail, IFNULL(SUM(exception_count),0) AS exception "
            "FROM report_info"
        ).fetchone()
    )
    return api_ok({"by_date": by_date, "totals": totals})


@app.get("/api/stats")
@login_required
def stats():
    conn = get_db()
    tables = {
        "interface": "interface_info",
        "message": "message_info",
        "scene": "scene_info",
        "testset": "testset_info",
        "report": "report_info",
        "task": "task_info",
    }
    data = {key: conn.execute("SELECT COUNT(*) AS c FROM %s" % table).fetchone()["c"]
            for key, table in tables.items()}
    return api_ok(data)


# ---------------------------------------------------------------------------
# 定时任务调度
# ---------------------------------------------------------------------------
_scheduler_started = False
_scheduler_lock = threading.Lock()
_running_tasks = set()
_running_lock = threading.Lock()


def task_is_due(expr, now_dt, last_dt):
    """判断任务在本分钟是否应当触发；同一分钟只触发一次。"""
    expr = (expr or "").strip()
    if not valid_cron(expr):
        return False
    try:
        if not croniter.match(expr, now_dt):
            return False
    except Exception:
        return False
    if last_dt is not None:
        if isinstance(last_dt, str):
            try:
                last_dt = datetime.fromisoformat(last_dt)
            except ValueError:
                last_dt = None
        if last_dt is not None and last_dt.strftime("%Y-%m-%d %H:%M") == now_dt.strftime("%Y-%m-%d %H:%M"):
            return False
    return True


def _execute_task(task_id):
    try:
        with app.app_context():
            conn = get_db()
            task = conn.execute("SELECT * FROM task_info WHERE task_id=?", (task_id,)).fetchone()
            if task is None or task["status"] != "开启":
                return
            # 先记执行次数/时间，避免同一分钟被重复触发
            conn.execute(
                "UPDATE task_info SET execute_count=execute_count+1, last_execute_time=? WHERE task_id=?",
                (now(), task_id),
            )
            conn.commit()
            if task["type"] and task["type"] != "测试集执行":
                log.info("定时任务 %s 类型为 %s，不执行测试集", task["name"], task["type"])
                return
            testset = conn.execute(
                "SELECT * FROM testset_info WHERE name=? AND type='测试集'",
                (task["testset"],),
            ).fetchone()
            if testset is None:
                log.warning("定时任务 %s 的测试集不存在：%s", task["name"], task["testset"])
                return
            env = conn.execute("SELECT * FROM env_info ORDER BY env_id LIMIT 1").fetchone()
            report_id = execute_testset(
                testset["testset_id"],
                env["env_id"] if env else None,
                trigger="定时",
                db=conn,
            )
            log.info("定时任务 %s 执行完成，报告 #%s", task["name"], report_id)
    except Exception:
        log.exception("定时任务 #%s 执行失败", task_id)
    finally:
        with _running_lock:
            _running_tasks.discard(task_id)


def run_due_tasks(now_dt=None):
    now_dt = now_dt or datetime.now()
    conn = get_db()
    tasks = conn.execute("SELECT * FROM task_info WHERE status='开启'").fetchall()
    for task in tasks:
        if not task_is_due(task["cron_expression"], now_dt, task["last_execute_time"]):
            continue
        with _running_lock:
            if task["task_id"] in _running_tasks:
                continue
            _running_tasks.add(task["task_id"])
        threading.Thread(
            target=_execute_task,
            args=(task["task_id"],),
            daemon=True,
            name="scheduled-task-%s" % task["task_id"],
        ).start()


def _scheduler_loop():
    log.info("定时任务调度线程已启动，轮询间隔 %s 秒", SCHEDULER_INTERVAL)
    while True:
        try:
            with app.app_context():
                run_due_tasks()
        except Exception:
            log.exception("定时任务轮询失败")
        time.sleep(max(5, SCHEDULER_INTERVAL))


def start_scheduler():
    global _scheduler_started
    if not SCHEDULER_ENABLED:
        log.info("定时任务调度已通过 AUTOTEST_SCHEDULER=0 关闭")
        return
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
    threading.Thread(target=_scheduler_loop, daemon=True, name="autotest-scheduler").start()


# ---------------------------------------------------------------------------
# 页面与静态资源
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    response = send_from_directory(BASE_DIR, "index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@app.get("/app.js")
def root_appjs():
    return send_from_directory(STATIC_DIR, "app.js")


@app.get("/chart.umd.min.js")
def root_chartjs():
    return send_from_directory(STATIC_DIR, "chart.umd.min.js")


@app.get("/favicon.ico")
def favicon():
    return "", 204


@app.get("/healthz")
def healthz():
    return api_ok({"status": "ok", "time": now()})


@app.after_request
def add_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    if request.path in ("/", "/app.js", "/static/app.js", "/static/index.html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@app.errorhandler(HTTPException)
def handle_http_error(exc):
    if request.path.startswith("/api/"):
        return api_err(exc.description or "请求失败", exc.code or 500, exc.code or 500)
    return exc.get_response()


@app.errorhandler(Exception)
def handle_unexpected_error(exc):
    log.exception("未处理的异常：%s %s", request.method, request.path)
    if request.path.startswith("/api/"):
        return api_err("服务器内部错误：%s" % exc, 500, 500)
    return "服务器内部错误", 500


# 启动时建库并启动调度线程（也兼容 flask run / gunicorn 导入启动）
init_db()
start_scheduler()


if __name__ == "__main__":
    log.info("数据库：%s", DB_PATH)
    log.info("自动化测试平台已启动：http://127.0.0.1:%s", PORT)
    try:
        app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)
    except OSError as exc:
        raise SystemExit("启动失败：端口 %s 可能已被占用（%s）" % (PORT, exc))

