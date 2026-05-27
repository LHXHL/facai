from flask import Blueprint, jsonify

mcp_bp = Blueprint('mcp_api', __name__)

@mcp_bp.route('/api/mcp/servers', methods=['GET'])
def get_mcp_servers():
    """获取MCP服务器列表"""
    return jsonify({'servers': []})

@mcp_bp.route('/api/mcp/servers', methods=['POST'])
def add_mcp_server():
    """添加MCP服务器"""
    return jsonify({'message': '服务器添加成功'})

@mcp_bp.route('/api/mcp/servers/<server_id>', methods=['DELETE'])
def delete_mcp_server(server_id):
    """删除MCP服务器"""
    return jsonify({'message': '服务器删除成功'})

@mcp_bp.route('/api/mcp/servers/<server_id>', methods=['POST'])
def update_mcp_server(server_id):
    """更新MCP服务器"""
    return jsonify({'message': '服务器更新成功'})