# coding: utf-8
"""
爆破工具 API
"""
from flask import Blueprint, request, jsonify
import json
import os
import threading
from service.scaner.fuzz_engine import get_fuzz_engine
from database.mongodb_handler import MongoDBHandler

fuzz_api = Blueprint('fuzz_api', __name__, url_prefix='/api/fuzz')


def get_running_project():
    """获取当前运行项目"""
    try:
        from service.Class_Core_Function import Class_Core_Function
        core_function = Class_Core_Function()
        project_config = core_function.callback_project_config()
        if project_config and 'Project' in project_config:
            return project_config
        return None
    except:
        return None


@fuzz_api.route('/requests/database', methods=['GET'])
def get_requests_from_database():
    """从数据库获取网站URL列表（用于路径/文件爆破）"""
    try:
        project = get_running_project()
        if not project:
            return jsonify({'success': False, 'message': '没有运行中的项目'})

        project_name = project['Project']
        db_handler = MongoDBHandler()
        collection_name = f"project_{project_name}_website"

        # 查询数据
        docs = db_handler.find(collection_name, {}, limit=10000, projection={'url': 1, 'domain': 1, '_id': 0})

        urls_list = []
        for doc in docs:
            url = doc.get('url', '').rstrip('/')
            if url:
                urls_list.append({
                    'url': url,
                    'domain': doc.get('domain', '')
                })

        return jsonify({
            'success': True,
            'data': {
                'urls': urls_list,
                'count': len(urls_list)
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/start', methods=['POST'])
def fuzz_start():
    """启动爆破任务"""
    try:
        data = request.get_json()

        mode = data.get('mode', 'single')  # single / multi
        fuzz_mode = data.get('fuzz_mode', 'single')  # single / cross

        # 获取字典
        dict1_raw = data.get('dict1', [])
        dict2_raw = data.get('dict2', [])

        # 如果是字符串（来自textarea），按行分割
        if isinstance(dict1_raw, str):
            dict1 = [line.strip() for line in dict1_raw.split('\n') if line.strip()]
        else:
            dict1 = dict1_raw

        if isinstance(dict2_raw, str):
            dict2 = [line.strip() for line in dict2_raw.split('\n') if line.strip()]
        else:
            dict2 = dict2_raw

        # 线程数和超时
        threads = int(data.get('threads', 10))
        timeout = int(data.get('timeout', 10))

        # 匹配条件
        match_status = data.get('match_status', None)
        match_length = data.get('match_length', None)
        match_regex = data.get('match_regex', None)

        engine = get_fuzz_engine()

        if mode == 'single':
            # 单请求模式
            base_request = data.get('request', {})
            if not base_request.get('url'):
                return jsonify({'success': False, 'message': '缺少请求URL'})

            if not dict1:
                return jsonify({'success': False, 'message': '字典1为空'})

            # 启动后台任务
            thread = threading.Thread(
                target=engine.fuzz_single,
                args=(base_request, dict1, dict2, fuzz_mode, threads, timeout,
                      match_status, match_length, match_regex, None)
            )
            thread.daemon = True
            thread.start()

        else:
            # 多请求模式 - 从数据库读取所有URL
            if not dict1:
                return jsonify({'success': False, 'message': '字典1为空'})

            # 启动后台任务
            thread = threading.Thread(
                target=engine.fuzz_multi,
                args=(dict1, dict2, fuzz_mode, threads, timeout,
                      match_status, match_length, match_regex, None)
            )
            thread.daemon = True
            thread.start()

        return jsonify({
            'success': True,
            'message': '爆破任务已启动',
            'data': {
                'dict1_count': len(dict1),
                'dict2_count': len(dict2) if dict2 else 0,
                'threads': threads
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/stop', methods=['POST'])
def fuzz_stop():
    """停止爆破任务"""
    try:
        engine = get_fuzz_engine()
        engine.stop()
        return jsonify({'success': True, 'message': '爆破任务已停止'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/pause', methods=['POST'])
def fuzz_pause():
    """暂停爆破任务"""
    try:
        engine = get_fuzz_engine()
        engine.pause()
        return jsonify({'success': True, 'message': '爆破任务已暂停'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/resume', methods=['POST'])
def fuzz_resume():
    """继续爆破任务"""
    try:
        engine = get_fuzz_engine()
        engine.resume()
        return jsonify({'success': True, 'message': '爆破任务已继续'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/progress', methods=['GET'])
def fuzz_progress():
    """获取爆破进度"""
    try:
        engine = get_fuzz_engine()
        progress = engine.get_progress()
        return jsonify({
            'success': True,
            'data': progress
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/results', methods=['GET'])
def fuzz_results():
    """获取爆破结果"""
    try:
        engine = get_fuzz_engine()
        results = engine.get_results()
        return jsonify({
            'success': True,
            'data': {
                'results': results,
                'total': len(results)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/results/file', methods=['GET'])
def fuzz_results_file():
    """读取结果文件内容"""
    try:
        engine = get_fuzz_engine()
        file_path = engine.get_result_file_path()
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return jsonify({
                'success': True,
                'data': {
                    'content': content,
                    'path': file_path
                }
            })
        return jsonify({
            'success': True,
            'data': {
                'content': '',
                'path': file_path
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/results/clear', methods=['POST'])
def fuzz_results_clear():
    """清空结果文件"""
    try:
        engine = get_fuzz_engine()
        engine.clear_results()
        return jsonify({
            'success': True,
            'message': '结果已清空'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@fuzz_api.route('/status', methods=['GET'])
def fuzz_status():
    """获取爆破状态"""
    try:
        engine = get_fuzz_engine()
        return jsonify({
            'success': True,
            'data': {
                'running': engine.is_running(),
                'progress': engine.get_progress(),
                'result_count': len(engine.get_results())
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
