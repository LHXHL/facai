# coding: utf-8
from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_socketio import SocketIO, emit
import json
import os
import asyncio

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = 'facai-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', max_http_buffer_size=50 * 1024 * 1024)

CONFIG_FILE = 'config.json'

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_config(config):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=4)

# 导入并注册project_api蓝图
from api.project_api import project_api
app.register_blueprint(project_api)

# 导入并注册traffic_api蓝图
from api.traffic_api import traffic_api
app.register_blueprint(traffic_api)

# 导入并注册assets_config_api蓝图
from api.assets_config_api import assets_config_bp
app.register_blueprint(assets_config_bp)

# 导入并注册import_traffic_api蓝图
from api.import_traffic_api import import_traffic_api
app.register_blueprint(import_traffic_api)

# 导入并注册tools_api蓝图
from api.tools_api import tools_api
app.register_blueprint(tools_api)

# 导入并注册subdomain_api蓝图
from api.subdomain_api import subdomain_api
app.register_blueprint(subdomain_api)

# 导入并注册website_api蓝图
from api.website_api import website_api
app.register_blueprint(website_api)

# 导入并注册html_api蓝图
from api.html_api import html_api
app.register_blueprint(html_api)

# 导入并注册http_api蓝图
from api.http_api import http_api
app.register_blueprint(http_api)

# 导入并注册highlight_api蓝图
from api.highlight_api import highlight_api
app.register_blueprint(highlight_api)

# 导入并注册overview_api蓝图
from api.overview_api import overview_api
app.register_blueprint(overview_api)

# 导入并注册service_api蓝图
from api.service_api import service_api
app.register_blueprint(service_api)

# 导入并注册agent_api蓝图
from api.agent_api import agent_bp
app.register_blueprint(agent_bp)

# 导入并注册mcp_api蓝图
from api.mcp_api import mcp_bp
app.register_blueprint(mcp_bp)

# 导入并注册scaner_api蓝图
from api.scaner_api import scaner_api
app.register_blueprint(scaner_api)

# 导入并注册fuzz_api蓝图
from api.fuzz_api import fuzz_api
app.register_blueprint(fuzz_api)

# 导入并注册spider_api蓝图
from api.spider_api import spider_api
app.register_blueprint(spider_api)

from api.capture_api import capture_api, init_capture_socketio
app.register_blueprint(capture_api)
init_capture_socketio(socketio)

# ========== Werkzeug 3.x 兼容补丁 ==========
# RequestContext.session 在 Werkzeug 3.x 变为只读 property，
# Flask-SocketIO 内部会尝试写入 session 导致 AttributeError。
# 补丁：添加 setter 支持。
import flask.ctx
if isinstance(flask.ctx.RequestContext.__dict__.get('session'), property):
    _orig_session_fget = flask.ctx.RequestContext.__dict__['session'].fget

    def _patched_session_getter(self):
        return getattr(self, '_session', _orig_session_fget(self))

    def _patched_session_setter(self, value):
        self._session = value

    flask.ctx.RequestContext.session = property(_patched_session_getter, _patched_session_setter)

# ========== WebSocket 事件（AI Agent 实时流式输出）==========

# 存储当前运行中的任务 {sid: {'chat': result, 'audit': result}}
_running_tasks = {}

@socketio.on('connect')
def ws_connect():
    """客户端连接"""
    pass

@socketio.on('disconnect')
def ws_disconnect():
    """客户端断开"""
    from api.agent_api import get_agent
    sid = request.sid
    if sid in _running_tasks:
        agent = get_agent()
        for task_id in list(_running_tasks[sid].keys()):
            if task_id != '_cancelled':
                agent.cancel_stream(task_id)
        del _running_tasks[sid]

    async_task = _orchestrator_async_tasks.pop(sid, None)
    if async_task and not async_task.done():
        try:
            orchestrator = get_orchestrator()
            for task in orchestrator.task_manager.list_tasks():
                if task.status.value in ('running', 'pending'):
                    orchestrator.cancel_task(task.id)
        except Exception:
            pass
        async_task.cancel()

def _run_async_background(coro, sid, event_prefix):
    """在后台线程中运行异步协程，通过 WebSocket 实时推送结果"""
    import logging
    logger = logging.getLogger()

    if sid not in _running_tasks:
        _running_tasks[sid] = {}

    def _thread_target():
        with app.app_context():
            try:
                asyncio.run(coro)
            except Exception as e:
                logger.exception(f"后台异步任务异常: {e}")
                socketio.emit(f'{event_prefix}_chunk', {'error': str(e)}, room=sid)
                socketio.emit(f'{event_prefix}_done', {}, room=sid)

    socketio.start_background_task(_thread_target)


@socketio.on('chat_stream')
def ws_chat_stream(data):
    """
    WebSocket 流式聊天
    data: {
        messages: [...],
        mode: 'chat' | 'agent',
        deep_think: bool,
        enable_memory: bool,
        mcp_servers: [...],
        skills: [...]
    }
    """
    from api.agent_api import get_agent
    sid = request.sid

    # 如果有旧任务在运行，先取消
    if sid in _running_tasks and 'chat' in _running_tasks[sid]:
        try:
            old_result = _running_tasks[sid]['chat']
            if old_result and hasattr(old_result, 'cancel'):
                old_result.cancel()
        except Exception:
            pass

    try:
        messages = data.get('messages', [])
        mode = data.get('mode', 'chat')
        deep_think = data.get('deep_think', False)
        enable_memory = data.get('enable_memory', False)
        mcp_server_names = data.get('mcp_servers', None)
        skill_names = data.get('skills', None)

        if not messages:
            emit('chat_chunk', {'error': '消息不能为空'})
            emit('chat_done', {})
            return

        agent = get_agent()

        async def _stream():
            async_gen = None
            try:
                if mode == 'agent':
                    async_gen = await agent.agent_chat(messages, stream=True, deep_think=deep_think, mcp_server_names=mcp_server_names, skill_names=skill_names, enable_memory=enable_memory)
                else:
                    async_gen = await agent.chat(messages, stream=True, deep_think=deep_think, skill_names=skill_names, enable_memory=enable_memory)
                cancelled = False
                full_content = ''
                thinking_content = ''
                async for chunk in async_gen:
                    if sid in _running_tasks and _running_tasks[sid].get('_cancelled'):
                        cancelled = True
                        break
                    if isinstance(chunk, dict):
                        chunk_type = chunk.get('type', 'text')
                        chunk_content = chunk.get('content', '')
                        if chunk_type == 'thinking':
                            thinking_content += chunk_content
                            socketio.emit('chat_chunk', {'type': 'thinking', 'content': chunk_content}, room=sid)
                        else:
                            full_content += chunk_content
                            socketio.emit('chat_chunk', {'type': 'text', 'content': chunk_content}, room=sid)
                    else:
                        full_content += chunk
                        socketio.emit('chat_chunk', {'content': chunk}, room=sid)
                if cancelled:
                    socketio.emit('chat_chunk', {'content': '\n[已停止]'}, room=sid)
                    socketio.emit('chat_done', {'stopped': True}, room=sid)
                else:
                    if enable_memory and full_content:
                        try:
                            from agent.memory import add_memory
                            last_user_msg = ''
                            for msg in reversed(messages):
                                if msg.get('role') == 'user':
                                    c = msg.get('content', '')
                                    if isinstance(c, list):
                                        last_user_msg = ' '.join(p.get('text', '') for p in c if p.get('type') == 'text')
                                    else:
                                        last_user_msg = c
                                    break
                            if last_user_msg:
                                add_memory(f"用户: {last_user_msg}\n助手: {full_content[:500]}")
                        except Exception as e:
                            logger.error(f"保存对话记忆失败: {str(e)}")
                    socketio.emit('chat_done', {'thinking_content': thinking_content if thinking_content else None}, room=sid)
            except asyncio.CancelledError:
                socketio.emit('chat_chunk', {'content': '\n[已停止]'}, room=sid)
                socketio.emit('chat_done', {'stopped': True}, room=sid)
            except Exception as e:
                error_msg = str(e)
                logger.error(f"聊天流异常: {error_msg}")
                # 检测是否为多模态/图片不支持的错误
                vision_keywords = ['不支持图片', '不支持多模态', 'does not support image',
                                   'image is not supported', 'images are not supported',
                                   'vision', 'multimodal', 'vlm', '图片',
                                   'unable to process image', 'cannot process image',
                                   'not a vision model', 'not a multimodal model',
                                   'invalid_image', 'unsupported content type']
                is_vision_error = any(kw in error_msg.lower() for kw in vision_keywords)
                if is_vision_error:
                    socketio.emit('chat_chunk', {'type': 'text', 'content': '⚠️ ' + error_msg}, room=sid)
                else:
                    socketio.emit('chat_chunk', {'error': error_msg}, room=sid)
                socketio.emit('chat_done', {}, room=sid)
            finally:
                if sid in _running_tasks:
                    _running_tasks[sid].pop('_cancelled', None)

        _run_async_background(_stream(), sid, 'chat')
    except Exception as e:
        emit('chat_chunk', {'error': str(e)})
        emit('chat_done', {})

@socketio.on('chat_stop')
def ws_chat_stop():
    """停止当前聊天任务"""
    from api.agent_api import get_agent
    sid = request.sid
    if sid in _running_tasks:
        _running_tasks[sid]['_cancelled'] = True
    agent = get_agent()
    agent.cancel_stream('chat')
    agent.cancel_stream('agent')

    async_task = _orchestrator_async_tasks.get(sid)
    if async_task and not async_task.done():
        try:
            orchestrator = get_orchestrator()
            for task in orchestrator.task_manager.list_tasks():
                if task.status.value in ('running', 'pending'):
                    orchestrator.cancel_task(task.id)
        except Exception:
            pass
        async_task.cancel()

_orchestrator_instance = None
_orchestrator_async_tasks = {}  # {sid: asyncio.Task}

def get_orchestrator():
    global _orchestrator_instance
    if _orchestrator_instance is None:
        from agent.lib.orchestrator import Orchestrator
        _orchestrator_instance = Orchestrator()
    return _orchestrator_instance


@socketio.on('agent_task_submit')
def ws_agent_task_submit(data):
    """
    提交Agent编排任务
    data: {
        title: str,
        description: str,
        system_prompt: str,
        mcp_servers: [...],
        skills: [...],
        deep_think: bool,
        enable_memory: bool
    }
    """
    sid = request.sid
    title = data.get('title', '未命名任务')
    description = data.get('description', '')
    system_prompt = data.get('system_prompt', '')
    mcp_server_names = data.get('mcp_servers', None)
    skill_names = data.get('skills', None)
    deep_think = data.get('deep_think', False)
    enable_memory = data.get('enable_memory', False)
    chat_history = data.get('chat_history', [])

    if not description:
        emit('agent_task_error', {'error': '任务描述不能为空'})
        return

    orchestrator = get_orchestrator()

    if orchestrator.is_busy():
        emit('agent_task_error', {'error': '已有Agent任务在执行中，请等待完成后再提交新任务'})
        return

    def stream_callback(chunk):
        socketio.emit('agent_task_chunk', chunk, room=sid)

    async def _run():
        task = await orchestrator.submit_task(
            title=title,
            description=description,
            system_prompt=system_prompt,
            mcp_server_names=mcp_server_names,
            skill_names=skill_names,
            deep_think=deep_think,
            enable_memory=enable_memory,
            stream_callback=stream_callback,
            chat_history=chat_history
        )
        socketio.emit('agent_task_done', {'task_id': task.id, 'status': task.status.value if hasattr(task.status, 'value') else task.status}, room=sid)

    def _thread_target():
        with app.app_context():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                async_task = loop.create_task(_run())
                _orchestrator_async_tasks[sid] = async_task
                try:
                    loop.run_until_complete(async_task)
                except asyncio.CancelledError:
                    socketio.emit('agent_task_cancelled', {}, room=sid)
                finally:
                    _orchestrator_async_tasks.pop(sid, None)
                    loop.close()
            except Exception as e:
                logging.getLogger().exception(f"Agent编排任务异常: {e}")
                socketio.emit('agent_task_error', {'error': str(e)}, room=sid)

    socketio.start_background_task(_thread_target)


@socketio.on('agent_task_cancel')
def ws_agent_task_cancel(data):
    """取消Agent编排任务 - 从后端真正终止执行"""
    sid = request.sid
    task_id = data.get('task_id', '')

    orchestrator = get_orchestrator()
    if task_id:
        orchestrator.cancel_task(task_id)

    async_task = _orchestrator_async_tasks.get(sid)
    if async_task and not async_task.done():
        async_task.cancel()

    emit('agent_task_cancelled', {'task_id': task_id})


@socketio.on('agent_task_list')
def ws_agent_task_list():
    """获取任务列表"""
    orchestrator = get_orchestrator()
    tasks = orchestrator.list_tasks()
    emit('agent_task_list_result', {'tasks': tasks})


@socketio.on('agent_task_status')
def ws_agent_task_status(data):
    """获取任务状态"""
    task_id = data.get('task_id', '')
    orchestrator = get_orchestrator()
    status = orchestrator.get_task_status(task_id)
    if status:
        emit('agent_task_status_result', status)
    else:
        emit('agent_task_status_result', {'error': '任务不存在'})

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

@app.route('/project_data/<path:filename>')
def serve_project_data(filename):
    """提供project_data目录下的静态文件（截图等）"""
    return send_from_directory('project_data', filename)

@app.route('/api/traffic/list', methods=['GET'])
def traffic_list():
    return jsonify({'traffic': []})

@app.route('/api/traffic/detail/<id>', methods=['GET'])
def traffic_detail(id):
    return jsonify({})

@app.route('/api/traffic/clear', methods=['POST'])
def traffic_clear():
    return jsonify({'message': '流量清空成功'})

@app.route('/api/assets/overview', methods=['GET'])
def assets_overview():
    return jsonify({
        'subdomains': 0,
        'websites': 0,
        'http': 0,
        'ip': 0,
        'highlights': 0
    })

@app.route('/api/assets/config', methods=['GET'])
def assets_config_get():
    return jsonify({'config': {}})

@app.route('/api/assets/config', methods=['POST'])
def assets_config_post():
    return jsonify({'message': '配置保存成功'})

@app.route('/api/assets/subdomains', methods=['GET'])
def assets_subdomains_list():
    return jsonify({'subdomains': []})

@app.route('/api/assets/subdomains', methods=['POST'])
def assets_subdomains_add():
    return jsonify({'message': '子域名添加成功'})

@app.route('/api/assets/subdomains/<id>', methods=['DELETE'])
def assets_subdomains_delete(id):
    return jsonify({'message': '子域名删除成功'})

@app.route('/api/assets/websites', methods=['GET'])
def assets_websites_list():
    return jsonify({'websites': []})

@app.route('/api/assets/websites/<id>', methods=['GET'])
def assets_websites_detail(id):
    return jsonify({})

@app.route('/api/assets/websites/<id>', methods=['DELETE'])
def assets_websites_delete(id):
    return jsonify({'message': '网站删除成功'})

@app.route('/api/assets/html', methods=['GET'])
def assets_html_list():
    return jsonify({'html': []})

@app.route('/api/assets/html/<md5>', methods=['GET'])
def assets_html_detail(md5):
    return jsonify({})

@app.route('/api/assets/html/<md5>', methods=['DELETE'])
def assets_html_delete(md5):
    return jsonify({'message': 'HTML删除成功'})

@app.route('/api/assets/ip-cidr', methods=['GET'])
def assets_ipcidr_list():
    return jsonify({'ipc': []})

@app.route('/api/assets/ip-cidr', methods=['POST'])
def assets_ipcidr_add():
    return jsonify({'message': 'IP C段添加成功'})

@app.route('/api/assets/ip-cidr/<id>', methods=['DELETE'])
def assets_ipcidr_delete(id):
    return jsonify({'message': 'IP C段删除成功'})

@app.route('/api/assets/ip', methods=['GET'])
def assets_ip_list():
    return jsonify({'ip': []})

@app.route('/api/assets/ip', methods=['POST'])
def assets_ip_add():
    return jsonify({'message': 'IP添加成功'})

@app.route('/api/assets/ip/<id>', methods=['DELETE'])
def assets_ip_delete(id):
    return jsonify({'message': 'IP删除成功'})

@app.route('/api/assets/highlights', methods=['GET'])
def assets_highlights_list():
    return jsonify({'data': []})

@app.route('/api/assets/highlights', methods=['POST'])
def assets_highlights_add():
    return jsonify({'message': '重点资产添加成功'})

@app.route('/api/assets/highlights/<id>', methods=['POST'])
def assets_highlights_update(id):
    return jsonify({'message': '重点资产更新成功'})

@app.route('/api/assets/highlights/<id>', methods=['DELETE'])
def assets_highlights_delete(id):
    return jsonify({'message': '重点资产删除成功'})



@app.route('/api/tools/encode/base64', methods=['POST'])
def tools_encode_base64():
    return jsonify({})

@app.route('/api/tools/encode/url', methods=['POST'])
def tools_encode_url():
    return jsonify({})

@app.route('/api/tools/decode/base64', methods=['POST'])
def tools_decode_base64():
    return jsonify({})

@app.route('/api/tools/decode/url', methods=['POST'])
def tools_decode_url():
    return jsonify({})

@app.route('/api/tools/clipboard', methods=['GET'])
def tools_clipboard_list():
    return jsonify({'clipboard': []})

@app.route('/api/tools/clipboard', methods=['POST'])
def tools_clipboard_add():
    return jsonify({'message': '剪贴板添加成功'})

@app.route('/api/tools/clipboard/<index>', methods=['DELETE'])
def tools_clipboard_delete(index):
    return jsonify({'message': '剪贴板删除成功'})

@app.route('/api/system/config', methods=['GET'])
def system_config_get():
    config = load_config()
    return jsonify({'config': config})

@app.route('/api/system/config', methods=['POST'])
def system_config_post():
    data = request.get_json()
    save_config(data)
    return jsonify({'message': '配置保存成功'})

@app.route('/api/system/status', methods=['GET'])
def system_status():
    return jsonify({})

if __name__ == '__main__':
    config = load_config()
    port = config.get('flask_port', 5000)
    socketio.run(app, debug=False, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)