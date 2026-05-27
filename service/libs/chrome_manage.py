# coding: utf-8
"""
@Time :    3/17/2026
@Author:  facai
@File: chrome_manage.py
@Software: VSCode
@Desc: Chrome CDP服务管理类
"""
import subprocess
import time
import sys
import os
import socket
import signal
import psutil
from service.Class_Core_Function import Class_Core_Function


CHROME_PID_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'chrome_headless.pid')


class ChromeService:
    """Chrome CDP服务管理类"""

    def __init__(self):
        self.Core_Function = Class_Core_Function()
        self.process = None
        self.is_running = False
        self.port = None
        self.mode = 'normal'

    def get_config(self):
        try:
            config = self.Core_Function.callback_config()
            if config:
                return {
                    'chrome_path': config.get('chrome_path', ''),
                    'chrome_cdp_port': config.get('chrome_cdp_port', 19227),
                }
        except Exception as e:
            print(f"获取Chrome配置失败: {str(e)}")
        return {
            'chrome_path': '',
            'chrome_cdp_port': 19227,
        }

    def check_port_in_use(self, port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(('localhost', port)) == 0
        except:
            return False

    def _save_pid(self, pid):
        try:
            with open(CHROME_PID_FILE, 'w') as f:
                f.write(str(pid))
        except Exception as e:
            print(f"[Chrome] 保存PID文件失败: {e}")

    def _kill_by_pid_file(self):
        try:
            if not os.path.exists(CHROME_PID_FILE):
                return
            with open(CHROME_PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            try:
                proc = psutil.Process(pid)
                for child in proc.children(recursive=True):
                    try:
                        child.kill()
                    except:
                        pass
                proc.kill()
                print(f"[Chrome] 已杀掉进程树 PID={pid}")
            except psutil.NoSuchProcess:
                pass
            except psutil.AccessDenied:
                pass
            try:
                os.remove(CHROME_PID_FILE)
            except:
                pass
        except Exception as e:
            print(f"[Chrome] PID文件清理失败: {e}")

    def kill_existing_chrome(self, port):
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    if proc.info['name'] and 'chrome' in proc.info['name'].lower():
                        cmdline = proc.info['cmdline']
                        if cmdline and any(f'--remote-debugging-port={port}' in arg for arg in cmdline):
                            print(f"杀掉现有Chrome进程: PID={proc.info['pid']}")
                            proc.terminate()
                            time.sleep(1)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception as e:
            print(f"清理Chrome进程失败: {str(e)}")

    def start(self, mode='headless'):
        try:
            if mode == 'normal':
                config = self.get_config()
                cdp_port = config.get('chrome_cdp_port', 19227)
                running = self.check_port_in_use(cdp_port)
                self.is_running = running
                self.port = cdp_port if running else None
                self.mode = 'normal'
                if running:
                    return {'success': True, 'message': f'Chrome normal 运行中，CDP端口: {cdp_port}'}
                else:
                    return {'success': False, 'message': f'Chrome normal 未运行（仅监测，不自动启动）'}

            if self.is_running:
                return {'success': False, 'message': 'Chrome已在运行中'}

            config = self.get_config()
            chrome_path = config.get('chrome_path', '')
            cdp_port = config.get('chrome_cdp_port', 19227)

            if not chrome_path or not os.path.exists(chrome_path):
                return {'success': False, 'message': f'Chrome路径不存在或未配置: {chrome_path}'}

            if self.check_port_in_use(cdp_port):
                self.kill_existing_chrome(cdp_port)
                time.sleep(1)

                if self.check_port_in_use(cdp_port):
                    return {'success': False, 'message': f'端口 {cdp_port} 已被占用且无法清理'}

            chrome_args = [
                chrome_path,
                f'--remote-debugging-port={cdp_port}',
                '--remote-allow-origins=*',
                '--window-size=1280,1080',
                "--no-sandbox",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-gpu-compositing",
                "--disable-extensions",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ]

            if mode == 'headless':
                chrome_args.extend([
                    '--headless',
                    '--disable-gpu',
                    '--window-size=1280,1080'
                ])
            else:
                chrome_args.extend([
                    '--start-maximized',
                ])

            socks5_proxy = self.Core_Function.callback_socks5_proxy()
            if socks5_proxy:
                chrome_proxy = socks5_proxy.replace('socks5h://', 'socks5://')
                chrome_args.append(f'--proxy-server={chrome_proxy}')
                proxy_info = f', 代理: {chrome_proxy}'
            else:
                proxy_info = ', 无代理'

            popen_kwargs = {
                'stdout': subprocess.PIPE,
                'stderr': subprocess.PIPE,
            }
            if sys.platform == 'win32':
                popen_kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
                chrome_args.extend([
                    '--disable-features=IsolateOrigins,site-per-process',
                ])
            
            print(f"启动Chrome: {' '.join(chrome_args)}")
            self.process = subprocess.Popen(chrome_args, **popen_kwargs)
            self._save_pid(self.process.pid)

            time.sleep(3)

            if self.check_port_in_use(cdp_port):
                self.is_running = True
                self.port = cdp_port
                self.mode = mode
                return {
                    'success': True,
                    'message': f'Chrome启动成功，CDP端口: {cdp_port}{proxy_info}, 模式: {mode}'
                }
            else:
                if self.process:
                    self.process.terminate()
                    self.process = None
                self._kill_by_pid_file()
                return {'success': False, 'message': 'Chrome启动失败，端口未监听'}

        except Exception as e:
            return {'success': False, 'message': f'启动失败: {str(e)}'}

    def stop(self):
        try:
            if self.mode == 'normal':
                return {'success': False, 'message': 'Chrome normal 仅监测，不进行停止操作'}

            if not self.is_running:
                return {'success': False, 'message': 'Chrome未运行'}

            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()

            if self.port:
                self.kill_existing_chrome(self.port)

            self._kill_by_pid_file()

            self.process = None
            self.is_running = False
            self.port = None

            return {'success': True, 'message': 'Chrome已停止'}

        except Exception as e:
            return {'success': False, 'message': f'停止失败: {str(e)}'}

    def restart(self, mode='headless'):
        if mode == 'normal':
            return {'success': False, 'message': 'Chrome normal 仅监测，不进行重启操作'}

        stop_result = self.stop()
        if not stop_result['success']:
            if '未运行' not in stop_result['message']:
                return {'success': False, 'message': f'停止失败: {stop_result["message"]}'}

        time.sleep(2)
        return self.start(mode)

    def get_status(self):
        config = self.get_config()
        port = config.get('chrome_cdp_port', 19227)

        actual_running = self.check_port_in_use(port)
        self.is_running = actual_running
        
        return {
            'is_running': actual_running,
            'port': port,
            'mode': self.mode
        }
