# coding: utf-8
"""
独立服务管理器
@Time :    4/9/2026
@Author:  facai
@File: service_manager.py
@Software: VSCode

功能说明：
1. 独立于 Flask 运行，修改 Flask 代码不会影响服务
2. 管理 Chrome(headless/normal) 的启动和停止（通过 ChromeService）
3. 提供状态监测 HTTP API（端口 5002）
4. Mitmproxy 由 start.bat 独立启动

启动顺序：
1. 等待项目运行
2. 启动 Chrome headless（通过 ChromeService）
3. Chrome normal 仅监测 CDP 状态，不进行启停管理
"""

import time
import json
import os
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from service.Class_Core_Function import Class_Core_Function
from service.libs.chrome_manage import ChromeService, CHROME_PID_FILE
from service.scaner.vuln_core import VulnerabilityScanner
from service.spider.asset_monitor import AssetMonitor
from service.spider.core import SpiderCore


class ServiceManager:
    """服务管理器"""
    
    def __init__(self):
        self.Core_Function = Class_Core_Function()
        self.chrome_service = ChromeService()
        
        self.auto_scan_thread = None
        self.auto_scan_running = False
        self.asset_monitor = None
        self.asset_monitor_thread = None
        self.asset_monitor_running = False
        self.spider_core = None
        self.spider_thread = None
        
        self.services_status = {
            'mitmproxy': {'running': False, 'port': None},
            'chrome_headless': {'running': False, 'port': None},
            'chrome_normal': {'running': False, 'port': None},
            'auto_scan': {'running': False},
            'asset_monitor': {'running': False},
            'spider': {'running': False}
        }
        
        self.config = None
        self.load_config()
    
    def load_config(self):
        try:
            self.config = self.Core_Function.callback_config()
            if not self.config:
                print("[配置] 未找到配置文件，使用默认配置")
                self.config = {
                    'chrome_path': '',
                    'chrome_cdp_port': 19227,
                    'chrome_spider_cdp_port': 19228,
                    'mitmproxy_port': 18081,
                }
        except Exception as e:
            print(f"[配置] 加载配置失败: {e}")
            self.config = {}
    
    def check_port_in_use(self, port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(('localhost', port)) == 0
        except:
            return False
    
    def wait_for_project(self, timeout=300):
        print("[项目] 等待项目运行...")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                project_config = self.Core_Function.callback_project_config()
                if project_config and project_config.get('Project'):
                    project_name = project_config.get('Project')
                    print(f"[项目] 检测到运行项目: {project_name}")
                    return True
            except:
                pass
            
            print("[项目] 未检测到运行项目，10秒后重试...")
            time.sleep(10)
        
        print(f"[项目] 等待超时（{timeout}秒），退出")
        return False
    
    def start_chrome(self):
        try:
            result = self.chrome_service.start(mode='headless')
            print(f"[Chrome headless] {result['message']}")
            if result['success']:
                self.services_status['chrome_headless']['running'] = True
                self.services_status['chrome_headless']['port'] = self.chrome_service.port
                return True
            else:
                return False
        except Exception as e:
            print(f"[Chrome headless] 启动失败: {e}")
            return False
    
    def start_auto_scan(self, batch_size=10):
        try:
            project_config = self.Core_Function.callback_project_config()
            if not project_config:
                print("[AutoScan] 无法获取项目配置，跳过自动扫描")
                return False
            
            project_name = project_config.get('Project', '')
            if not project_name:
                print("[AutoScan] 项目名称为空，跳过自动扫描")
                return False
            
            dnslog_domain = project_config.get('dnslog_domain', '')
            dnslog_url = project_config.get('dnslog_url', '')
            
            scanner = VulnerabilityScanner(
                dnslog_domain=dnslog_domain,
                dnslog_url=dnslog_url,
                project_name=project_name
            )
            
            print(f"[AutoScan] 初始化自动扫描服务，批次大小 {batch_size}")
            
            self.auto_scan_running = True
            self.auto_scan_thread = threading.Thread(
                target=scanner.auto_scan,
                args=(batch_size,),
                daemon=True
            )
            self.auto_scan_thread.start()
            
            print("[AutoScan] 自动扫描服务已启动")
            self.services_status['auto_scan']['running'] = True
            return True
            
        except Exception as e:
            print(f"[AutoScan] 启动失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def stop_auto_scan(self):
        print("[AutoScan] 停止自动扫描服务...")
        self.auto_scan_running = False
        self.auto_scan_thread = None
        self.services_status['auto_scan']['running'] = False
        print("[AutoScan] 自动扫描服务已停止")
    
    def start_asset_monitor(self):
        try:
            print("[AssetMonitor] 初始化资产监控服务...")
            
            self.asset_monitor = AssetMonitor()
            
            self.asset_monitor_running = True
            self.asset_monitor_thread = threading.Thread(
                target=self.asset_monitor.run,
                daemon=True
            )
            self.asset_monitor_thread.start()
            
            print("[AssetMonitor] 资产监控服务已启动")
            self.services_status['asset_monitor']['running'] = True
            return True
            
        except Exception as e:
            print(f"[AssetMonitor] 启动失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def stop_asset_monitor(self):
        print("[AssetMonitor] 停止资产监控服务...")
        self.asset_monitor_running = False
        if hasattr(self, 'asset_monitor') and self.asset_monitor:
            self.asset_monitor.is_running = False
        self.asset_monitor_thread = None
        self.asset_monitor = None
        self.services_status['asset_monitor']['running'] = False
        print("[AssetMonitor] 资产监控服务已停止")
    
    def start_spider(self):
        try:
            print("[Spider] 初始化爬虫服务...")
            
            project_config = self.Core_Function.callback_project_config()
            if not project_config:
                print("[Spider] 无法获取项目配置，跳过爬虫启动")
                return False
            
            project_name = project_config.get('Project', '')
            if not project_name:
                print("[Spider] 项目名称为空，跳过爬虫启动")
                return False
            
            self.spider_core = SpiderCore(project_name)
            self.spider_thread = threading.Thread(
                target=self.spider_core.run,
                daemon=True
            )
            self.spider_thread.start()
            
            print(f"[Spider] 爬虫服务已启动 (项目: {project_name}，通过数据库 spider_service 控制运行)")
            self.services_status['spider']['running'] = True
            return True
            
        except Exception as e:
            print(f"[Spider] 启动失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def start_all(self):
        print("\n" + "=" * 60)
        print("开始启动服务...")
        print("=" * 60)
        
        if not self.wait_for_project():
            print("\n启动失败：未检测到运行项目")
            return False
        
        print("\n[1/4] 启动 Chrome (headless)...")
        if not self.start_chrome():
            print("Chrome headless 启动失败")
        
        print("\n[2/4] 启动自动扫描服务...")
        if not self.start_auto_scan(batch_size=10):
            print("自动扫描服务启动失败（不影响其他服务）")
        
        print("\n[3/4] 启动资产监控服务...")
        if not self.start_asset_monitor():
            print("资产监控服务启动失败（不影响其他服务）")
        
        print("\n[4/4] 启动爬虫服务...")
        if not self.start_spider():
            print("爬虫服务启动失败（不影响其他服务）")
        
        print("\n" + "=" * 60)
        print("服务启动完成！")
        self.print_status()
        print("=" * 60)
        
        return True
    
    def stop_all(self):
        print("\n停止所有服务...")
        
        self.chrome_service.stop()
        
        for key in self.services_status:
            self.services_status[key]['running'] = False
        
        print("所有服务已停止")
    
    def get_status(self):
        mitmproxy_port = self.config.get('mitmproxy_port', 18081)
        self.services_status['mitmproxy']['running'] = self.check_port_in_use(mitmproxy_port)
        self.services_status['mitmproxy']['port'] = mitmproxy_port
        
        chrome_cdp_port = self.config.get('chrome_cdp_port', 19227)
        self.services_status['chrome_headless']['running'] = self.check_port_in_use(chrome_cdp_port)
        self.services_status['chrome_headless']['port'] = chrome_cdp_port
        
        chrome_spider_cdp_port = self.config.get('chrome_spider_cdp_port', 19228)
        self.services_status['chrome_normal']['running'] = self.check_port_in_use(chrome_spider_cdp_port)
        self.services_status['chrome_normal']['port'] = chrome_spider_cdp_port
        
        spider_active = self.spider_thread and self.spider_thread.is_alive()
        self.services_status['spider']['running'] = spider_active
        
        return self.services_status
    
    def print_status(self):
        status = self.get_status()
        print("\n服务状态:")
        for service, info in status.items():
            running = "运行中" if info.get('running') else "已停止"
            port = f" (端口: {info['port']})" if info.get('port') else ""
            print(f"  - {service}: {running}{port}")
    
    def monitor_chrome(self):
        time.sleep(30)
        print("[监控] 开始检测 Chrome 状态...")
        
        while True:
            time.sleep(10)
            
            try:
                chrome_cdp_port = self.config.get('chrome_cdp_port', 19227)
                if not self.check_port_in_use(chrome_cdp_port):
                    print(f"[监控] Chrome headless 端口 {chrome_cdp_port} 未监听，正在重启...")
                    self.start_chrome()
                
                chrome_spider_cdp_port = self.config.get('chrome_spider_cdp_port', 19228)
                if not self.check_port_in_use(chrome_spider_cdp_port):
                    print(f"[监控] Chrome normal 端口 {chrome_spider_cdp_port} 未监听（仅监测，不自动重启）")
                    
            except Exception as e:
                print(f"[监控] 检测异常: {e}")


class StatusAPIHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        pass
    
    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        if path == '/api/service/status':
            status = service_manager.get_status()
            self.send_json_response(status)
        
        elif path == '/api/service/start':
            result = service_manager.start_all()
            self.send_json_response({'success': result})
        
        elif path == '/api/service/stop':
            service_manager.stop_all()
            self.send_json_response({'success': True})
        
        elif path == '/api/service/restart':
            service_manager.stop_all()
            time.sleep(2)
            result = service_manager.start_all()
            self.send_json_response({'success': result})
        
        else:
            self.send_error(404, "Not Found")
    
    def send_json_response(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))


def run_api_server(port=5002):
    server = HTTPServer(('0.0.0.0', port), StatusAPIHandler)
    print(f"\n[API] 状态监测 API 已启动: http://127.0.0.1:{port}")
    print(f"[API] 接口列表:")
    print(f"  - GET /api/service/status  - 获取服务状态")
    print(f"  - GET /api/service/start   - 启动所有服务")
    print(f"  - GET /api/service/stop    - 停止所有服务")
    print(f"  - GET /api/service/restart - 重启所有服务")
    server.serve_forever()


service_manager = None


def main():
    global service_manager
    
    print("=" * 60)
    print("独立服务管理器")
    print("=" * 60)
    
    service_manager = ServiceManager()
    
    service_manager.start_all()
    
    api_thread = threading.Thread(target=run_api_server, args=(5002,), daemon=True)
    api_thread.start()
    
    monitor_thread = threading.Thread(target=service_manager.monitor_chrome, daemon=True)
    monitor_thread.start()
    
    print("\n服务管理器已就绪，按 Ctrl+C 退出...")
    print("[监控] Chrome 状态监控已启动（每10秒检测一次）")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n收到退出信号，正在停止服务...")
        service_manager.stop_all()
        print("服务管理器已退出")


if __name__ == '__main__':
    main()
