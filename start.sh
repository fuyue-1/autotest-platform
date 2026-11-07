#!/usr/bin/env bash
set -e
export PYTHONUTF8=1
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON=python
fi
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "未找到 Python，请先安装 Python 3.9+"
  exit 1
fi

if ! "$PYTHON" -c "import flask, requests, croniter" >/dev/null 2>&1; then
  echo "正在安装依赖 ..."
  "$PYTHON" -m pip install -r requirements.txt
fi

echo "自动化测试平台启动中，浏览器访问：http://127.0.0.1:8080"
echo "停止服务请按 Ctrl+C"
exec "$PYTHON" app.py
