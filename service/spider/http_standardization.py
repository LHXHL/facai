# HTTP请求标准化/去重模块
# 参考 112312.py 的 class_request_param 实现

import re,urllib.parse,json,os
from urllib.parse import urlparse, urlunparse, parse_qsl
from nltk.corpus import words
from service.Class_Core_Function import Class_Core_Function

# 初始化核心函数类
_core_func = Class_Core_Function()

list_word_set=['404', '500', 'acl', 'actions', 'activemq', 'admin', 'aframe', 'agg', 'ansible', 'api', 'app', 'archicad', 'async', 'auth', 'autocad', 'avatar', 'avg', 'avro', 'babylonjs', 'bak', 'bandwidth', 'bashrc', 'benchmark', 'bitbucket', 'blkid', 'branches', 'bugfix', 'callback', 'captcha', 'cb', 'cd', 'cdn', 'cert', 'cfg', 'cgi', 'ci', 'cli', 'clojure', 'cms', 'cn', 'comp', 'comps', 'condarc', 'conf', 'config', 'cooked', 'cookie', 'cordova', 'cors', 'cp', 'cpp', 'crd', 'credentials', 'cron', 'crontab', 'crt', 'crud', 'csharp', 'csr', 'csrf', 'csv', 'ctx', 'datadog', 'debounce', 'debug', 'decr', 'demo', 'der', 'deserialize', 'df', 'diff', 'dist', 'django', 'dlq', 'dmesg', 'dns', 'dockerignore', 'docs', 'docx', 'download', 'dsa', 'dto', 'du', 'e2e', 'e2fsck', 'ecdsa', 'ecs', 'ed25519', 'elasticsearch', 'env', 'erlang', 'eslint', 'etc', 'etcd', 'eval', 'exec', 'extlinux', 'faq', 'fastapi', 'fdisk', 'figma', 'firewalld', 'fsck', 'ftp', 'gatsby', 'github', 'gitignore', 'gitlab', 'gmt', 'golang', 'gpg', 'grafana', 'graphql', 'grpc', 'gui', 'guid', 'h5', 'haskell', 'hdparm', 'hmr', 'hooks', 'hotfix', 'htop', 'http', 'https', 'i18n', 'idx', 'iftop', 'impl', 'incr', 'indesign', 'info', 'ini', 'iotop', 'ip', 'iptables', 'isolinux', 'istio', 'javascript', 'jenkins', 'jira', 'jks', 'journalctl', 'js', 'json', 'jsp', 'jwt', 'k8s', 'kb', 'keystore', 'kotlin', 'kubernetes', 'kv', 'l10n', 'lang', 'lb', 'lib', 'lilo', 'linkerd', 'logrotate', 'logs', 'lru', 'lsblk', 'lsof', 'lua', 'lvm', 'matlab', 'mdadm', 'memcached', 'memtest', 'mgr', 'misc', 'mkfs', 'mongodb', 'mq', 'mqtt', 'msg', 'mutations', 'mutex', 'mv', 'mvc', 'mysql', 'nagios', 'nestjs', 'netstat', 'newrelic', 'nextjs', 'nginx', 'nload', 'npmrc', 'ns', 'ntfsfix', 'nuxtjs', 'nvme', 'oauth', 'obj', 'openapi', 'ops', 'options', 'orig', 'orm', 'oss', 'otp', 'p12', 'p5js', 'payload', 'pdf', 'pem', 'perl', 'perms', 'pfx', 'pgp', 'photoshop', 'php', 'pid', 'placeholder', 'plugin', 'polyfill', 'postgres', 'ppt', 'pptx', 'preferences', 'prettier', 'prev', 'privs', 'proc', 'processing', 'protobuf', 'prv', 'ps', 'pwd', 'pxelinux', 'qa', 'rabbitmq', 'rbac', 'rc', 'reactnative', 'readonly', 'redis', 'refactor', 'releases', 'repo', 'required', 'resize2fs', 'revit', 'rfc', 'rm', 'robots', 'rollup', 'rpc', 'rsa', 'rsync', 'runtime', 'scp', 'sdk', 'sdparm', 'selinux', 'seo', 'seq', 'settings', 'sftp', 'sitemap', 'sketchup', 'smartctl', 'snapshots', 'solidworks', 'solr', 'spinlock', 'splunk', 'sqlite', 'sqlserver', 'src', 'srv', 'ss', 'ssh', 'ssl', 'sso', 'ssr', 'stat', 'stringify', 'svc', 'svg', 'swp', 'sys', 'syslinux', 'systemctl', 'tags', 'teams', 'terraform', 'threejs', 'timeout', 'tls', 'tmp', 'toml', 'traceroute', 'troubleshoot', 'truststore', 'ts', 'ttl', 'tutorialapi', 'txt', 'tz', 'uat', 'ufw', 'ui', 'uid', 'umount', 'unescape', 'upload', 'upsert', 'url', 'utc', 'util', 'utils', 'uuid', 'ux', 'v0.1', 'v1', 'v1.0', 'v1.0.0', 'v1.0.1', 'v1.1', 'v1.2', 'v1.3', 'v2', 'v2.0', 'v3', 'var', 'vimrc', 'vite', 'vnstat', 'vo', 'vpc', 'vue', 'webgl', 'webgpu', 'webhook', 'webpack', 'wf', 'wget', 'wiki', 'wp', 'ws', 'wss', 'xamarin', 'xfs_repair', 'xls', 'xlsx', 'xml', 'yaml', 'yarnrc', 'yml', 'zabbix', 'zeplin', 'zeromq', 'zookeeper', 'zshrc']
# 英文单词集合（NLTK）
_word_list = set(words.words()) if hasattr(words, 'words') else set()

# 手动词表集合（小写），优先级高于NLTK，不区分大小写
_manual_word_set = set(w.lower() for w in list_word_set)

# 驼峰命名拆分正则：在每个大写字母前插入空格（保留连续大写字母作为一个词）
_camel_split_re = re.compile(r'([A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|$))')


def _split_camel_case(word: str) -> list:
    """
    拆分驼峰命名字符串为单词列表
    例如: WebLoginTrpc → ['Web', 'Login', 'Trpc']
         NewRefresh → ['New', 'Refresh']
         trpc → ['trpc']
    """
    if not word:
        return []
    
    # 先尝试用正则拆分
    parts = _camel_split_re.findall(word)
    if parts:
        return parts
    
    # 如果正则没匹配到，尝试用下划线/点号分割
    if '_' in word:
        return word.split('_')
    if '.' in word:
        return word.split('.')
    
    return [word]


def _check_string_type(text):
    """
    判断HTTP请求参数值类型
    支持: Int, Float, Hash, URL_TYPE, EN_URL, JSON, EN_JSON, EN_String, String
    """
    if text is None:
        return 'String'

    # 转为字符串并去除两端空白
    text_str = str(text).strip()
    if not text_str:
        return 'String'

    # 1. 判断是否为纯整数 (兼容负数)
    if text_str.isdigit() or (text_str.startswith('-') and text_str[1:].isdigit()):
        return 'Int'

    # 2. 判断是否为浮点数 (如 3.14, -0.99)
    try:
        float(text_str)
        return 'Float'
    except ValueError:
        pass

    # 3. 判断是否为哈希值 (MD5: 32位, SHA1: 40位, SHA256: 64位)
    # 使用正则匹配纯十六进制字符，比 all() 遍历更高效严谨
    if len(text_str) in [32, 40, 64] and re.match(r'^[0-9a-fA-F]+$', text_str):
        return 'Hash'

    # 4. URL解码逻辑判断 (正如你提到的核心思路)
    is_url_encoded = False
    decoded_text = text_str

    # 只有当包含 % 且后面跟着两位十六进制字符时，才认为可能是URL编码
    if '%' in text_str and re.search(r'%[0-9a-fA-F]{2}', text_str):
        try:
            unquoted = urllib.parse.unquote(text_str)
            # 如果解码后的字符串与原字符串不同，说明确实被编码过
            if unquoted != text_str:
                is_url_encoded = True
                decoded_text = unquoted
        except Exception:
            pass

    # 5. 对【解码后的真实文本】进行特征判断

    # 判断是否为 URL (兼容 http://, https://, //)
    if decoded_text.startswith(('http://', 'https://', '//')):
        return 'EN_URL' if is_url_encoded else 'URL_TYPE'

    # 判断是否为 JSON (HTTP接口中经常把 JSON 字符串作为参数传递)
    if (decoded_text.startswith('{') and decoded_text.endswith('}')) or \
       (decoded_text.startswith('[') and decoded_text.endswith(']')):
        try:
            json.loads(decoded_text)
            return 'EN_JSON' if is_url_encoded else 'JSON'
        except json.JSONDecodeError:
            pass

    # 6. 如果是被编码过的其他文本，区分一下
    if is_url_encoded:
        # 有些特殊的场景下，Hash也会被莫名其妙 encode
        if len(decoded_text) in [32, 40, 64] and re.match(r'^[0-9a-fA-F]+$', decoded_text):
            return 'EN_Hash'
        return 'EN_String'

    # 7. 兜底返回普通字符串
    return 'String'


def _callback_length(text, max_length=30):
    """获取文本长度，最大30"""
    if text is None:
        return 0
    return min(len(str(text) if not isinstance(text, str) else text), max_length)


def callback_pathname(pathname: str) -> str:
    """
    处理路径
    /admin/123/demo.jsp → /admin/{Int-3}/demo.jsp
    /admin/hello/world → /admin/hello/world (保留英文单词)
    /trpc.video.account/NewRefresh → /trpc-video-account/NewRefresh
    """
    # 使用 os.path.splitext 判断文件扩展名（与 Class_Core_Function.callback_file_extensions 一致）
    type_file = ''
    path_without_ext = pathname
    
    # 提取文件扩展名
    ext = os.path.splitext(pathname)[1]
    if ext and len(ext) <= 7:  # 包括点号，最长如 .suffix (6+1=7)
        type_file = ext.lower()
        path_without_ext = pathname[:-len(ext)]
    
    # 分割路径为各个段
    list_path = []
    # 分隔符正则：同时按 . _ - 拆分
    _sep_re = re.compile(r'[._\-]+')
    
    def _is_valid_word(word: str) -> bool:
        """判断是否为有效单词，手动词表优先于NLTK，不区分大小写"""
        w = word.lower()
        return w in _manual_word_set or w in _word_list
    
    def _process_segment(segment: str, depth: int = 0) -> str:
        """
        递归处理路径段，拆分所有分隔符和驼峰命名
        返回用 - 拼接的字符串
        核心规则：只有词表（手动+NLTK）中且长度>=2的单词才原样输出，其余全部结构化
        拆分超过3个部分 → 整体参数化
        """
        if not segment:
            return ''
        
        # 限制递归深度
        if depth > 3:
            return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
        
        # 1. 按 . _ - 同时拆分
        if _sep_re.search(segment):
            sub_tokens = [t for t in _sep_re.split(segment) if t]
            # 拆分超过3个部分 → 整体参数化
            if len(sub_tokens) > 3:
                return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
            results = []
            for t in sub_tokens:
                r = _process_segment(t, depth + 1)
                if r:
                    results.append(r)
            return '-'.join(results)
        
        # 2. 手动词表优先：在手动词表中 → 直接保留
        if segment.lower() in _manual_word_set:
            return segment
        
        # 3. 纯数字 → {Int-N}
        if segment.isdigit():
            return f'{{Int-{len(segment)}}}'
        
        # 4. 混合数字字母 → 整体参数化
        if any(c.isdigit() for c in segment) and any(c.isalpha() for c in segment):
            return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
        
        # 4. 有大写字母，尝试驼峰拆分
        if any(c.isupper() for c in segment):
            camel_parts = _split_camel_case(segment)
            # 驼峰拆分超过3个部分 → 整体参数化
            if len(camel_parts) > 3:
                return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
            # 统计有效单词（词表中且长度>=2）
            word_count = sum(1 for cp in camel_parts if _is_valid_word(cp) and len(cp) >= 2)
            non_word_count = len(camel_parts) - word_count
            # 有效单词数 <= 非单词数 → 整体参数化
            if word_count <= non_word_count:
                return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
            # 否则逐个处理：词表单词保留，其余结构化
            results = []
            for cp in camel_parts:
                if _is_valid_word(cp) and len(cp) >= 2:
                    results.append(cp)
                else:
                    results.append(f'{{{_check_string_type(cp)}-{len(cp)}}}')
            return '-'.join(results)
        
        # 5. 纯小写字母：词表中 → 保留，否则参数化
        if _is_valid_word(segment) and len(segment) >= 2:
            return segment
        
        return f'{{{_check_string_type(segment)}-{_callback_length(segment)}}}'
    
    for line in path_without_ext.split('/'):
        if line == '':
            continue
        
        processed_segment = _process_segment(line)
        
        if processed_segment:
            list_path.append(processed_segment)
        else:
            text_type = _check_string_type(line)
            length = _callback_length(line)
            list_path.append(f'{{{text_type}-{length}}}')

    path = '/'.join(list_path)
    if type_file:
        path = path + type_file
    return path


def callback_request_param_list(http_request: dict, type_model: int = 0) -> list:
    """
    返回http请求参数列表
    
    过滤规则:
        - 参数名长度大于30的参数将被过滤（避免文件上传等场景的误解析）
        - 最多返回100个参数
    """
    list_param = []
    try:
        urlparse_url = urlparse(http_request.get('url', ''))
        
        # 处理URL查询参数
        for line, key in dict(parse_qsl(urlparse_url.query)).items():
            # 过滤参数名长度大于30的参数
            if len(line) <= 30:
                list_param.append({
                    "param_name": line,
                    "value": key,
                    "value_len": _callback_length(key),
                    "value_type": _check_string_type(key)
                })
        
        # 处理hash参数
        if type_model == 1 and urlparse_url.fragment:
            # 正确解析hash中的查询参数
            fragment = urlparse_url.fragment
            if '?' in fragment:
                _, hash_query = fragment.split('?', 1)
                for line, key in dict(parse_qsl(hash_query)).items():
                    # 过滤参数名长度大于30的参数
                    if len(line) <= 30:
                        list_param.append({
                            "param_name": line,
                            "value": key,
                            "value_len": _callback_length(key),
                            "value_type": _check_string_type(key)
                        })
        
        # 处理body参数（非GET请求）
        method = http_request.get('method', 'GET').upper()
        if method != 'GET':
            body = http_request.get('body', '')
            body_encoding = http_request.get('body_encoding', 'plain')
            # base64编码的body（如multipart文件上传），无法解析为参数，跳过
            if body_encoding == 'base64':
                pass
            elif isinstance(body, dict):
                # JSON body（已经是dict类型）
                list_param.extend(_process_json_param(body))
            elif isinstance(body, str) and body:
                # 判断是否为JSON字符串
                if (body.startswith('{') and body.endswith('}')) or \
                   (body.startswith('[') and body.endswith(']')):
                    try:
                        json_body = json.loads(body)
                        list_param.extend(_process_json_param(json_body))
                    except json.JSONDecodeError:
                        # JSON解析失败，当作普通form body处理
                        if not body.startswith('------') and not body.startswith('<'):
                            for line, key in dict(parse_qsl(body)).items():
                                # 过滤参数名长度大于30的参数
                                if len(line) <= 30:
                                    list_param.append({
                                        "param_name": line,
                                        "value": key,
                                        "value_len": _callback_length(key),
                                        "value_type": _check_string_type(key)
                                    })
                elif not body.startswith('------') and not body.startswith('<'):
                    # 普通form body
                    for line, key in dict(parse_qsl(body)).items():
                        # 过滤参数名长度大于30的参数
                        if len(line) <= 30:
                            list_param.append({
                                "param_name": line,
                                "value": key,
                                "value_len": _callback_length(key),
                                "value_type": _check_string_type(key)
                            })
        
        # 再次过滤：确保所有参数名长度不超过30（包括JSON嵌套参数）
        list_param = [p for p in list_param if len(p['param_name']) <= 30]
        
        return list_param[:100]  # 限制参数数量
    except Exception:
        return []


def _process_json_param(data, prefix='', depth=1, max_depth=3):
    """
    处理JSON参数
    
    过滤规则:
        - 参数名长度大于30的参数将被过滤
    """
    result = []
    if isinstance(data, dict):
        for k, v in data.items():
            new_prefix = f"{prefix}.{k}" if prefix else k
            # 过滤参数名长度大于30的参数
            if len(new_prefix) > 30:
                continue
            if isinstance(v, (dict, list)) and depth < max_depth:
                result.extend(_process_json_param(v, new_prefix, depth + 1))
            else:
                result.append({
                    "param_name": new_prefix,
                    "value": v,
                    "value_len": _callback_length(v),
                    "value_type": _check_string_type(v)
                })
    elif isinstance(data, list):
        for i, item in enumerate(data):
            new_prefix = f"{prefix}[{i}]"
            # 过滤参数名长度大于30的参数
            if len(new_prefix) > 30:
                continue
            if isinstance(item, (dict, list)) and depth < max_depth:
                result.extend(_process_json_param(item, new_prefix, depth + 1))
            else:
                result.append({
                    "param_name": new_prefix,
                    "value": item,
                    "value_len": _callback_length(item),
                    "value_type": _check_string_type(item)
                })
    return result


def _get_json_keys(data, prefix='', depth=1, max_depth=3):
    """获取JSON中的所有键名"""
    keys = []
    if isinstance(data, dict):
        for k, v in data.items():
            new_prefix = f"{prefix}.{k}" if prefix else k
            if isinstance(v, (dict, list)) and depth < max_depth:
                keys.extend(_get_json_keys(v, new_prefix, depth + 1))
            else:
                keys.append(new_prefix)
    elif isinstance(data, list):
        for i, item in enumerate(data):
            new_prefix = f"{prefix}[{i}]"
            if isinstance(item, (dict, list)) and depth < max_depth:
                keys.extend(_get_json_keys(item, new_prefix, depth + 1))
            else:
                keys.append(new_prefix)
    return keys


def standardize_request(http_request: dict, type_model: int = 1) -> dict:
    """
    标准化HTTP请求，生成去重指纹

    Args:
        http_request: HTTP请求字典 {'url': str, 'method': str, 'body': str/dict}
        type_model: 是否处理hash参数，0=不处理hash，1=处理hash

    Returns:
        dict: {
            'url': str,  # 原始URL
            'method': str,  # 请求方法
            'body': str/dict,  # 请求体
            'url_path': str,  # 原始URL（不含查询参数），如 https://example.com/path
            'url_generalization': str,  # 标准化路径+参数
            'param_feature': str,  # 参数特征
            'file_extension': str,  # 文件扩展名
            'key': str  # 去重key（md5格式）
        }
    """
    try:
        url = http_request.get('url', '')
        method = http_request.get('method', 'GET').upper()
        body = http_request.get('body', '')

        url_parse = urlparse(url)

        # 原始URL（不含查询参数），如 https://example.com/path
        url_path = _core_func.callback_split_url(url, 3)

        # 获取文件扩展名
        file_extension = _core_func.callback_file_extensions(url)

        # 判断是否为.js文件，如果是则不进行路径参数化处理，也不处理查询参数
        if file_extension == '.js':
            # JS文件：直接返回原始URL（不含查询参数）
            url_generalization = url_path
            param_feature_str = ''
            # JS文件可能被多个站点引入，相同URL不同origin应视为不同记录，避免去重后查不到
            origin = (http_request.get('headers', {}).get('origin', '') or '').rstrip('/')
            key_str = f"{method}:{url_path}"
            if origin:
                key_str += f":{origin}"
            key = _core_func.md5_convert(key_str)

            return {
                'url': url_path,
                'method': method,
                'body': body,
                'url_path': url_path,
                'url_generalization': url_generalization,
                'param_feature': param_feature_str,
                'file_extension': file_extension,
                'key': key
            }

        # 非JS文件：正常进行路径参数化处理
        # 标准化路径
        if url_parse.path:
            path_generalization = callback_pathname(url_parse.path)
        else:
            path_generalization = ''

        # 提取参数特征（用于 param_feature，包含所有参数）
        list_param = callback_request_param_list(http_request, type_model)

        # url_generalization 只包含 URL 查询参数（直接从 URL 查询字符串提取）
        param_std_list = []
        if url_parse.query:
            for line, key in dict(parse_qsl(url_parse.query)).items():
                param_std_list.append(f"{line}={_check_string_type(key)}-{_callback_length(key)}")
        param_std_list.sort()
        param_std_str = '&'.join(param_std_list)

        # 构建标准化URL
        url_generalization = urlunparse(url_parse._replace(
            query='',
            params='',
            fragment='',
            path=path_generalization
        ))

        # 添加主URL查询参数
        if param_std_str:
            url_generalization += '?' + param_std_str

        # 处理hash参数 (当type_model=1时)
        if type_model == 1 and url_parse.fragment:
            # 正确解析hash中的路径和查询参数
            # 例如：#/aaa/?das=1 -> path=/aaa/, query=das=1
            fragment = url_parse.fragment
            if '?' in fragment:
                hash_path_str, hash_query_str = fragment.split('?', 1)
            else:
                hash_path_str = fragment
                hash_query_str = ''

            # 处理hash中的路径参数化
            if hash_path_str:
                hash_path = callback_pathname(hash_path_str)
            else:
                hash_path = ''

            # 处理hash中的查询参数
            hash_params = []
            if hash_query_str:
                for line, key in dict(parse_qsl(hash_query_str)).items():
                    hash_params.append(f"{line}={_check_string_type(key)}-{_callback_length(key)}")
                hash_params.sort()

            # 构建hash标准化字符串（hash路径需要保留前导/）
            hash_generalization = '#/' + hash_path if hash_path else '#'
            if hash_params:
                hash_generalization += '?' + '&'.join(hash_params)

            url_generalization += hash_generalization

        # 参数特征（包含所有参数：URL查询、body、hash）
        param_features = []
        for p in list_param:
            param_features.append(f"{p['param_name']}={p['value_type']}-{p['value_len']}")
        param_features.sort()
        param_feature_str = '&'.join(param_features)

        # 去重key: method + 标准化URL + param_feature_str，然后转为md5
        key_str = f"{method}:{url_generalization}:{param_feature_str}"
        key = _core_func.md5_convert(key_str)

        return {
            'url': url,
            'method': method,
            'body': body,
            'url_path': url_path,
            'url_generalization': url_generalization,
            'param_feature': param_feature_str,
            'file_extension': file_extension,
            'key': key
        }
        
    except Exception:
        url = http_request.get('url', '')
        method = http_request.get('method', 'GET').upper()
        body = http_request.get('body', '')
        url_parse = urlparse(url)

        # 获取文件扩展名
        file_extension = _core_func.callback_file_extensions(url)

        # JS文件异常路径也需纳入origin
        origin = (http_request.get('headers', {}).get('origin', '') or '').rstrip('/')
        fallback_key_str = f"{method}:{url}"
        if file_extension == '.js' and origin:
            fallback_key_str += f":{origin}"

        return {
            'url': url,
            'method': method,
            'body': body,
            'url_path': _core_func.callback_split_url(url, 3),
            'url_generalization': url,
            'param_feature': '',
            'file_extension': file_extension,
            'key': _core_func.md5_convert(fallback_key_str)
        }





# 测试
if __name__ == '__main__':
    test_requests = [
        {'url': 'https://example.com/path/dasdas', 'method': 'GET', 'body': ''},
        {'url': 'https://example.com/path?sada=21312', 'method': 'GET', 'body': ''},
        {'url': 'https://example.com/path/123?sada=21312', 'method': 'GET', 'body': ''},
        {'url': 'https://example.com/admin/hello/demo', 'method': 'GET', 'body': ''},
        {'url': 'https://example.com/admin/123/demo.jsp', 'method': 'GET', 'body': ''},
    ]

    print("=== HTTP请求标准化测试 ===\n")
    for req in test_requests:
        std = standardize_request(req)
        print(f"原始: {req['url']}")
        print(f"标准化路径: {std['url_generalization']}")
        print(f"Key: {std['key']}")
        print('-' * 60)

    print("\n=== 去重测试 ===")
    unique = deduplicate_requests(test_requests)
    print(f"原始数量: {len(test_requests)}, 去重后: {len(unique)}")
