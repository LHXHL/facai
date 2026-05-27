#!/bin/bash
# =========================================
# 启动服务 (Linux/Mac)
# =========================================

echo "========================================"
echo "启动服务..."
echo "========================================"

# 启动 Mitmproxy（独立进程）
echo "[1/3] 启动 Mitmproxy..."
python3 mitmproxy_service.py &
MITMPROXY_PID=$!

# 等待3秒让 Mitmproxy 启动
sleep 3

# 启动服务管理器
echo "[2/3] 启动服务管理器 (Chrome)..."
python3 service_manager.py &
SERVICE_PID=$!

# 等待5秒让服务管理器启动
sleep 5

# 启动 Flask
echo "[3/3] 启动 Flask..."
python3 app.py &
FLASK_PID=$!

echo "========================================"
echo "服务已启动！"
echo "- Mitmproxy: 端口 18081"
echo "- Chrome监控: 每10秒自动检测"
echo "- Flask Web: 端口 5001"
echo "========================================"
echo "按 Ctrl+C 停止所有服务..."

# 捕获退出信号，清理子进程
cleanup() {
    echo ""
    echo "正在关闭服务..."
    kill $MITMPROXY_PID $SERVICE_PID $FLASK_PID 2>/dev/null
    # 等待进程结束
    wait $MITMPROXY_PID $SERVICE_PID $FLASK_PID 2>/dev/null
    echo "服务已关闭"
    exit 0
}

trap cleanup SIGINT SIGTERM

# 等待任意子进程退出
wait
