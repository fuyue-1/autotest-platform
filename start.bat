@echo off
chcp 65001 >nul
set PYTHONUTF8=1
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Python，请先安装 Python 3.9+ 并勾选 "Add Python to PATH"。
  pause
  exit /b 1
)

python -c "import flask, requests, croniter" >nul 2>nul
if errorlevel 1 (
  echo [提示] 正在安装依赖 Flask / requests / croniter ...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后手动执行：python -m pip install -r requirements.txt
    pause
    exit /b 1
  )
)

echo.
echo 自动化测试平台启动中，浏览器访问：http://127.0.0.1:8080
echo 停止服务请按 Ctrl+C
echo.
python app.py
pause
