# coding: utf-8
"""
@Time :    1/17/2025 17:47
@Author:  fff
@File: mitmproxy_service.py
@Software: PyCharm
@Desc: Mitmproxy流量监测服务管理类
"""
import subprocess
import time
import sys
import os
import base64
import socket
import json as _json
import urllib.request
import threading
from typing import Any
from mitmproxy import http
from mitmproxy.tools.main import mitmdump

# 导入必要的类
from service.Class_Core_Function import Class_Core_Function
from service.Class_check import class_check
from database.mongodb_handler import MongoDBHandler

# 全局变量 - 缓存配置和实例
_core_function = Class_Core_Function()
_class_check = None
_db_handler = None
_running_project_config = None


def get_running_config():
    """获取运行中的项目配置(带缓存)"""
    global _running_project_config
    if _running_project_config is None:
        _running_project_config = _core_function.callback_project_config()
    return _running_project_config


def get_class_check():
    """获取class_check实例(单例)"""
    global _class_check
    if _class_check is None:
        _class_check = class_check()
    return _class_check


def get_db_handler():
    """获取MongoDB handler实例(单例)"""
    global _db_handler
    if _db_handler is None:
        _db_handler = MongoDBHandler()
    return _db_handler


class MitmproxyService:
    """Mitmproxy流量捕捉服务管理类"""

    def __init__(self):
        self.Core_Function = Class_Core_Function()
        self.class_check = class_check()
        self.db_handler = MongoDBHandler()
        self.process = None
        self.is_running = False
        self.port = None

    def get_port(self):
        """获取配置的mitmproxy端口"""
        try:
            config = self.Core_Function.callback_config()
            if config:
                return config.get('mitmproxy_port', 18081)
        except Exception as e:
            print(f"获取端口配置失败: {str(e)}")
        return 18081

    def check_port_in_use(self, port):
        """检查端口是否被占用"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(('localhost', port)) == 0
        except:
            return False

    def start(self):
        """启动Mitmproxy服务"""
        try:
            if self.is_running:
                return {'success': False, 'message': 'Mitmproxy已在运行中'}

            port = self.get_port()
            if self.check_port_in_use(port):
                return {'success': False, 'message': f'端口 {port} 已被占用'}

            # 启动mitmproxy - 不传参数，子进程内部从配置获取
            script_path = os.path.abspath(__file__)
            
            cmd = [sys.executable, script_path]

            # 设置环境变量
            env = os.environ.copy()
            project_root = os.path.dirname(script_path)
            env['PYTHONPATH'] = project_root + os.pathsep + env.get('PYTHONPATH', '')

            # 启动进程
            print(f"启动命令: {' '.join(cmd)}")
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env
            )

            # 等待启动
            time.sleep(3)

            if self.process.poll() is None:
                self.is_running = True
                self.port = port
                return {'success': True, 'message': f'Mitmproxy启动成功，端口: {port}'}
            else:
                _, stderr = self.process.communicate()
                error_msg = stderr.strip() if stderr else '未知错误'
                print(f"Mitmproxy启动失败详情: {error_msg}")
                return {'success': False, 'message': f'Mitmproxy启动失败: {error_msg}'}
        except Exception as e:
            return {'success': False, 'message': f'启动失败: {str(e)}'}

    def stop(self):
        """停止Mitmproxy服务"""
        try:
            if not self.is_running:
                return {'success': False, 'message': 'Mitmproxy未运行'}

            if self.process:
                self.process.terminate()
                self.process.wait(timeout=5)
                self.process = None

            self.is_running = False
            self.port = None
            return {'success': True, 'message': 'Mitmproxy已停止'}
        except Exception as e:
            return {'success': False, 'message': f'停止失败: {str(e)}'}

    def restart(self):
        """重启Mitmproxy服务"""
        stop_result = self.stop()
        if not stop_result['success']:
            return {'success': False, 'message': f'停止失败: {stop_result["message"]}'}

        time.sleep(1)
        return self.start()

    def get_status(self):
        """获取服务状态 - 通过端口检测实际运行状态"""
        port = self.port or self.get_port()
        actual_running = self.check_port_in_use(port)
        self.is_running = actual_running
        
        return {
            'is_running': actual_running,
            'port': port
        }


# Mitmproxy addon - 当作为脚本执行时，这些函数会被mitmproxy调用
def request(flow: http.HTTPFlow) -> None:
    """
    Mitmproxy请求回调函数
    把http请求写入mongodb数据库project_{name}_traffic表
    """
    try:
        #print(flow.request.url)
        # 跳过异常/中断的连接（HTTP/2协商失败等）
        if flow.error:
            print(f"请求异常: {flow.error}")
            return
        running_project = get_running_config()
        if not running_project:
            return
        project_name = running_project.get('Project', 'default')

        check_instance = get_class_check()
        
        try:
            fetch_dest = flow.request.headers.get("sec-fetch-dest", "").lower()
            if fetch_dest in ["image", "style", "font"]:
                return
        except:
            pass
        if check_instance.check_traffic_url(flow.request.url)==False:
            return
        try:
            headers = dict(flow.request.headers)

            # 标准化：移除不应被重放的请求头（大小写不敏感）
            # - hop-by-hop headers：代理/传输层专用，不应对端到端重放
            # - 条件请求headers：会导致304而非200
            # - WebSocket headers：不属于普通HTTP重放
            _remove_headers_lower = {
                'host',                    # 由requests库根据URL自动设置
                'connection',              # 传输层控制
                'content-length',          # 由requests库根据body自动计算
                'transfer-encoding',       # 传输层编码
                'upgrade',                 # 协议升级（WebSocket等）
            }
            for key in list(headers.keys()):
                if key.lower() in _remove_headers_lower:
                    del headers[key]

            # 标准化Cookie分隔符：dict()会将多个同名Cookie头用', '拼接，
            # 但HTTP标准Cookie分隔符是'; '。必须从原始headers取每个Cookie头再正确拼接，
            # 不能用replace，否则Cookie值中的', '也会被误替换（如pref=light, dark）
            raw_cookies = flow.request.headers.get_all('Cookie')
            if raw_cookies:
                for key in list(headers.keys()):
                    if key.lower() == 'cookie':
                        headers[key] = '; '.join(raw_cookies)
                        break

            # 判断是否为multipart/form-data（包含文件上传的二进制数据）
            content_type = headers.get('Content-Type', headers.get('content-type', ''))
            is_multipart = 'multipart/form-data' in content_type
            if is_multipart and flow.request.content:
                # multipart请求体含二进制文件数据，用base64编码存储
                body = base64.b64encode(flow.request.content).decode('ascii')
                body_encoding = 'base64'
            else:
                body = flow.request.content.decode('utf-8', errors='ignore') if flow.request.content else ''
                body_encoding = 'plain'

            request_task = {
                'url': flow.request.url,
                'website': _core_function.callback_split_url(flow.request.url, 0),
                'method': flow.request.method,
                'headers': headers,
                'body': body,
                'body_encoding': body_encoding,
                'time': _core_function.callback_time(0),
                'scaner_status':0,
                'status': 0,
                'source': 0
            }

            db_handler = get_db_handler()
            collection_name = f"project_{project_name}_traffic"
            db_handler.insert_one(collection_name, request_task)

        except Exception as insert_error:
            print(f"数据库插入错误: {str(insert_error)}")
        
    except Exception as e:
        pass


def _send_to_capture_api(capture_item):
    try:
        try:
            config = _core_function.callback_config()
            flask_port = str(config.get('flask_port', 5001)) if config else '5001'
        except Exception:
            flask_port = '5001'
        url = f'http://127.0.0.1:{flask_port}/api/capture/add'
        data = _json.dumps(capture_item, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
        threading.Thread(target=lambda: _do_send(req), daemon=True).start()
    except Exception:
        pass


def _do_send(req):
    try:
        urllib.request.urlopen(req, timeout=1)
    except Exception:
        pass


def response(flow: http.HTTPFlow) -> None:
    """
    Mitmproxy响应回调函数
    把请求+响应存入内存捕捉缓冲区（通过Flask API），最多200条
    """
    try:
        if flow.error:
            return
        running_project = get_running_config()
        if not running_project:
            return

        check_instance = get_class_check()
        try:
            fetch_dest = flow.request.headers.get("sec-fetch-dest", "").lower()
            if fetch_dest in ["image", "style", "font"]:
                return
        except:
            pass
        if check_instance.check_file_ext(flow.request.url) == False:
            return

        req_headers = dict(flow.request.headers)
        _remove_headers_lower = {
            'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
        }
        for key in list(req_headers.keys()):
            if key.lower() in _remove_headers_lower:
                del req_headers[key]

        raw_cookies = flow.request.headers.get_all('Cookie')
        if raw_cookies:
            for key in list(req_headers.keys()):
                if key.lower() == 'cookie':
                    req_headers[key] = '; '.join(raw_cookies)
                    break

        content_type = req_headers.get('Content-Type', req_headers.get('content-type', ''))
        is_multipart = 'multipart/form-data' in content_type
        if is_multipart and flow.request.content:
            req_body = base64.b64encode(flow.request.content).decode('ascii')
            req_body_encoding = 'base64'
        else:
            req_body = flow.request.content.decode('utf-8', errors='ignore') if flow.request.content else ''
            req_body_encoding = 'plain'

        resp_headers = {}
        if flow.response:
            resp_headers = dict(flow.response.headers)

        resp_body = ''
        resp_body_encoding = 'plain'
        if flow.response and flow.response.content:
            resp_content_type = resp_headers.get('Content-Type', resp_headers.get('content-type', ''))
            is_binary = any(t in resp_content_type.lower() for t in ['image/', 'video/', 'audio/', 'font', 'octet-stream', 'zip', 'pdf'])
            if is_binary:
                resp_body = base64.b64encode(flow.response.content).decode('ascii')
                resp_body_encoding = 'base64'
            else:
                try:
                    resp_body = flow.response.content.decode('utf-8', errors='ignore')
                except:
                    resp_body = base64.b64encode(flow.response.content).decode('ascii')
                    resp_body_encoding = 'base64'

        status_code = flow.response.status_code if flow.response else 0
        server = resp_headers.get('Server', resp_headers.get('server', ''))
        resp_content_type_val = resp_headers.get('Content-Type', resp_headers.get('content-type', ''))

        capture_item = {
            'url': flow.request.url,
            'website': _core_function.callback_split_url(flow.request.url, 0),
            'method': flow.request.method,
            'status_code': status_code,
            'server': server,
            'content_type': resp_content_type_val,
            'request': {
                'method': flow.request.method,
                'url': flow.request.url,
                'headers': req_headers,
                'body': req_body,
                'body_encoding': req_body_encoding,
            },
            'response': {
                'status_code': status_code,
                'headers': resp_headers,
                'body': resp_body,
                'body_encoding': resp_body_encoding,
            },
            'response_time': '',
            'time': _core_function.callback_time(0),
        }

        _send_to_capture_api(capture_item)

    except Exception as e:
        pass


if __name__ == '__main__':
    # 从配置获取端口和项目信息
    config = _core_function.callback_config()
    port = config.get('mitmproxy_port', 18081) if config else 18081
    
    project_config = _core_function.callback_project_config()
    project_name = project_config.get('Project', 'default') if project_config else 'default'
    
    socks5_proxy = _core_function.callback_socks5_proxy()
    
    mode = 'regular'
    if socks5_proxy:
        upstream_url = socks5_proxy.replace('socks5h://', 'http://', 1)
        mode = f'upstream:{upstream_url}'
    
    print(f"启动Mitmproxy代理服务: project={project_name}, port={port}, mode={mode}, socks5={socks5_proxy or '无'}")
    
    args = [
        '-s', __file__,
        '-p', str(port),
        '--mode', mode,
        '--set', 'stream_large_bodies=50m',
        '--set', 'ssl_insecure=true',
        '--set', 'tcp_keepalive=60',
        '--set', 'timeout=300',
        '--set', 'connection_strategy=eager',
        '--set', 'dns_fail_mode=abort',
        '--set', 'http2=true',
        '--set', 'hard_close=true',
        '--set', 'validate_inbound_headers=false',
        '--quiet',
    ]
    
    mitmdump(args)
