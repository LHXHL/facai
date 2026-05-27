# coding: utf-8
from flask import Blueprint, request, jsonify
import json
import time
import base64
from service.libs.replay_request import replay_http_request
from service.libs.port_scan import port_scan

_BINARY_CONTENT_TYPES = {
    'image/', 'application/pdf', 'application/octet-stream',
    'application/zip', 'application/gzip', 'application/x-tar',
    'application/x-rar', 'application/x-7z',
    'audio/', 'video/', 'application/x-shockwave-flash',
    'application/vnd.ms-', 'application/vnd.openxmlformats',
    'application/msword', 'application/java-archive',
    'application/x-executable', 'application/x-dosexec',
    'font/', 'application/x-font',
}


def _is_binary_content_type(ct):
    if not ct:
        return False
    ct_lower = ct.lower().split(';')[0].strip()
    for prefix in _BINARY_CONTENT_TYPES:
        if ct_lower.startswith(prefix):
            return True
    return False

tools_api = Blueprint('tools_api', __name__)

@tools_api.route('/api/tools/replay', methods=['POST'])
def tools_replay():
    """
    HTTP请求重放API
    接收JSON格式的请求数据，执行HTTP请求并返回响应
    """
    try:
        # 获取请求数据
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': '请求数据不能为空'
            }), 400
        
        # 验证必填字段
        url = data.get('url')
        method = data.get('method', 'GET').upper()
        headers = data.get('headers', {})
        body = data.get('body', '')
        body_encoding = data.get('body_encoding', 'plain')
        max_body_size = data.get('max_body_size', 102400)
        
        if not url:
            return jsonify({
                'error': 'URL不能为空'
            }), 400
        
        # 验证URL格式
        if not url.startswith('http://') and not url.startswith('https://'):
            return jsonify({
                'error': 'URL必须以http://或https://开头'
            }), 400
        
        # 兼容处理：如果body是字典/列表对象，转换为JSON字符串
        if body and isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        
        start_time = time.time()
        response = replay_http_request(
            url=url,
            method=method,
            headers=headers,
            body=body,
            body_encoding=body_encoding
        )
        end_time = time.time()

        response_time = int((end_time - start_time) * 1000)

        resp_headers = {}
        for k, v in response.headers.items():
            resp_headers[k] = str(v)

        content_type = resp_headers.get('Content-Type', resp_headers.get('content-type', ''))
        is_binary = _is_binary_content_type(content_type)

        if is_binary:
            raw_content = response.content
            if max_body_size == -1:
                max_body_size = 100 * 1024 * 1024
            truncated = False
            original_size = len(raw_content)
            if len(raw_content) > max_body_size:
                raw_content = raw_content[:max_body_size]
                truncated = True
            response_body = base64.b64encode(raw_content).decode('ascii')
            body_encoding = 'base64'
        else:
            try:
                enc = response.encoding
                if enc and enc.lower() in ('iso-8859-1',):
                    ct = response.headers.get('Content-Type', '')
                    if 'charset=' in ct:
                        import re
                        m = re.search(r'charset=([^\s;]+)', ct, re.I)
                        if m:
                            enc = m.group(1).strip('"\'')
                        else:
                            enc = None
                    else:
                        enc = None
                if enc:
                    try:
                        response_body = response.content.decode(enc)
                    except Exception:
                        response_body = response.content.decode('utf-8', errors='replace')
                else:
                    try:
                        response.content.decode('utf-8')
                        response_body = response.content.decode('utf-8')
                    except Exception:
                        try:
                            from chardet import detect
                            r = detect(response.content[:4096])
                            if r and r.get('encoding'):
                                response_body = response.content.decode(r['encoding'])
                            else:
                                response_body = response.content.decode('utf-8', errors='replace')
                        except Exception:
                            response_body = response.content.decode('utf-8', errors='replace')
            except Exception:
                response_body = response.content.decode('utf-8', errors='replace')

            if max_body_size == -1:
                max_body_size = 100 * 1024 * 1024
            truncated = False
            original_size = len(response_body)
            if len(response_body) > max_body_size:
                response_body = response_body[:max_body_size]
                truncated = True
            body_encoding = 'plain'

        result = {
            'status_code': response.status_code,
            'response_time': f'{response_time}ms',
            'response_headers': resp_headers,
            'response_body': response_body,
            'body_encoding': body_encoding,
        }

        if truncated:
            result['_truncated'] = True
            result['_originalSize'] = original_size

        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'error': str(e)
        })


@tools_api.route('/api/tools/port-scan', methods=['POST'])
def tools_port_scan():
    """
    端口扫描API
    使用nmap进行端口扫描
    参数: ip (目标IP), args (nmap参数), ports (端口范围)
    """
    try:
        # 获取请求数据
        ip = request.form.get('ip') or request.get_json().get('ip') if request.is_json else request.form.get('ip')
        args = request.form.get('args') or request.get_json().get('args') if request.is_json else request.form.get('args')
        ports = request.form.get('ports') or request.get_json().get('ports') if request.is_json else request.form.get('ports')
        
        # 如果是JSON格式请求
        if request.is_json:
            data = request.get_json()
            ip = data.get('ip')
            args = data.get('args', '')
            ports = data.get('ports', '')
        
        # 验证必填字段
        if not ip:
            return jsonify({
                'error': '请输入目标IP地址或域名'
            }), 400
        
        if not ports:
            return jsonify({
                'error': '请输入端口范围'
            }), 400
        
        # 执行端口扫描
        result = port_scan(
            target=ip,
            args=args,
            ports=ports
        )
        
        if result.get('error'):
            return jsonify(result), 400
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'error': f'扫描失败: {str(e)}'
        }), 500

