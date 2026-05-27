# coding: utf-8
"""
被动爬虫 API（路由层）
仅负责 HTTP 参数解析和响应格式化，业务逻辑委托给 SpiderDatabase
@Time :    4/25/2026
@Author:  facai
"""

from flask import Blueprint, jsonify, request
import json
import threading
from urllib.parse import urlparse as _URL
from database.spider_database import SpiderDatabase


spider_api = Blueprint('spider_api', __name__)
spider_db = SpiderDatabase()

# CDP 调度器实例（全局单例）
_cdp_scheduler = None
_cdp_scheduler_thread = None


# ========== 爬虫配置 API ==========

@spider_api.route('/api/spider/config/get', methods=['GET'])
def spider_get_config():
    """获取爬虫配置：域名列表、线程数、CDP状态"""
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        domain_list = project.get('domain_list', [])
        browser_thread = project.get('browser_thread', 10)
        personal_info = project.get('personal_info', {})
        service_lock = project.get('service_lock', {})
        spider_cdp_service = int(service_lock.get('spider_cdp_service', 0))

        # 检查 Chrome CDP 端口
        cdp = _get_cdp_instance()
        cdp_port = cdp._get_cdp_port()
        chrome_running = cdp._check_port_open('127.0.0.1', cdp_port)

        # 检查 mitmproxy
        try:
            config = spider_db.get_project_config()
            mitm_port = config.get('mitmproxy_port', 8080) if config else 8080
            mitm_running = cdp._check_port_open('127.0.0.1', mitm_port)
        except:
            mitm_running = False

        # 查询待处理URL数量（status=0, http_type=1）
        from database.mongodb_handler import MongoDBHandler
        db_handler = MongoDBHandler()
        collection_name = f"project_{project['Project']}_http"
        pending_count = db_handler.count_documents(collection_name, {'status': 0, 'http_type': 1})

        return jsonify({
            'success': True,
            'data': {
                'domain_list': domain_list,
                'browser_thread': browser_thread,
                'chrome_running': chrome_running,
                'chrome_cdp_port': cdp_port,
                'mitm_running': mitm_running,
                'spider_cdp_service': spider_cdp_service,
                'personal_info': personal_info,
                'pending_count': pending_count
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/thread/save', methods=['POST'])
def spider_save_thread():
    """保存线程数"""
    try:
        data = request.get_json()
        thread_count = data.get('browser_thread', 10)

        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        spider_db.save_thread_count(project['Project'], thread_count)
        return jsonify({'success': True, 'message': f'线程数已更新为 {thread_count}'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/service/start', methods=['POST'])
def spider_start_service():
    """启动CDP爬虫服务（设置 spider_cdp_service=1 并启动调度器线程）"""
    global _cdp_scheduler, _cdp_scheduler_thread
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        data = request.get_json() or {}
        website_list = data.get('website_list', [])

        spider_db.start_cdp_service(project['Project'])

        # 启动调度器线程
        if _cdp_scheduler is None or not _cdp_scheduler.is_running:
            from service.spider.spider_cdp_scheduler import SpiderCDPScheduler
            _cdp_scheduler = SpiderCDPScheduler()
            _cdp_scheduler.website_list = website_list
            _cdp_scheduler_thread = threading.Thread(target=_cdp_scheduler.run, daemon=True)
            _cdp_scheduler_thread.start()

        return jsonify({'success': True, 'message': 'CDP爬虫服务已启动'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/service/stop', methods=['POST'])
def spider_stop_service():
    """停止CDP爬虫服务（设置 spider_cdp_service=0 并停止调度器）"""
    global _cdp_scheduler
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        spider_db.stop_cdp_service(project['Project'])

        # 停止调度器
        if _cdp_scheduler and _cdp_scheduler.is_running:
            _cdp_scheduler.stop()

        return jsonify({'success': True, 'message': 'CDP爬虫服务已停止'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500





# ========== CDP 管理 API ==========

# CDP 实例缓存（延迟初始化，避免循环导入）
_cdp_instance = None


def _get_cdp_instance():
    """获取 SpiderCDP 服务实例（延迟初始化）"""
    global _cdp_instance
    if _cdp_instance is None:
        from service.spider.spider_cdp import SpiderCDP
        _cdp_instance = SpiderCDP()
    return _cdp_instance


@spider_api.route('/api/spider/cdp/status', methods=['GET'])
def cdp_status():
    """检查 Chrome CDP 连接状态"""
    try:
        cdp = _get_cdp_instance()
        cdp_port = cdp._get_cdp_port()
        running = cdp._check_port_open('127.0.0.1', cdp_port)
        return jsonify({
            'success': True,
            'data': {'running': running, 'cdp_port': cdp_port}
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/cdp/tabs', methods=['GET'])
def cdp_get_tabs():
    """获取 Chrome 所有 Tab"""
    try:
        cdp = _get_cdp_instance()
        result = cdp.get_tabs()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/cdp/collect', methods=['POST'])
def cdp_collect_page():
    """收集所有范围内 Tab 页面信息，并自动导入URL到流量表"""
    try:
        data = request.get_json()
        tab_urls = data.get('tab_urls', [])

        if not tab_urls:
            return jsonify({'success': False, 'message': 'tab_urls 不能为空'})

        cdp = _get_cdp_instance()
        result = cdp.collect_batch(tab_urls)

        # 自动导入：合并 links + scripts，去重后导入（只导入域名范围内的）
        if result.get('success') and result.get('data'):
            collected = result['data']
            all_urls = list(collected.get('links', []))
            all_urls.extend(collected.get('scripts', []))
            all_urls = list(set(all_urls))

            # 域名范围过滤
            project = spider_db.get_running_project()
            domain_list = project.get('domain_list', []) if project else []
            if domain_list and all_urls:
                filtered_urls = []
                for url in all_urls:
                    try:
                        from urllib.parse import urlparse
                        url_host = urlparse(url).hostname
                        if not url_host:
                            continue
                        url_host = url_host.lower()
                        for domain in domain_list:
                            if not domain:
                                continue
                            try:
                                domain_host = urlparse(domain).hostname.lower()
                            except:
                                domain_host = domain.lower()
                            if url_host == domain_host or url_host.endswith('.' + domain_host):
                                filtered_urls.append(url)
                                break
                    except:
                        pass
                all_urls = filtered_urls

            if all_urls:
                from api.import_traffic_api import get_import_api
                import_api = get_import_api()
                imported = 0
                for url in all_urls:
                    try:
                        r = import_api.import_traffic_url(url)
                        if r.get('success'):
                            imported += 1
                    except:
                        pass
                result['import_stats'] = {
                    'total': len(all_urls),
                    'imported': imported
                }

        # 更新处理状态 & 合并标签
        project = spider_db.get_running_project()
        if project:
            project_name = project['Project']
            processed = spider_db.mark_urls_processed(project_name, tab_urls)
            result['processed'] = processed

            page_tags = result.get('page_tags', {})
            tag_updated = spider_db.merge_page_tags(project_name, page_tags)
            if tag_updated:
                result['tag_updated'] = tag_updated

        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/cdp/scroll', methods=['POST'])
def cdp_scroll_pages():
    """滚动指定 Tab 页面至底部"""
    try:
        data = request.get_json()
        tab_urls = data.get('tab_urls', [])
        max_scrolls = data.get('max_scrolls', 10)

        if not tab_urls:
            return jsonify({'success': False, 'message': 'tab_urls 不能为空'})

        cdp = _get_cdp_instance()
        result = cdp.scroll_pages(tab_urls, max_scrolls)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/cdp/fill-forms', methods=['POST'])
def cdp_fill_forms():
    """自动填写指定 Tab 页面中的表单"""
    try:
        data = request.get_json()
        tab_urls = data.get('tab_urls', [])

        if not tab_urls:
            return jsonify({'success': False, 'message': 'tab_urls 不能为空'})

        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        personal_info = project.get('personal_info', {})
        if not personal_info:
            return jsonify({'success': False, 'message': '表单信息为空，请先在「表单信息编辑」中配置'})

        cdp = _get_cdp_instance()
        result = cdp.fill_forms(tab_urls, personal_info)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ========== 站点信息总览 API ==========

@spider_api.route('/api/spider/sites/overview', methods=['GET'])
def sites_overview():
    """获取站点总览
    - site 参数：指定站点，返回 stats + subdomains + websites
    - 无 site 参数：返回所有站点聚合数据
    """
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        project_name = project['Project']

        # 域名列表
        domain_list = []
        raw_domains = request.args.get('domains', '')
        if raw_domains:
            try:
                domain_list = json.loads(raw_domains)
            except:
                pass
        if not domain_list:
            domain_list = project.get('domain_list', [])

        site_param = request.args.get('site', '').strip()
        force_refresh = request.args.get('refresh', '').strip().lower() == '1'

        if site_param:
            site_stripped = site_param.rstrip('/')
            try:
                site_hostname = (_URL(site_stripped).hostname or '').lower()
            except:
                site_hostname = ''

            if not site_hostname:
                return jsonify({'success': False, 'message': '无效的站点地址'})

            # 获取分类数据（含缓存）
            classified = spider_db.get_classified_site_data(project_name, site_stripped, site_hostname, force_refresh)

            # 获取关联子域名 & 网站
            subdomains = spider_db.get_site_subdomains(project_name, site_hostname)
            websites = spider_db.get_site_websites(project_name, site_hostname)

            # 计算待处理 URL 数量
            pending_urls = sum(1 for u in classified['urls'] if u.get('process_status', 0) == 0)

            return jsonify({
                'success': True,
                'data': {
                    'site': site_stripped,
                    'site_hostname': site_hostname,
                    'stats': {
                        'total_urls': len(classified['urls']),
                        'pending_urls': pending_urls,
                        'total_apis': len(classified['apis']),
                        'total_scripts': len(classified['scripts'])
                    },
                    'subdomains': subdomains,
                    'websites': websites,
                    'domain_list': domain_list
                }
            })

        # 无 site 参数：返回所有站点聚合
        data = spider_db.get_all_sites_overview(project_name, domain_list)
        return jsonify({'success': True, 'data': data})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/sites/page', methods=['GET'])
def sites_page():
    """站点面板分页查询（服务端分页 + 排序）"""
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        project_name = project['Project']

        site_param = request.args.get('site', '').strip()
        panel_type = request.args.get('type', '').strip()
        page = max(1, int(request.args.get('page', 1)))
        page_size = min(200, max(1, int(request.args.get('page_size', 50))))
        keyword = request.args.get('keyword', '').strip().lower()
        sort_field = request.args.get('sort_field', '').strip()
        sort_order = request.args.get('sort_order', 'asc').strip().lower()
        force_refresh = request.args.get('refresh', '').strip().lower() == '1'
        process_status_arg = request.args.get('process_status', '').strip()
        process_status = None
        if process_status_arg != '':
            try:
                process_status = int(process_status_arg)
            except ValueError:
                process_status = None

        if not site_param:
            return jsonify({'success': False, 'message': 'site 参数必填'})
        if panel_type not in ('urls', 'apis', 'scripts'):
            return jsonify({'success': False, 'message': 'type 参数必须为 urls/apis/scripts'})

        site_stripped = site_param.rstrip('/')
        try:
            site_hostname = _URL(site_stripped).hostname.lower()
        except:
            return jsonify({'success': False, 'message': '无效的站点地址'})

        # 验证排序字段和顺序
        valid_sort_fields = {
            'urls': ['http_status_code', 'process_status', 'title', 'tag', 'url', 'time_update', 'html_md5'],
            'apis': ['url', 'method', 'time_update', 'html_md5'],
            'scripts': ['url', 'time_update', 'html_md5']
        }
        if sort_field and panel_type in valid_sort_fields:
            if sort_field not in valid_sort_fields[panel_type]:
                sort_field = ''
        if sort_order not in ('asc', 'desc'):
            sort_order = 'asc'

        data = spider_db.get_site_page(
            project_name, site_stripped, site_hostname,
            panel_type, page, page_size, keyword, force_refresh,
            sort_field, sort_order, process_status
        )

        return jsonify({'success': True, 'data': data})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ========== 表单信息编辑 API ==========

@spider_api.route('/api/spider/forms/get', methods=['GET'])
def forms_get():
    """获取表单信息（personal_info）"""
    try:
        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        return jsonify({
            'success': True,
            'data': project.get('personal_info', {})
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@spider_api.route('/api/spider/forms/save', methods=['POST'])
def forms_save():
    """保存表单信息（personal_info）"""
    try:
        data = request.get_json()
        personal_info = data.get('personal_info', {})

        project = spider_db.get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        spider_db.save_personal_info(project['Project'], personal_info)
        return jsonify({'success': True, 'message': '表单信息已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500












