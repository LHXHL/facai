# coding: utf-8
"""
CDP 爬虫调度器（独立服务）
参考 core.py 的 run() 模式，使用 spider_cdp_service 锁控制循环

调度逻辑：
1. while True 循环
2. 检查 spider_cdp_service 是否为 1，为 0 则 sleep 10秒
3. 从 http 表中读取 website=website, status=0, http_type=1 的待处理数据
4. 读取数量由 browser_thread 控制
5. 读取后立即将 status 设为 1（防重复读取）
6. 对 url 进行 CDP 爬取
7. 如果没有待处理数据则 sleep 10秒
"""

import time
from service.Class_Core_Function import Class_Core_Function
from service.spider.spider_cdp import SpiderCDP
from database.http_database import HttpDatabase
from database.mongodb_handler import MongoDBHandler


class SpiderCDPScheduler:
    """CDP 爬虫调度器，独立 while 循环，受 spider_cdp_service 锁控制"""

    def __init__(self):
        self.core_function = Class_Core_Function()
        self.cdp = SpiderCDP()
        self.db_handler = MongoDBHandler()
        self.is_running = True
        self.website_list = None  # 由 API 层设置

    def _get_project_config(self):
        """获取当前运行中的项目配置"""
        return self.core_function.callback_project_config()

    def _check_cdp_service_lock(self, project_config):
        """
        检查 spider_cdp_service 锁状态
        Returns: int - 1=开启, 0=关闭
        """
        if not project_config:
            return 0

        # 优先从 service_lock 中读取
        service_lock = project_config.get('service_lock', {})
        if 'spider_cdp_service' in service_lock:
            return int(service_lock.get('spider_cdp_service', 0))

        # 兼容：从顶层字段读取
        return int(project_config.get('spider_cdp_service', 0))

    def _check_chrome_cdp(self):
        """检查 Chrome CDP 是否可用"""
        cdp_port = self.cdp._get_cdp_port()
        return self.cdp._check_port_open('127.0.0.1', cdp_port), cdp_port

    def _get_and_lock_pending_urls(self, project_name, limit, website_list=None):
        """
        从 http 表中读取 status=0, http_type=1 的待处理数据
        如果有 website_list，则只读取 website 字段匹配目标URL的记录
        读取后立即将 status 设为 1，防止重复读取
        返回 url 列表
        """
        collection_name = f"project_{project_name}_http"
        query = {'status': 0, 'http_type': 1}

        # 有 website_list 时，直接用 website 字段 $in 匹配
        if website_list:
            query['website'] = {'$in': website_list}

        # 1. 读取待处理数据
        docs = self.db_handler.find(collection_name, query, limit=limit)

        if not docs:
            return []

        # 2. 提取 url 和 _id
        urls = []
        doc_ids = []
        for doc in docs:
            url = doc.get('url', '')
            if url:
                urls.append(url)
                doc_ids.append(doc['_id'])

        if not urls:
            return []

        # 3. 立即将 status 设为 1，防止重复读取
        from bson import ObjectId
        id_list = [ObjectId(str(_id)) if not isinstance(_id, ObjectId) else _id for _id in doc_ids]
        self.db_handler.update_many(
            collection_name,
            {'_id': {'$in': id_list}},
            {'status': 1}
        )

        return urls

    def _process_once(self, project_config):
        """
        执行一次 CDP 爬取流程
        1. 从 http 表读取 status=0, http_type=1 的数据
        2. 将 status 设为 1
        3. CDP 爬取
        4. 自动导入到流量表
        5. 合并页面标签
        """
        project_name = project_config.get('Project', '')
        browser_thread = project_config.get('browser_thread', 10)
        website_list = self.website_list

        # 1. 读取待处理 URL 并标记 status=1（仅处理目标站点范围内的）
        urls = self._get_and_lock_pending_urls(project_name, browser_thread, website_list)
        if not urls:
            print("[CDP调度] 没有待处理的URL (status=0, http_type=1)")
            return False  # 返回 False 表示无数据

        print(f"[CDP调度] 获取到 {len(urls)} 条待处理URL，已标记 status=1")

        # 2. CDP 爬取
        result = self.cdp.crawl_urls(
            urls,
            max_concurrent=browser_thread,
            timeout_per_page=30
        )

        crawled_count = len(result.get('results', []))
        print(f"[CDP调度] 爬取完成 {crawled_count} 条")

        # 3. 自动导入收集到的 URL 到流量表
        if result.get('success') and result.get('data'):
            collected = result['data']
            all_import_urls = list(set(
                collected.get('links', []) + collected.get('scripts', [])
            ))

            if all_import_urls:
                try:
                    from api.import_traffic_api import ImportTrafficAPI
                    import_api = ImportTrafficAPI()
                    imported = 0
                    for url in all_import_urls:
                        try:
                            r = import_api.import_traffic_url(url, project_name)
                            if r.get('success'):
                                imported += 1
                        except Exception:
                            pass
                    print(f"[CDP调度] 自动导入 {imported}/{len(all_import_urls)} 个URL")
                except Exception as e:
                    print(f"[CDP调度] 导入失败: {e}")

        # 4. 合并页面标签（去重追加到已有tag）
        page_tags = result.get('page_tags', {})
        if page_tags:
            from database.http_database import HttpDatabase
            http_db = HttpDatabase(project_name)
            tag_updated = http_db.merge_tags(page_tags)
            if tag_updated:
                print(f"[CDP调度] 更新 {tag_updated} 条标签")

        print("[CDP调度] 本轮处理完成")
        return True  # 返回 True 表示有数据

    def run(self):
        """
        调度器主循环（参考 core.py run()）
        - spider_cdp_service=1 → 执行 CDP 爬取
        - spider_cdp_service=0 → sleep 10秒
        - 无待处理数据 → sleep 10秒
        """
        print("[CDP调度] 调度器启动")

        while self.is_running:
            try:
                # 1. 获取项目配置
                project_config = self._get_project_config()
                if not project_config:
                    print("[CDP调度] 未获取到项目配置，睡眠10秒...")
                    time.sleep(10)
                    continue

                project_name = project_config.get('Project', '')

                # 2. 检查 spider_cdp_service 锁
                cdp_service = self._check_cdp_service_lock(project_config)
                if cdp_service != 1:
                    print(f"[CDP调度] CDP爬虫服务未开启 (spider_cdp_service={cdp_service})，睡眠10秒...")
                    time.sleep(10)
                    continue

                # 3. 检查 Chrome CDP 连接
                chrome_ok, cdp_port = self._check_chrome_cdp()
                if not chrome_ok:
                    print(f"[CDP调度] Chrome CDP 未连接（端口 {cdp_port}），睡眠10秒...")
                    time.sleep(10)
                    continue

                # 4. 执行 CDP 爬取
                has_data = self._process_once(project_config)

                # 5. 没有数据则 sleep 10秒，有数据继续干
                if not has_data:
                    time.sleep(10)

            except Exception as e:
                self.core_function.callback_logging().error(f"[CDP调度] 运行异常: {e}")
                print(f"[CDP调度] 运行异常: {e}")
                time.sleep(10)

        print("[CDP调度] 调度器已停止")
        return {'success': True, 'message': 'CDP爬虫调度器已停止'}

    def stop(self):
        """停止调度器"""
        self.is_running = False
        print("[CDP调度] 收到停止信号")


# 独立运行
if __name__ == '__main__':
    scheduler = SpiderCDPScheduler()
    try:
        scheduler.run()
    except KeyboardInterrupt:
        scheduler.stop()
        print("调度器已停止")
