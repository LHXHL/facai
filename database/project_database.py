from .mongodb_handler import MongoDBHandler
import time

class ProjectDatabase:
    def __init__(self):
        self.db_handler = MongoDBHandler()
        self.collection = self.db_handler.get_collection('project_config')

    def get_all_projects(self):
        """获取所有项目"""
        projects = self.db_handler.find('project_config', {})
        # 转换ObjectId为字符串，便于JSON序列化
        result = []
        for project in projects:
            if '_id' in project:
                project['_id'] = str(project['_id'])
            result.append(project)
        return result

    def get_project_by_name(self, project_name):
        """根据项目名称获取项目"""
        project = self.db_handler.find_one('project_config', {'Project': project_name})
        if project and '_id' in project:
            project['_id'] = str(project['_id'])
        return project

    def add_project(self, project_data):
        """添加项目"""
        project_data['created_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
        project_data['status_code'] = 0  # 默认未运行
        return self.db_handler.insert_one('project_config', project_data)

    def update_project(self, project_name, project_data):
        """更新项目（完全替换文档，传入完整数据）"""
        # 保留原有的 created_at 和 status_code 字段
        existing = self.get_project_by_name(project_name)
        if existing:
            # 保留原有字段，不允许前端覆盖
            project_data['created_at'] = existing.get('created_at', project_data.get('created_at', ''))
            project_data['status_code'] = existing.get('status_code', project_data.get('status_code', 0))
            # 移除 _id，避免替换时出错
            project_data.pop('_id', None)
        # 记录完整数据用于调试
        print(f"[ProjectDB] update_project: project_name={project_name}, fields={list(project_data.keys())}")
        print(f"[ProjectDB] new field spider_cdp_service: {project_data.get('spider_cdp_service', 'NOT_FOUND')}")
        result = self.db_handler.replace_one('project_config', {'Project': project_name}, project_data)
        print(f"[ProjectDB] replace_one result: matched={result.matched_count if result else None}, modified={result.modified_count if result else None}")
        return result

    def partial_update(self, project_name, update_data):
        """部分更新项目（$set，只修改传入的字段，不影响其他字段）"""
        update_data.pop('_id', None)
        update_data.pop('Project', None)  # Project 是查询条件，不是更新字段
        if not update_data:
            return None
        print(f"[ProjectDB] partial_update: project_name={project_name}, fields={list(update_data.keys())}")
        result = self.db_handler.update_one('project_config', {'Project': project_name}, update_data)
        print(f"[ProjectDB] partial_update result: matched={result.matched_count if result else None}, modified={result.modified_count if result else None}")
        return result

    def delete_project(self, project_name):
        """删除项目"""
        return self.db_handler.delete_one('project_config', {'Project': project_name})

    def get_running_project(self):
        """获取运行中的项目"""
        project = self.db_handler.find_one('project_config', {'status_code': 1})
        if project and '_id' in project:
            project['_id'] = str(project['_id'])
        #print(f"[ProjectDB] get_running_project: {project}")
        return project

    def start_project(self, project_name):
        """启动项目"""
        # 先停止所有运行中的项目
        self.db_handler.update_one('project_config', {'status_code': 1}, {'status_code': 0})
        # 启动指定项目
        return self.db_handler.update_one('project_config', {'Project': project_name}, {'status_code': 1})

    def stop_project(self, project_name):
        """停止项目"""
        return self.db_handler.update_one('project_config', {'Project': project_name}, {'status_code': 0})

    def get_project_count(self):
        """获取项目总数"""
        return self.db_handler.count_documents('project_config')

    def get_project_status(self, project_name):
        """获取项目状态"""
        project = self.get_project_by_name(project_name)
        if project:
            return project.get('status_code', 0)
        return 0

    def get_service_lock(self, project_name):
        """获取项目的服务锁状态"""
        project = self.get_project_by_name(project_name)
        if project:
            return project.get('service_lock', {
                'spider_service': 0,
                'monitor_service': 0,
                'scaner_service': 0
            })
        return {
            'spider_service': 0,
            'monitor_service': 0,
            'scaner_service': 0
        }

    def update_service_lock(self, project_name, service_name, status):
        """
        更新项目的服务锁状态
        
        Args:
            project_name: 项目名称
            service_name: 服务名称 (spider_service/monitor_service/scaner_service)
            status: 状态 (0/1)
        
        Returns:
            bool: 更新是否成功
        """
        # 获取当前服务锁状态
        service_lock = self.get_service_lock(project_name)
        print(f"[DEBUG] Current service_lock for {project_name}: {service_lock}")
        print(f"[DEBUG] Updating {service_name} to {status}")
        
        # 互斥检查：spider_service 和 monitor_service 不能同时为1
        if status == 1:
            if service_name == 'spider_service':
                # 开启爬虫服务时，关闭资产监控
                service_lock['monitor_service'] = 0
                print(f"[DEBUG] Mutex: closing monitor_service")
            elif service_name == 'monitor_service':
                # 开启资产监控时，关闭爬虫服务
                service_lock['spider_service'] = 0
                print(f"[DEBUG] Mutex: closing spider_service")
        
        # 更新目标服务状态
        service_lock[service_name] = status
        print(f"[DEBUG] New service_lock: {service_lock}")
        
        # 保存到数据库
        result = self.db_handler.update_one(
            'project_config',
            {'Project': project_name},
            {'service_lock': service_lock}
        )
        print(f"[DEBUG] Update result: {result}")
        return result