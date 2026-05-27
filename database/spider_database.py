# coding: utf-8
"""
爬虫数据库操作层
封装爬虫相关的所有数据库查询与业务逻辑，与 API 路由解耦
"""

import threading
from datetime import datetime, timedelta
from urllib.parse import urlparse as _URL

from .mongodb_handler import MongoDBHandler
from .project_database import ProjectDatabase


class SpiderDatabase:
    """爬虫数据访问层：封装所有爬虫相关的 DB 操作和数据处理"""

    def __init__(self):
        self.db_handler = MongoDBHandler()
        self.project_db = ProjectDatabase()

        # 站点分页数据缓存
        self._sites_page_cache = {}
        self._cache_lock = threading.Lock()
        self._cache_ttl = timedelta(minutes=5)

    # ================================================================
    #  项目相关
    # ================================================================

    def get_running_project(self):
        """获取当前运行中的项目配置"""
        from service.Class_Core_Function import Class_Core_Function
        core = Class_Core_Function()
        running = core.callback_project_config()
        if running and 'Project' in running:
            return running
        return None

    def get_project_config(self):
        """获取全局配置"""
        from service.Class_Core_Function import Class_Core_Function
        core = Class_Core_Function()
        return core.callback_config()

    # ================================================================
    #  配置读写
    # ================================================================

    def save_thread_count(self, project_name, thread_count):
        """保存线程数"""
        self.project_db.update_field(project_name, 'browser_thread', thread_count)

    def start_cdp_service(self, project_name):
        """启动CDP爬虫服务锁"""
        self.project_db.update_service_lock(project_name, 'spider_cdp_service', 1)

    def stop_cdp_service(self, project_name):
        """停止CDP爬虫服务锁"""
        self.project_db.update_service_lock(project_name, 'spider_cdp_service', 0)

    def save_personal_info(self, project_name, personal_info):
        """保存表单信息"""
        self.project_db.update_field(project_name, 'personal_info', personal_info)

    # ================================================================
    #  CDP 采集后的数据入库
    # ================================================================

    def mark_urls_processed(self, project_name, tab_urls):
        """将浏览器处理过的 tab_url 的 status 设为 1"""
        collection = f"project_{project_name}_http"
        processed = 0
        update_failed = 0
        
        for tab_url in tab_urls:
            if not tab_url:
                continue
            try:
                # 尝试多种匹配方式（处理URL格式不一致问题）
                url_normalized = tab_url.rstrip('/')
                
                # 先尝试精确匹配
                result = self.db_handler.update_one(collection, {'url': tab_url}, {'status': 1})
                if result is not None and result.matched_count > 0:
                    processed += 1
                    continue
                
                # 尝试不带尾部斜杠匹配
                if url_normalized != tab_url:
                    result = self.db_handler.update_one(collection, {'url': url_normalized}, {'status': 1})
                    if result is not None and result.matched_count > 0:
                        processed += 1
                        continue
                
                # 尝试添加尾部斜杠匹配
                result = self.db_handler.update_one(collection, {'url': tab_url + '/'}, {'status': 1})
                if result is not None and result.matched_count > 0:
                    processed += 1
                    continue
                
                # 仍未匹配
                update_failed += 1
                print(f"[SpiderDB] mark_urls_processed: URL not found in DB: {tab_url}")
                
            except Exception as e:
                print(f"[SpiderDB] mark_urls_processed error for URL {tab_url}: {e}")
        
        print(f"[SpiderDB] mark_urls_processed: {processed} updated, {update_failed} not found (total: {len(tab_urls)})")
        return processed

    def merge_page_tags(self, project_name, page_tags):
        """合并 page_tags 到 http 表的 tag 字段"""
        collection = f"project_{project_name}_http"
        tag_updated = 0
        if not page_tags:
            return tag_updated
        for tab_url, new_tags in page_tags.items():
            if not new_tags:
                continue
            try:
                docs = self.db_handler.find(collection, {'url': tab_url})
                for doc in docs:
                    existing_tags = doc.get('tag', []) or []
                    merged = list(set(existing_tags + new_tags))
                    if len(merged) > len(existing_tags):
                        self.db_handler.update_one(
                            collection,
                            {'_id': doc['_id']},
                            {'tag': merged, 'status': 1}
                        )
                        tag_updated += 1
            except:
                pass
        return tag_updated

    # ================================================================
    #  站点信息：分类 + 缓存
    # ================================================================

    def classify_http_docs(self, docs, site_stripped, site_hostname):
        """将 http 文档分类为 urls / apis / scripts

        Args:
            docs: http 集合的原始文档列表
            site_stripped: 站点 URL（去掉尾部 /）
            site_hostname: 站点 hostname（小写）

        Returns:
            (urls, apis, scripts) 三个列表
        """
        urls = []
        apis = []
        scripts = []
        url_set = set()
        api_set = set()
        script_set = set()

        for doc in docs:
            url = doc.get('url', '') or ''
            if not url:
                continue

            http_type = doc.get('http_type', 0)
            file_ext = (doc.get('file_extension', '') or '').lower()
            headers = doc.get('headers', {}) or {}
            origin = (headers.get('origin', '') or '').rstrip('/')
            doc_id = str(doc.get('_id', ''))

            # URL列表：http_type=1 且 URL 属于该站点域名
            if http_type == 1:
                try:
                    url_host = _URL(url).hostname.lower()
                    if url_host == site_hostname or url_host.endswith('.' + site_hostname):
                        if url not in url_set:
                            url_set.add(url)
                            urls.append({
                                '_id': doc_id,
                                'url': url,
                                'method': doc.get('method', 'GET'),
                                'http_status_code': doc.get('http_status_code', '-'),
                                'process_status': doc.get('status', 0),
                                'title': doc.get('title', ''),
                                'tag': doc.get('tag', []),
                                'html_md5': doc.get('html_md5', '')
                            })
                except:
                    pass

            # JS文件：Origin 匹配站点且 file_extension 为 .js
            if origin == site_stripped and file_ext == '.js':
                if url not in script_set:
                    script_set.add(url)
                    scripts.append({
                        'url': url,
                        'origin': origin,
                        '_id': doc_id,
                        'html_md5': doc.get('html_md5', '')
                    })

            # API接口：Origin 匹配站点且非 .js，或 http_type=2（排除 .js）
            if file_ext != '.js':
                if origin == site_stripped and file_ext != '':
                    if url not in api_set:
                        api_set.add(url)
                        apis.append({
                            '_id': doc_id,
                            'url': url,
                            'method': doc.get('method', 'GET'),
                            'origin': origin,
                            'html_md5': doc.get('html_md5', '')
                        })
                elif http_type == 2:
                    try:
                        url_host = _URL(url).hostname.lower()
                        if url_host == site_hostname or url_host.endswith('.' + site_hostname) or origin == site_stripped:
                            if url not in api_set:
                                api_set.add(url)
                                apis.append({
                                    '_id': doc_id,
                                    'url': url,
                                    'method': doc.get('method', 'GET'),
                                    'origin': origin,
                                    'html_md5': doc.get('html_md5', '')
                                })
                    except:
                        pass

        return urls, apis, scripts

    def get_classified_site_data(self, project_name, site_stripped, site_hostname, force_refresh=False):
        """获取指定站点的分类数据（带缓存）

        Args:
            project_name: 项目名
            site_stripped: 站点 URL（去掉尾部 /）
            site_hostname: 站点 hostname
            force_refresh: 是否强制刷新缓存

        Returns:
            dict: {'urls': [...], 'apis': [...], 'scripts': [...]}
        """
        cache_key = f"{project_name}:{site_stripped}"
        now = datetime.now()

        # 强制刷新时清除缓存
        if force_refresh:
            with self._cache_lock:
                self._sites_page_cache.pop(cache_key, None)

        # 读缓存
        with self._cache_lock:
            if cache_key in self._sites_page_cache:
                entry = self._sites_page_cache[cache_key]
                if now - entry['cached_at'] < self._cache_ttl:
                    return entry['data']

        # 缓存未命中，查 DB
        collection_name = f"project_{project_name}_http"
        try:
            all_docs = self.db_handler.find(collection_name, {})
        except:
            all_docs = []

        urls, apis, scripts = self.classify_http_docs(all_docs, site_stripped, site_hostname)
        result = {'urls': urls, 'apis': apis, 'scripts': scripts}

        with self._cache_lock:
            self._sites_page_cache[cache_key] = {'data': result, 'cached_at': now}
            # 清理过期
            expired = [k for k, v in self._sites_page_cache.items() if now - v['cached_at'] >= self._cache_ttl]
            for k in expired:
                del self._sites_page_cache[k]

        return result

    def get_site_page(self, project_name, site_stripped, site_hostname, panel_type, page=1, page_size=50, keyword='', force_refresh=False, sort_field='', sort_order='asc', process_status=None):
        """获取指定站点某面板的分页数据（支持服务端排序）

        Args:
            project_name: 项目名
            site_stripped: 站点 URL
            site_hostname: 站点 hostname
            panel_type: 'urls' / 'apis' / 'scripts'
            page: 页码
            page_size: 每页条数
            keyword: 搜索关键词
            force_refresh: 是否强制刷新缓存
            sort_field: 排序字段
            sort_order: 排序顺序 ('asc' 或 'desc')
            process_status: 处理状态过滤（0=待处理，1=已处理，None=全部）

        Returns:
            dict: {items, total, page, page_size, total_pages, type, sort_field, sort_order}
        """
        classified = self.get_classified_site_data(project_name, site_stripped, site_hostname, force_refresh)
        items = classified.get(panel_type, [])

        # 处理状态过滤
        if process_status is not None and panel_type == 'urls':
            items = [u for u in items if u.get('process_status', 0) == process_status]

        # 关键词过滤
        if keyword:
            filtered = []
            for item in items:
                url = item.get('url', '') or ''
                url_match = keyword in url.lower()
                tag_match = False
                tags = item.get('tag', [])
                if isinstance(tags, list):
                    tag_match = any(keyword in str(t).lower() for t in tags if t)
                if url_match or tag_match:
                    filtered.append(item)
            items = filtered

        # 排序
        if sort_field:
            # 定义排序键提取函数
            def get_sort_key(item):
                val = item.get(sort_field, '')
                # 处理 tag 字段（数组转字符串排序）
                if sort_field == 'tag':
                    tags = item.get('tag', [])
                    if isinstance(tags, list):
                        val = ','.join([str(t) for t in tags if t])
                    else:
                        val = str(tags) if tags else ''
                return val

            # 根据排序方向排序
            reverse = (sort_order == 'desc')
            try:
                # 尝试数值排序（用于 http_status_code, process_status）
                if sort_field in ('http_status_code', 'process_status'):
                    items.sort(key=lambda x: int(get_sort_key(x) or 0), reverse=reverse)
                else:
                    items.sort(key=lambda x: str(get_sort_key(x) or '').lower(), reverse=reverse)
            except (ValueError, TypeError):
                # 排序失败时使用字符串排序
                items.sort(key=lambda x: str(get_sort_key(x) or '').lower(), reverse=reverse)

        total = len(items)
        total_pages = max(1, (total + page_size - 1) // page_size)
        if page > total_pages:
            page = total_pages

        start = (page - 1) * page_size
        page_items = items[start:start + page_size]

        return {
            'items': page_items,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
            'type': panel_type,
            'sort_field': sort_field,
            'sort_order': sort_order
        }

    # ================================================================
    #  站点信息：子域名 & 网站
    # ================================================================

    def get_site_subdomains(self, project_name, site_hostname):
        """获取指定站点的关联子域名"""
        domain_collection = f"project_{project_name}_domain"
        subdomains = []
        try:
            domain_docs = self.db_handler.find(domain_collection, {})
            for d in domain_docs:
                sd = d.get('subdomain', '')
                if sd:
                    try:
                        sd_host = _URL('https://' + sd).hostname.lower() if '://' not in sd else _URL(sd).hostname.lower()
                    except:
                        sd_host = sd.lower()
                    if sd_host == site_hostname or sd_host.endswith('.' + site_hostname):
                        subdomains.append({
                            'subdomain': sd,
                            'domain': d.get('domain', ''),
                            'time': d.get('time', ''),
                            'port_list': d.get('port_list', []),
                            'dns_data': d.get('dns_data', []),
                            'status': d.get('subdomain_status', 'open'),
                            'subdomain_status': d.get('subdomain_status', 'open')
                        })
        except:
            pass
        return subdomains

    def get_site_websites(self, project_name, site_hostname):
        """获取指定站点的关联网站"""
        website_collection = f"project_{project_name}_website"
        websites = []
        try:
            website_docs = self.db_handler.find(website_collection, {})
            for w in website_docs:
                w_url = w.get('url', '')
                w_subdomain = w.get('subdomain', '') or w.get('domain', '')
                matched = False

                if w_url:
                    try:
                        w_host = _URL(w_url).hostname.lower()
                        if w_host == site_hostname or w_host.endswith('.' + site_hostname):
                            matched = True
                    except:
                        pass
                if not matched and w_subdomain:
                    try:
                        sd_host = _URL('https://' + w_subdomain).hostname.lower() if '://' not in w_subdomain else _URL(w_subdomain).hostname.lower()
                        if sd_host == site_hostname or sd_host.endswith('.' + site_hostname):
                            matched = True
                    except:
                        pass

                if matched:
                    websites.append({
                        'url': w_url,
                        'method': w.get('method', 'GET'),
                        'body': w.get('body', ''),
                        'headers': w.get('headers', {}),
                        'subdomain': w_subdomain,
                        'domain': w.get('domain', ''),
                        'waf': w.get('waf', 0),
                        'title': w.get('title', ''),
                        'port': w.get('port', ''),
                        'current_url': w.get('current_url', ''),
                        'headers_response': w.get('headers_response', {}),
                        'server': w.get('server', ''),
                        'web_fingerprint': w.get('web_fingerprint', ''),
                        'screenshot': w.get('screenshot', ''),
                        'describe': w.get('describe', ''),
                        'tag': w.get('tag', []),
                        'html_md5': w.get('html_md5', ''),
                        'html_len': w.get('html_len', 0),
                        'time_first': w.get('time_first', ''),
                        'time_update': w.get('time_update', ''),
                        'http_status_code': w.get('http_status_code', 0)
                    })
        except:
            pass
        return websites

    # ================================================================
    #  全部站点聚合（无 site 参数时）
    # ================================================================

    def get_all_sites_overview(self, project_name, domain_list):
        """获取所有站点的聚合数据

        Args:
            project_name: 项目名
            domain_list: 目标域名列表

        Returns:
            dict: {site_data, stats, domain_map, website_map, domain_list}
        """
        domain_hosts = set()
        for d in domain_list:
            try:
                domain_hosts.add(d.strip().lower())
            except:
                pass

        collection_name = f"project_{project_name}_http"
        try:
            all_docs = self.db_handler.find(collection_name, {})
        except:
            all_docs = []

        site_data = {}

        def _origin_match(origin_url, hosts):
            if not origin_url:
                return False
            try:
                origin_clean = origin_url.strip().rstrip('/').lower()
                if origin_clean.startswith('http://'):
                    origin_clean = origin_clean[7:]
                elif origin_clean.startswith('https://'):
                    origin_clean = origin_clean[8:]
                origin_clean = origin_clean.split('/')[0]
                for h in hosts:
                    try:
                        target = h.strip().rstrip('/')
                        if target.startswith('http'):
                            target = _URL(target).hostname.lower()
                        if origin_clean == target or origin_clean.endswith('.' + target):
                            return True
                    except:
                        pass
            except:
                pass
            return False

        for doc in all_docs:
            url = doc.get('url', '') or ''
            http_type = doc.get('http_type', 0)
            file_ext = doc.get('file_extension', '') or ''
            headers = doc.get('headers', {}) or {}
            origin = headers.get('origin', '') or ''
            subdomain = doc.get('subdomain', '') or ''
            host = subdomain or 'other'

            if host not in site_data:
                site_data[host] = {
                    'domain': host,
                    'urls': [],
                    'apis': [],
                    'scripts': []
                }

            if not url:
                continue

            if http_type == 1:
                site_data[host]['urls'].append({
                    'url': url,
                    'method': doc.get('method', 'GET'),
                    'http_status_code': doc.get('http_status_code', '-'),
                    'process_status': doc.get('status', 0),
                    'title': doc.get('title', ''),
                    'tag': doc.get('tag', [])
                })
            elif _origin_match(origin, domain_hosts) and file_ext.lower() == '.js':
                site_data[host]['scripts'].append(url)
            elif http_type == 2 and file_ext.lower() != '.js':
                site_data[host]['apis'].append({
                    'url': url,
                    'method': doc.get('method', 'GET'),
                    'origin': origin
                })
            elif _origin_match(origin, domain_hosts) and file_ext.lower() not in ('.js', ''):
                site_data[host]['apis'].append({
                    'url': url,
                    'method': doc.get('method', 'GET'),
                    'origin': origin
                })

        total_urls = sum(len(v['urls']) for v in site_data.values())
        total_apis = sum(len(v['apis']) for v in site_data.values())
        total_scripts = sum(len(v['scripts']) for v in site_data.values())

        # 子域名映射
        domain_collection = f"project_{project_name}_domain"
        try:
            domains = self.db_handler.find(domain_collection, {})
            domain_map = {}
            for d in domains:
                domain_map[d.get('subdomain', '')] = {
                    'subdomain': d.get('subdomain', ''),
                    'status': d.get('subdomain_status', 'open')
                }
        except:
            domain_map = {}

        # 网站映射
        website_collection = f"project_{project_name}_website"
        try:
            websites = self.db_handler.find(website_collection, {})
            website_map = {}
            for w in websites:
                key = w.get('subdomain', w.get('domain', ''))
                website_map[key] = {
                    'url': w.get('url', ''),
                    'title': w.get('title', ''),
                    'port': w.get('port', '')
                }
        except:
            website_map = {}

        return {
            'site_data': site_data,
            'stats': {
                'total_sites': len(site_data),
                'total_urls': total_urls,
                'total_apis': total_apis,
                'total_scripts': total_scripts
            },
            'domain_map': domain_map,
            'website_map': website_map,
            'domain_list': domain_list
        }
