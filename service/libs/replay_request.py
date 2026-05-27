# coding: utf-8

import base64
import warnings

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

import requests as _requests_lib

warnings.filterwarnings('ignore', message='Unverified HTTPS request')


def _get_socks5_proxy():
    try:
        from service.Class_Core_Function import Class_Core_Function
        return Class_Core_Function().callback_socks5_proxy()
    except Exception:
        return None


def _get_requests_proxies():
    proxy = _get_socks5_proxy()
    if proxy:
        return {'http': proxy, 'https': proxy}
    return None


def _detect_encoding(response):
    enc = response.encoding
    if enc and enc.lower() not in ('iso-8859-1',):
        return enc
    ct = response.headers.get('Content-Type', '')
    if 'charset=' in ct:
        import re
        m = re.search(r'charset=([^\s;]+)', ct, re.I)
        if m:
            return m.group(1).strip('"\'')
    content = response.content[:4096]
    if b'\xef\xbb\xbf' in content[:3]:
        return 'utf-8-sig'
    try:
        content.decode('utf-8')
        return 'utf-8'
    except Exception:
        pass
    try:
        from chardet import detect
        r = detect(content)
        if r and r.get('encoding'):
            return r['encoding']
    except Exception:
        pass
    return 'utf-8'


def _encode_headers(headers):
    encoded = {}
    has_non_ascii = False
    for k, v in headers.items():
        if isinstance(v, str):
            try:
                v.encode('ascii')
                encoded[k] = v
            except UnicodeEncodeError:
                has_non_ascii = True
                encoded[k] = v.encode('utf-8').decode('latin-1')
        else:
            encoded[k] = v
    return encoded, has_non_ascii


def send_http_request(request_data, timeout=5, allow_redirects=False):
    try:
        url = request_data.get('url', '')
        method = request_data.get('method', 'GET').upper()
        headers, _ = _encode_headers(request_data.get('headers', {}))
        body = request_data.get('body')
        body_encoding = request_data.get('body_encoding', 'plain')

        methods_with_body = ['POST', 'PUT', 'PATCH', 'DELETE']

        request_kwargs = {
            'method': method,
            'url': url,
            'headers': headers,
            'timeout': timeout,
            'allow_redirects': allow_redirects,
            'verify': False
        }

        if method in methods_with_body and body:
            if body_encoding == 'base64':
                if isinstance(body, str):
                    request_kwargs['data'] = base64.b64decode(body)
                else:
                    request_kwargs['data'] = body
            elif isinstance(body, (dict, list)):
                request_kwargs['json'] = body
            else:
                request_kwargs['data'] = body

        proxies = _get_requests_proxies()
        if proxies:
            request_kwargs['proxies'] = proxies

        response = _requests_lib.request(**request_kwargs)
        return response

    except Exception as e:
        return None


def replay_http_request(url, method='GET', headers=None, body='', body_encoding='plain'):
    if headers is None:
        headers = {}

    headers, has_non_ascii = _encode_headers(headers)

    _remove_headers_lower = {
        'host', 'content-length', 'transfer-encoding', 'accept-encoding',
        'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
        'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
        'upgrade-insecure-requests',
    }
    for key in list(headers.keys()):
        if key.lower() in _remove_headers_lower:
            del headers[key]

    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'close',
    }
    headers_lower = {k.lower(): v for k, v in headers.items()}
    for key, value in default_headers.items():
        if key.lower() not in headers_lower:
            headers[key] = value

    req_data = None
    if method.upper() in ['POST', 'PUT', 'PATCH', 'DELETE']:
        if body_encoding == 'base64':
            if isinstance(body, str):
                req_data = base64.b64decode(body)
            else:
                req_data = body
        elif isinstance(body, (dict, list)):
            req_data = json.dumps(body).encode('utf-8')
            if 'content-type' not in {k.lower() for k in headers}:
                headers['Content-Type'] = 'application/json'
        else:
            if isinstance(body, str):
                req_data = body.encode('utf-8')
            else:
                req_data = body

    if _HAS_HTTPX and not has_non_ascii:
        return _replay_httpx(url, method, headers, req_data)
    else:
        return _replay_requests(url, method, headers, req_data)


def _replay_httpx(url, method, headers, req_data):
    try:
        client_kwargs = {
            'http2': True,
            'verify': False,
            'follow_redirects': True,
            'timeout': 30,
        }
        proxy = _get_socks5_proxy()
        if proxy:
            client_kwargs['proxy'] = proxy

        with httpx.Client(**client_kwargs) as client:
            response = client.request(
                method=method,
                url=url,
                headers=headers,
                content=req_data,
            )
            return _HttpxResponseWrapper(response)
    except httpx.TimeoutException:
        raise Exception('请求超时(30s): 目标服务器未在规定时间内响应，可能是网络延迟或服务器拒绝连接')
    except httpx.ConnectError:
        raise Exception('连接失败: 无法连接到目标服务器，请检查URL是否正确或网络是否可用')
    except httpx.HTTPError as e:
        raise Exception(f'请求执行失败: {str(e)}')


def _replay_requests(url, method, headers, req_data):
    request_kwargs = {
        'url': url,
        'method': method,
        'headers': headers,
        'timeout': 30,
        'verify': False,
        'allow_redirects': True,
    }
    if req_data is not None:
        request_kwargs['data'] = req_data

    proxies = _get_requests_proxies()
    if proxies:
        request_kwargs['proxies'] = proxies

    try:
        response = _requests_lib.request(**request_kwargs)
        return response
    except _requests_lib.exceptions.Timeout:
        raise Exception('请求超时(30s): 目标服务器未在规定时间内响应，可能是网络延迟或服务器拒绝连接')
    except _requests_lib.exceptions.ConnectionError:
        raise Exception('连接失败: 无法连接到目标服务器，请检查URL是否正确或网络是否可用')
    except _requests_lib.exceptions.RequestException as e:
        raise Exception(f'请求执行失败: {str(e)}')


class _HttpxResponseWrapper:
    def __init__(self, httpx_resp):
        self._resp = httpx_resp
        self.status_code = httpx_resp.status_code
        self.headers = httpx_resp.headers
        self.content = httpx_resp.content

    @property
    def encoding(self):
        return self._resp.encoding

    @property
    def text(self):
        enc = self._resp.encoding
        if enc and enc.lower() not in ('iso-8859-1',):
            try:
                return self.content.decode(enc)
            except Exception:
                pass
        ct = self.headers.get('content-type', '')
        if 'charset=' in ct:
            import re
            m = re.search(r'charset=([^\s;]+)', ct, re.I)
            if m:
                try:
                    return self.content.decode(m.group(1).strip('"\''))
                except Exception:
                    pass
        try:
            self.content.decode('utf-8')
            return self.content.decode('utf-8')
        except Exception:
            pass
        try:
            from chardet import detect
            r = detect(self.content[:4096])
            if r and r.get('encoding'):
                return self.content.decode(r['encoding'])
        except Exception:
            pass
        return self.content.decode('utf-8', errors='replace')


import json
