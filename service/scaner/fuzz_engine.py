# coding: utf-8
"""
爆破工具引擎
支持单请求和多请求模式，支持多线程和字典爆破
"""
import re
import json
import threading
import time
import os
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


class FuzzEngine:
    """爆破引擎"""

    def __init__(self):
        self._running = False
        self._paused = False
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._results_lock = threading.Lock()
        self._progress = {
            'total': 0,
            'completed': 0,
            'success': 0,
            'failed': 0,
            'current': ''
        }
        # 结果文件路径
        self._result_file = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'fuzz_result.txt')
        os.makedirs(os.path.dirname(self._result_file), exist_ok=True)

    def stop(self):
        """停止爆破"""
        self._running = False
        self._stop_event.set()

    def pause(self):
        """暂停爆破"""
        self._paused = True
        self._pause_event.clear()

    def resume(self):
        """继续爆破"""
        self._paused = False
        self._pause_event.set()

    def _wait_if_paused(self):
        """如果暂停则等待"""
        if self._paused:
            self._pause_event.wait()

    def _load_urls_from_database(self):
        """从数据库加载URL列表

        Returns:
            URL列表 [{url: '...', domain: '...'}]
        """
        try:
            from database.mongodb_handler import MongoDBHandler

            # 获取当前项目名
            from service.Class_Core_Function import Class_Core_Function
            core = Class_Core_Function()
            config = core.callback_project_config()
            if not config:
                return []

            project_name = config.get('Project', '')
            if not project_name:
                return []

            db_handler = MongoDBHandler()
            collection_name = f"project_{project_name}_website"

            # 查询所有数据
            docs = db_handler.find(collection_name, {}, limit=10000, projection={'url': 1, 'domain': 1, '_id': 0})

            urls_list = []
            for doc in docs:
                url = doc.get('url', '').rstrip('/')
                if url:
                    urls_list.append({
                        'url': url,
                        'domain': doc.get('domain', '')
                    })

            return urls_list

        except Exception as e:
            print(f"[Fuzz] 加载URL失败: {e}")
            return []

    def _generate_requests(self, base_request, dict1=None, dict2=None, mode='single'):
        """生成爆破请求列表

        Args:
            base_request: 基础请求配置
            dict1: 字典1列表
            dict2: 字典2列表
            mode: 模式 - single(单参数), cross(交叉爆破)

        Yields:
            处理后的请求配置
        """
        # 替换占位符 {{str1}} 和 {{str2}}
        url = base_request.get('url', '')
        method = base_request.get('method', 'GET').upper()
        headers = base_request.get('headers', {})
        body = base_request.get('body', '')

        if mode == 'single' and dict1:
            for word in dict1:
                # 替换URL中的占位符
                new_url = url.replace('{{str1}}', word).replace('{{str2}}', '')
                # 替换body中的占位符
                new_body = body.replace('{{str1}}', word).replace('{{str2}}', '')
                yield {
                    'url': new_url,
                    'method': method,
                    'headers': headers.copy(),
                    'body': new_body,
                    'payload': word,
                    'payload2': ''
                }

        elif mode == 'cross' and dict1 and dict2:
            for word1 in dict1:
                for word2 in dict2:
                    new_url = url.replace('{{str1}}', word1).replace('{{str2}}', word2)
                    new_body = body.replace('{{str1}}', word1).replace('{{str2}}', word2)
                    yield {
                        'url': new_url,
                        'method': method,
                        'headers': headers.copy(),
                        'body': new_body,
                        'payload': word1,
                        'payload2': word2
                    }

    def _execute_request(self, request_config, timeout=10):
        """执行单个请求"""
        try:
            url = request_config['url']
            method = request_config['method']
            headers = request_config['headers']
            body = request_config.get('body', '')

            start_time = time.time()

            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout, verify=False)
            elif method == 'POST':
                response = requests.post(url, headers=headers, data=body, timeout=timeout, verify=False)
            elif method == 'PUT':
                response = requests.put(url, headers=headers, data=body, timeout=timeout, verify=False)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=timeout, verify=False)
            else:
                response = requests.request(method, url, headers=headers, data=body, timeout=timeout, verify=False)

            elapsed = time.time() - start_time
            status_code = response.status_code
            length = len(response.content)

            return {
                'success': True,
                'url': url,
                'method': method,
                'status_code': status_code,
                'length': length,
                'elapsed': round(elapsed * 1000),  # 毫秒
                'payload': request_config.get('payload', ''),
                'payload2': request_config.get('payload2', ''),
                'response_headers': dict(response.headers),
                'response_body': response.text[:5000] if response.text else '',  # 截取前5KB
                'error': None
            }

        except requests.exceptions.Timeout:
            return {
                'success': False,
                'url': url,
                'method': method,
                'status_code': 0,
                'length': 0,
                'elapsed': timeout * 1000,
                'payload': request_config.get('payload', ''),
                'payload2': request_config.get('payload2', ''),
                'response_headers': {},
                'response_body': '',
                'error': 'Timeout'
            }
        except requests.exceptions.ConnectionError as e:
            return {
                'success': False,
                'url': url,
                'method': method,
                'status_code': 0,
                'length': 0,
                'elapsed': 0,
                'payload': request_config.get('payload', ''),
                'payload2': request_config.get('payload2', ''),
                'response_headers': {},
                'response_body': '',
                'error': f'Connection Error: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'url': url,
                'method': method,
                'status_code': 0,
                'length': 0,
                'elapsed': 0,
                'payload': request_config.get('payload', ''),
                'payload2': request_config.get('payload2', ''),
                'response_headers': {},
                'response_body': '',
                'error': str(e)
            }

    def fuzz_single(self, base_request, dict1, dict2=None, mode='single',
                    threads=10, timeout=10, match_status=None, match_length=None,
                    match_regex=None, progress_callback=None):
        """单请求爆破

        Args:
            base_request: 基础请求配置
            dict1: 字典1列表
            dict2: 字典2列表（交叉爆破时使用）
            mode: 爆破模式 - single/cross
            threads: 线程数
            timeout: 请求超时时间（秒）
            match_status: 匹配的状态码列表
            match_length: 匹配的长度（响应大小范围）
            match_regex: 匹配的正则表达式
            progress_callback: 进度回调函数

        Returns:
            爆破结果列表
        """
        self._running = True
        self._paused = False
        self._stop_event.clear()
        self._pause_event.set()

        # 清空结果文件
        with open(self._result_file, 'w', encoding='utf-8') as f:
            f.write('')

        # 生成所有请求
        requests_list = list(self._generate_requests(base_request, dict1, dict2, mode))
        total = len(requests_list)
        self._progress = {
            'total': total,
            'completed': 0,
            'success': 0,
            'failed': 0,
            'current': ''
        }

        # 编译正则表达式
        regex_pattern = re.compile(match_regex) if match_regex else None

        def check_match(result):
            """检查结果是否匹配条件"""
            # 状态码匹配
            if match_status:
                if isinstance(match_status, list):
                    if result['status_code'] not in match_status:
                        return False
                else:
                    if result['status_code'] != match_status:
                        return False

            # 长度匹配
            if match_length:
                length_str = str(match_length)
                if length_str.startswith('<'):
                    max_len = int(length_str[1:])
                    if result['length'] >= max_len:
                        return False
                elif length_str.startswith('>'):
                    min_len = int(length_str[1:])
                    if result['length'] <= min_len:
                        return False
                elif '-' in length_str:
                    parts = length_str.split('-')
                    min_len = int(parts[0])
                    max_len = int(parts[1])
                    if not (min_len <= result['length'] <= max_len):
                        return False
                else:
                    if result['length'] != int(length_str):
                        return False

            # 正则匹配
            if regex_pattern:
                if not regex_pattern.search(result.get('response_body', '')):
                    return False

            return True

        def worker(request_config):
            """工作线程"""
            if not self._running:
                return None

            self._wait_if_paused()

            if not self._running:
                return None

            result = self._execute_request(request_config, timeout)

            # 更新进度
            with self._results_lock:
                self._progress['completed'] += 1
                self._progress['current'] = request_config.get('payload', '')

                if result['success']:
                    if result['status_code'] >= 200 and result['status_code'] < 400:
                        self._progress['success'] += 1
                    else:
                        self._progress['failed'] += 1
                else:
                    self._progress['failed'] += 1

            # 检查是否匹配条件，匹配则写入文件
            if check_match(result):
                with self._results_lock:
                    self._progress['success'] += 1
                # 写入文件
                self._write_result(result)

            # 调用进度回调
            if progress_callback:
                with self._results_lock:
                    progress_callback(self._progress.copy())

            return result

        # 使用线程池执行
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = [executor.submit(worker, req) for req in requests_list]

            try:
                for future in as_completed(futures):
                    if not self._running:
                        # 取消剩余任务
                        for f in futures:
                            f.cancel()
                        break
            except Exception as e:
                print(f"[Fuzz] 执行出错: {e}")

        return self._results

    def fuzz_multi(self, dict1=None, dict2=None, mode='single',
                   threads=5, timeout=10, match_status=None, match_length=None,
                   match_regex=None, progress_callback=None):
        """多URL爆破（从数据库website表读取URL，对每个URL进行路径/文件爆破）

        Args:
            dict1: 字典1列表
            dict2: 字典2列表
            mode: 爆破模式
            threads: 线程数
            timeout: 超时时间
            match_status: 匹配的状态码
            match_length: 匹配的长度
            match_regex: 匹配的正则
            progress_callback: 进度回调

        Returns:
            爆破结果列表
        """
        self._running = True
        self._paused = False
        self._stop_event.clear()
        self._pause_event.set()

        # 清空结果文件
        with open(self._result_file, 'w', encoding='utf-8') as f:
            f.write('')

        # 从数据库获取URL列表
        urls_list = self._load_urls_from_database()
        if not urls_list:
            print("[Fuzz] 未找到任何网站数据")
            return []

        # 为每个URL生成对应的爆破请求
        all_requests = []
        for item in urls_list:
            base_url = item.get('url', '').rstrip('/')
            if not base_url:
                continue
            # 生成请求（复用_generate_requests生成payload替换后的请求）
            for payload in dict1:
                all_requests.append({
                    'url': f"{base_url}/{payload}",
                    'method': 'GET',
                    'headers': {},
                    'body': '',
                    'payload': payload,
                    'payload2': ''
                })
                # 交叉爆破
                if mode == 'cross' and dict2:
                    for payload2 in dict2:
                        all_requests.append({
                            'url': f"{base_url}/{payload}/{payload2}",
                            'method': 'GET',
                            'headers': {},
                            'body': '',
                            'payload': payload,
                            'payload2': payload2
                        })

        total = len(all_requests)
        self._progress = {
            'total': total,
            'completed': 0,
            'success': 0,
            'failed': 0,
            'current': ''
        }

        # 编译正则表达式
        regex_pattern = re.compile(match_regex) if match_regex else None

        def check_match(result):
            """检查结果是否匹配条件"""
            if match_status:
                if isinstance(match_status, list):
                    if result['status_code'] not in match_status:
                        return False
                else:
                    if result['status_code'] != match_status:
                        return False

            if match_length:
                length_str = str(match_length)
                if length_str.startswith('<'):
                    max_len = int(length_str[1:])
                    if result['length'] >= max_len:
                        return False
                elif length_str.startswith('>'):
                    min_len = int(length_str[1:])
                    if result['length'] <= min_len:
                        return False
                elif '-' in length_str:
                    parts = length_str.split('-')
                    min_len = int(parts[0])
                    max_len = int(parts[1])
                    if not (min_len <= result['length'] <= max_len):
                        return False
                else:
                    if result['length'] != int(length_str):
                        return False

            if regex_pattern:
                if not regex_pattern.search(result.get('response_body', '')):
                    return False

            return True

        def worker(request_config):
            """工作线程"""
            if not self._running:
                return None

            self._wait_if_paused()

            if not self._running:
                return None

            result = self._execute_request(request_config, timeout)

            # 更新进度
            with self._results_lock:
                self._progress['completed'] += 1
                self._progress['current'] = request_config.get('payload', '')

                if result['success']:
                    if result['status_code'] >= 200 and result['status_code'] < 400:
                        self._progress['success'] += 1
                    else:
                        self._progress['failed'] += 1
                else:
                    self._progress['failed'] += 1

            # 检查是否匹配条件，匹配则写入文件
            if check_match(result):
                # 写入文件
                self._write_result(result)

            # 调用进度回调
            if progress_callback:
                with self._results_lock:
                    progress_callback(self._progress.copy())

            return result

        # 使用线程池执行
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = [executor.submit(worker, req) for req in all_requests]

            try:
                for future in as_completed(futures):
                    if not self._running:
                        for f in futures:
                            f.cancel()
                        break
            except Exception as e:
                print(f"[Fuzz] 执行出错: {e}")

        return self._results

    def _write_result(self, result):
        """写入结果到文件"""
        try:
            with open(self._result_file, 'a', encoding='utf-8') as f:
                line = json.dumps({
                    'url': result.get('url', ''),
                    'method': result.get('method', ''),
                    'status_code': result.get('status_code', 0),
                    'length': result.get('length', 0),
                    'elapsed': result.get('elapsed', 0),
                    'payload': result.get('payload', ''),
                    'payload2': result.get('payload2', ''),
                    'error': result.get('error', '')
                }, ensure_ascii=False)
                f.write(line + '\n')
        except Exception as e:
            print(f"[Fuzz] 写入结果失败: {e}")

    def get_results(self):
        """从文件读取结果"""
        try:
            if os.path.exists(self._result_file):
                results = []
                with open(self._result_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                results.append(json.loads(line))
                            except:
                                pass
                return results
            return []
        except Exception as e:
            print(f"[Fuzz] 读取结果失败: {e}")
            return []

    def clear_results(self):
        """清空结果文件"""
        try:
            with open(self._result_file, 'w', encoding='utf-8') as f:
                f.write('')
            return True
        except Exception as e:
            print(f"[Fuzz] 清空结果失败: {e}")
            return False

    def get_result_file_path(self):
        """获取结果文件路径"""
        return self._result_file

    def get_progress(self):
        """获取当前进度"""
        with self._results_lock:
            return self._progress.copy()

    def is_running(self):
        """检查是否在运行"""
        return self._running


# 全局引擎实例
_fuzz_engine = FuzzEngine()


def get_fuzz_engine():
    """获取爆破引擎实例"""
    return _fuzz_engine
