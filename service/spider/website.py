# coding: utf-8
"""
站点收集模块
收集和管理网站站点信息
功能：
1. 接收list_website传参
2. 对list_website进行URL参数数据库去重处理
3. 对list_website进行HTTP请求
4. 对HTTP响应进行website生成，比如beautifulsoup4获取title，生成html表
5. 保存进入website数据库和html数据库
"""

import warnings
from bs4 import XMLParsedAsHTMLWarning
from urllib3.exceptions import InsecureRequestWarning
# 忽略HTTPS证书警告
warnings.filterwarnings('ignore', category=InsecureRequestWarning)
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
import requests
from bs4 import BeautifulSoup
from database.website_database import WebsiteDatabase
from database.html_database import HtmlDatabase
from service.Class_Core_Function import Class_Core_Function
from service.libs.replay_request import send_http_request


class WebsiteCollector:
    """站点收集器"""

    def __init__(self, project_name):
        self.project_name = project_name
        self.website_db = WebsiteDatabase(project_name)
        self.html_db = HtmlDatabase(project_name)
        self.core_function = Class_Core_Function()
        # 获取项目配置
        self.project_config = self.core_function.callback_project_config()
        self.user_agent = self.project_config.get('user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36') if self.project_config else 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        self.timeout = self.project_config.get('timeout', 8) if self.project_config else 8
        self.http_thread = self.project_config.get('http_thread', 10) if self.project_config else 10
        self.domain_list = self.project_config.get('domain_list', []) if self.project_config else []

    def _visit_website(self, website):
        """
        访问网站获取基本信息

        Args:
            website: 网站 URL

        Returns:
            dict: 网站信息
        """
        try:
            request_data = self.core_function.create_request(website)
            headers = request_data.get('headers', {})

            req_data = {
                'url': website,
                'method': 'GET',
                'headers': headers,
                'body': '',
                'body_encoding': 'plain'
            }
            response = send_http_request(req_data, timeout=self.timeout, allow_redirects=True)
            if response is None:
                return None

            # 自动识别网页编码
            response.encoding = response.apparent_encoding
            try:
                # 提取title
                soup = BeautifulSoup(response.text, 'html.parser')
                title = soup.title.string if soup.title else ''
            except Exception as e:
                title = ''
            # 提取server信息
            server = response.headers.get('Server', '')

            # 生成HTML的MD5（使用解码后的文本）
            html_text = response.text
            html_md5 = self.core_function.md5_convert(html_text) if html_text else ''
            html_len = len(html_text) if html_text else 0

            return {
                'headers': headers,  # 请求头
                'title': title[:200],  # 限制长度
                'server': server,
                'http_status_code': response.status_code,
                'headers_response': dict(response.headers),
                'subdomain': self.core_function.callback_split_url(website, 2),
                'domain': self.core_function.extract_domain(self.core_function.callback_split_url(website, 2)),
                'port': self.core_function.callback_port_number(website),
                'current_url': response.url,
                'html_md5': html_md5,
                'html_len': html_len,
                'html': html_text
            }

        except Exception as e:
            return None

    def _process_single_website(self, website):
        """
        处理单个网站

        Args:
            website: 网站 URL

        Returns:
            dict: 处理结果，包含 _html 字段用于后续批量保存HTML
        """
        try:
            # 访问网站获取信息
            site_info = self._visit_website(website)

            # 如果连接失败，直接返回None不保存
            if not site_info:
                return None

            # 收集HTML数据（不在此处保存，改为批量保存）
            html_md5 = site_info.get('html_md5', '')
            html_len = int(site_info.get('html_len', 0))
            html_content = site_info.get('html', '')

            html_data = None
            if html_md5 and html_content:
                html_data = {
                    'html': html_content,
                    'html_md5': html_md5,
                    'html_len': html_len,
                    'status': 0
                }

            return {
                'url': website,
                'method': 'GET',
                'body': '',
                'headers': site_info.get('headers', {}),
                'subdomain': site_info.get('subdomain', ''),
                'domain': site_info.get('domain', ''),
                'waf': 0,
                'title': site_info.get('title', ''),
                'port': site_info.get('port', 80),
                'current_url': site_info.get('current_url', website),
                'headers_response': site_info.get('headers_response', {}),
                'server': site_info.get('server', ''),
                'web_fingerprint': 'Null',
                'screenshot': '',
                'describe': 'Null',
                'tag': [],
                'html_md5': html_md5,
                'html_browser_md5': '',
                'html_len': int(html_len),
                'time_first': self.core_function.callback_time(0),
                'time_update': self.core_function.callback_time(0),
                'http_status_code': site_info.get('http_status_code', 0),
                'status': 0,
                'html_data': html_data  # HTML数据，不入库website表
            }

        except Exception as e:
            return None

    def collect_and_save(self, websites):
        """
        收集并保存站点
        1. URL参数去重处理（使用标准化URL进行去重）
        2. 多线程访问站点获取信息
        3. 保存HTML到html数据库
        4. 保存website到website数据库

        Args:
            websites: 已提取的网站列表

        Returns:
            dict: {'success': bool, 'count': int, 'new_count': int, 'message': str}
        """
        try:
            # 1. URL参数去重处理 - 使用 callback_split_url(3) 去除查询参数后去重
            normalized_urls = {}
            for website in websites:
                normalized = self.core_function.callback_split_url(website, 3)
                if normalized not in normalized_urls:
                    normalized_urls[normalized] = website
            # 查询数据库中已存在的标准化URL（$in 批量查询）
            normalized_list = list(normalized_urls.keys())
            existing_set = set()
            if normalized_list:
                existing_docs = self.website_db.db_handler.find(
                    self.website_db.collection_name,
                    {'url': {'$in': normalized_list}},
                    projection={'url': 1}
                )
                existing_set = {doc['url'] for doc in existing_docs}

            new_websites = [original_url for normalized, original_url in normalized_urls.items() if normalized not in existing_set]
            if not new_websites:
                return {
                    'success': True,
                    'count': len(websites),
                    'new_count': 0,
                    'message': '没有新的站点需要处理'
                }

            # 2. 使用标准函数多线程处理站点
            processed_data = []

            def process_wrapper(website):
                """包装函数，用于多线程调用"""
                result = self._process_single_website(website)
                if result:
                    processed_data.append(result)

            self.core_function.threadpool_Core_Function(process_wrapper, new_websites, self.http_thread)

            # 3. 提取HTML数据并批量保存到html表
            html_data_list = []
            for data in processed_data:
                html_data = data.pop('html_data', None)
                if html_data:
                    html_data_list.append(html_data)

            html_saved_count = 0
            if html_data_list:
                html_saved_count = self.html_db.import_html_batch(html_data_list)

            # 4. 保存到website数据库（批量插入）
            saved_count = 0
            if processed_data:
                try:
                    # 再次用 url 批量去重（处理多线程处理期间可能的重复）
                    urls_in_batch = [d.get('url', '') for d in processed_data]
                    existing_docs = self.website_db.db_handler.find(
                        self.website_db.collection_name,
                        {'url': {'$in': urls_in_batch}},
                        projection={'url': 1}
                    )
                    existing_urls = {doc['url'] for doc in existing_docs}
                    truly_new = [d for d in processed_data if d.get('url', '') not in existing_urls]

                    if truly_new:
                        result = self.website_db.db_handler.insert_many(
                            self.website_db.collection_name,
                            truly_new
                        )
                        saved_count = len(result.inserted_ids) if result else 0
                    else:
                        saved_count = 0
                except Exception:
                    # 批量插入失败，回退到逐条插入
                    for data in processed_data:
                        try:
                            self.website_db.add_website(data)
                            saved_count += 1
                        except:
                            pass

            return {
                'success': True,
                'count': len(websites),
                'new_count': saved_count,
                'message': f'成功保存 {saved_count} 个新站点（总接收 {len(websites)} 个）'
            }

        except Exception as e:
            return {
                'success': False,
                'count': 0,
                'new_count': 0,
                'message': f'收集站点失败: {str(e)}'
            }
