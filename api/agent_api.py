from flask import Blueprint, jsonify

agent_bp = Blueprint('agent_api', __name__)

@agent_bp.route('/api/agent/status', methods=['GET'])
def get_agent_status():
    """获取Agent状态"""
    return jsonify({'status': 'ready'})

@agent_bp.route('/api/agent/config', methods=['GET'])
def get_agent_config():
    """获取Agent配置"""
    return jsonify({'config': {}})

@agent_bp.route('/api/agent/config', methods=['POST'])
def update_agent_config():
    """更新Agent配置"""
    return jsonify({'message': '配置更新成功'})