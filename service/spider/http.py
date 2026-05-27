"""
HTTP 请求响应收集模块
进行 HTTP 请求重放，收集响应数据
功能：
1. 接收list_http传参
2. 对list_http进行标准化处理，用key进行内存去重和数据库去重
3. 重放HTTP请求获取响应
4. 保存进入数据库
"""

import hashlib
from database.http_database import HttpDatabase
from database.html_database import HtmlDatabase
from service.Class_Core_Function import Class_Core_Function
from service.spider.http_standardization import standardize_request
from service.libs.replay_request import send_http_request
from bs4 import BeautifulSoup
import warnings
from urllib3.exceptions import InsecureRequestWarning
warnings.filterwarnings('ignore', category=InsecureRequestWarning)


class HTTPCollector:
    """HTTP 收集器"""

    def __init__(self, project_name):
        self.project_name = project_name
        self.http_db = HttpDatabase(project_name)
        self.html_db = HtmlDatabase(project_name)
        self.core_function = Class_Core_Function()
        # 获取项目配置
        self.project_config = self.core_function.callback_project_config() or {}
        self.user_agent = self.project_config.get('user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        self.timeout = self.project_config.get('timeout', 8)
        self.http_thread = self.project_config.get('http_thread', 10)
        self.domain_list = self.project_config.get('domain_list', [])
        # 文件类型配置
        self.file_type_allowed = self.project_config.get('file_type', [])
        self.file_type_disallowed = self.project_config.get('file_type_disallowed', [])

    def _replay_request(self, traffic):
        """
        重放 HTTP 请求

        Args:
            traffic: 流量数据字典（已包含标准化字段：key, url_path, url_generalization, param_feature, file_extension）

        Returns:
            dict: HTTP 响应数据
        """
        try:
            url = traffic.get('url', '')
            method = traffic.get('method', 'GET')
            headers = traffic.get('headers', {})
            body = traffic.get('body', '')
            body_encoding = traffic.get('body_encoding', 'plain')

            # 添加User-Agent
            headers = dict(headers) if headers else {}
            headers['User-Agent'] = self.user_agent

            # 使用标准HTTP请求接口
            request_data = {
                'url': url,
                'method': method,
                'headers': headers,
                'body': body,
                'body_encoding': body_encoding
            }
            response = send_http_request(request_data, timeout=self.timeout, allow_redirects=True)

            if response is None:
                return None

            # 自动识别网页编码，防止乱码
            response.encoding = response.apparent_encoding

            # 提取title
            title = ''
            if response.text:
                try:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    title = soup.title.string if soup.title and soup.title.string else ''
                except:
                    pass

            # 计算HTML的MD5
            html_md5 = ''
            html_len = len(response.text)
            html_text = response.text if response.text else ''
            if response.text:
                html_md5 = hashlib.md5(response.text.encode()).hexdigest()

            # 判断http_type
            content_type = getattr(response, 'headers', {}).get('Content-Type', '') if response else ''
            file_extension = traffic.get('file_extension', '')
            http_type = self.core_function._get_http_type(content_type, file_extension)

            # 返回完整数据结构（遵循数据库表结构）
            return {
                'url': url,
                'method': method,
                'body': body,
                'headers': headers,
                'subdomain': self.core_function.callback_split_url(url, 1),
                'domain': self.core_function.extract_domain(self.core_function.callback_split_url(url, 2)),
                'website': self.core_function.callback_split_url(url, 0),
                'waf': 0,
                'title': title[:200],
                'port': self.core_function.callback_port_number(url),
                'current_url': response.url,
                'headers_response': dict(response.headers),
                'server': response.headers.get('Server', ''),
                'web_fingerprint': 'Null',
                'screenshot': '',
                'describe': 'Null',
                'tag': [],
                'html_md5': html_md5,
                'html_browser_md5': '',
                'html_len': html_len,
                'time_first': traffic.get('time', self.core_function.callback_time(0)),
                'time_update': self.core_function.callback_time(0),
                'http_status_code': response.status_code,
                'status': 0,
                # 标准化字段（从traffic中获取）
                'url_path': traffic.get('url_path', ''),
                'url_generalization': traffic.get('url_generalization', ''),
                'param_feature': traffic.get('param_feature', ''),
                'key': traffic.get('key', ''),
                'http_type': http_type,
                'file_extension': traffic.get('file_extension', ''),
                'body_encoding': body_encoding,
                # HTML字段（用于保存到html表，不入库http表）
                '_html': html_text
            }

        except Exception as e:
            return None

    def _process_single_http(self, traffic):
        """
        处理单个HTTP请求

        Args:
            traffic: 流量数据

        Returns:
            dict: 处理结果
        """
        return self._replay_request(traffic)

    def collect_and_save(self, http_requests):
        """
        收集并保存HTTP请求响应
        1. 对list_http进行标准化处理，用key进行内存去重和数据库去重
        2. 多线程重放请求获取响应
        3. 保存到数据库

        Args:
            http_requests: 已提取的HTTP请求列表（来自project_{name}_traffic）

        Returns:
            dict: {'success': bool, 'count': int, 'new_count': int, 'message': str}
        """
        try:
            # 1. 标准化处理 + 内存去重 + 数据库去重
            key_set = set()  # 内存去重集合
            pending_requests = []  # 待数据库去重的请求

            for traffic in http_requests:
                # 标准化请求获取key
                std_result = standardize_request(traffic)
                key = std_result.get('key', '')

                # 内存去重：同一个key只处理一次
                if key in key_set:
                    continue
                key_set.add(key)

                # 合并标准化结果到原始数据
                traffic['key'] = key
                traffic['url_path'] = std_result.get('url_path', '')
                traffic['url_generalization'] = std_result.get('url_generalization', '')
                traffic['param_feature'] = std_result.get('param_feature', '')
                traffic['file_extension'] = std_result.get('file_extension', '')
                pending_requests.append(traffic)

            # 数据库批量去重：用 $in 一次查出所有已存在的 key
            new_http_requests = []
            if pending_requests:
                all_keys = [r['key'] for r in pending_requests]
                existing_docs = self.http_db.db_handler.find(
                    self.http_db.collection_name,
                    {'key': {'$in': all_keys}},
                    projection={'key': 1}
                )
                existing_keys = {doc['key'] for doc in existing_docs}
                new_http_requests = [r for r in pending_requests if r['key'] not in existing_keys]

            if not new_http_requests:
                return {
                    'success': True,
                    'count': len(http_requests),
                    'new_count': 0,
                    'message': '没有新的HTTP请求需要处理'
                }

            # 2. 使用标准函数多线程处理HTTP请求
            processed_data = []

            def process_wrapper(traffic):
                """包装函数，用于多线程调用"""
                result = self._process_single_http(traffic)
                if result:
                    processed_data.append(result)

            self.core_function.threadpool_Core_Function(process_wrapper, new_http_requests, self.http_thread)

            # 3. 保存到数据库（批量插入 + HTML批量保存）
            saved_count = 0
            html_saved_count = 0

            # 提取HTML字段并从HTTP数据中移除
            html_data_list = []
            for data in processed_data:
                html_text = data.pop('_html', '')
                if data.get('html_md5') and html_text:
                    html_data_list.append({
                        'html': html_text,
                        'html_md5': data['html_md5'],
                        'html_len': data.get('html_len', 0),
                        'status': 0
                    })

            # 批量插入HTTP数据
            if processed_data:
                # 再次用 key 批量去重（多线程期间可能产生新重复）
                keys_in_batch = [d.get('key', '') for d in processed_data]
                existing_docs = self.http_db.db_handler.find(
                    self.http_db.collection_name,
                    {'key': {'$in': keys_in_batch}},
                    projection={'key': 1}
                )
                existing_keys = {doc['key'] for doc in existing_docs}
                truly_new = [d for d in processed_data if d.get('key', '') not in existing_keys]

                if truly_new:
                    try:
                        result = self.http_db.db_handler.insert_many(
                            self.http_db.collection_name,
                            truly_new
                        )
                        saved_count = len(result.inserted_ids) if result else 0
                    except Exception:
                        # 批量插入失败，回退到逐条插入
                        for data in truly_new:
                            try:
                                if self.http_db.import_http(data):
                                    saved_count += 1
                            except:
                                pass

            # 批量保存HTML数据
            if html_data_list:
                html_saved_count = self.html_db.import_html_batch(html_data_list)

            return {
                'success': True,
                'count': len(http_requests),
                'new_count': saved_count,
                'html_count': html_saved_count,
                'message': f'成功保存 {saved_count} 个新HTTP响应，{html_saved_count} 个HTML（总接收 {len(http_requests)} 个）'
            }

        except Exception as e:
            return {
                'success': False,
                'count': 0,
                'new_count': 0,
                'message': f'收集HTTP请求失败: {str(e)}'
            }
