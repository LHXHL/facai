# coding: utf-8
"""
XSS基础检测模块（无害化）
@Time :    4/5/2026
@Author:  facai
@File: xss.py
@Software: VSCode

功能说明：
1. 统一接口格式：接受HTTP请求JSON和参数列表JSON
2. 仅使用基础payload进行回显检测
3. 不包含任何恶意XSS代码
4. 无害化检测，不触发WAF
5. 使用 ParamHandler.set_param_value 修改参数（默认追加模式）

接口格式：
HTTP请求：
{
   "url": "http://127.0.0.1/test631?name=1",
   "method": "POST",
   "headers": {
       "User-Agent": "Mozilla/5.0"
   },
   "body": "aa=1&bb=a"
}

参数列表：
[
  {"param_name":"name", "param_value":"1", "param_type":"int", "position":"GET"},
  {"param_name":"aa", "param_value":"1", "param_type":"int", "position":"POST"},
  {"param_name":"bb", "param_value":"a", "param_type":"string", "position":"POST"}
]
"""

import requests
from service.scaner.param_handler import ParamHandler
from service.libs.replay_request import send_http_request


class XSSScanner:
    """XSS扫描器（无害化检测）"""
    
    def __init__(self, timeout=5):
        self.timeout = timeout
        self.param_handler = ParamHandler()
        
        # 仅使用无害的基础payload
        self.payloads = [
            "test631'\">",  # 基础回显检测（包含单引号、双引号、尖括号）
        ]
        
        # 回显标记
        self.marker = "test631"
    
    def _parse_echo_chars(self, text):
        """
        解析marker之后的特殊字符转义状态
        
        检查payload中 ', ", > 三个关键字符在响应中的转义情况：
        - unescaped: 未转义，原样回显
        - escaped: 被HTML实体编码（如 &quot; &gt; &#39;）
        - absent: 未出现在预期位置
        
        :param text: marker之后的文本片段
        :return: dict - 各字符的转义状态
        """
        chars = {
            'single_quote': 'absent',
            'double_quote': 'absent',
            'gt': 'absent',
        }
        
        i = 0
        max_len = min(len(text), 30)
        
        while i < max_len:
            ch = text[i]
            
            if ch == "'":
                if chars['single_quote'] == 'absent':
                    chars['single_quote'] = 'unescaped'
                i += 1
            elif ch == '"':
                if chars['double_quote'] == 'absent':
                    chars['double_quote'] = 'unescaped'
                i += 1
            elif ch == '>':
                if chars['gt'] == 'absent':
                    chars['gt'] = 'unescaped'
                i += 1
            elif ch == '&':
                remaining = text[i:]
                lower_remaining = remaining.lower()
                
                if lower_remaining.startswith('&quot;'):
                    if chars['double_quote'] == 'absent':
                        chars['double_quote'] = 'escaped'
                    i += 6
                elif lower_remaining.startswith('&#39;'):
                    if chars['single_quote'] == 'absent':
                        chars['single_quote'] = 'escaped'
                    i += 5
                elif lower_remaining.startswith('&#x27;'):
                    if chars['single_quote'] == 'absent':
                        chars['single_quote'] = 'escaped'
                    i += 6
                elif lower_remaining.startswith('&gt;'):
                    if chars['gt'] == 'absent':
                        chars['gt'] = 'escaped'
                    i += 4
                elif lower_remaining.startswith('&lt;'):
                    i += 4
                elif lower_remaining.startswith('&amp;'):
                    i += 5
                else:
                    i += 1
            elif ch == '<':
                # 可能是HTML标签开始，停止解析
                break
            else:
                i += 1
        
        return chars
    
    def _detect_echo_context(self, response_text, marker_pos):
        """
        检测回显位置的HTML上下文
        
        三种上下文：
        - script: 在<script>标签内的JS代码中
        - attribute: 在HTML标签的属性值中
        - body: 在HTML正文中
        
        :param response_text: 完整响应文本
        :param marker_pos: marker在响应中的位置
        :return: str - 'script' | 'attribute' | 'body'
        """
        before = response_text[max(0, marker_pos - 1000):marker_pos]
        before_lower = before.lower()
        
        # 检查是否在<script>标签内
        last_script_open = before_lower.rfind('<script')
        last_script_close = before_lower.rfind('</script')
        if last_script_open != -1 and last_script_open > last_script_close:
            return 'script'
        
        # 检查是否在HTML标签属性值内
        last_lt = before.rfind('<')
        last_gt = before.rfind('>')
        if last_lt != -1 and last_lt > last_gt:
            # 在标签定义内部，进一步检查是否在属性值中
            tag_content = before[last_lt:]
            if '=' in tag_content:
                last_eq = tag_content.rfind('=')
                after_eq = tag_content[last_eq + 1:].strip()
                if after_eq and after_eq[0] in ('"', "'"):
                    quote_char = after_eq[0]
                    # 检查引号是否未闭合
                    close_quote = after_eq[1:].find(quote_char)
                    if close_quote == -1:
                        return 'attribute'
        
        return 'body'
    
    def _detect_js_string_type(self, before_text):
        """
        检测JS字符串的引号类型
        
        通过从marker位置向前扫描，找到最近的未闭合引号来判断
        当前处于哪种类型的JS字符串中
        
        :param before_text: marker之前的文本
        :return: str - '"' | "'" | None
        """
        i = len(before_text) - 1
        while i >= 0:
            ch = before_text[i]
            if ch == "'" and (i == 0 or before_text[i-1] != '\\'):
                return "'"
            elif ch == '"' and (i == 0 or before_text[i-1] != '\\'):
                return '"'
            elif ch in (';', '{', '}', '\n', '='):
                # 遇到语句边界，停止扫描
                break
            i -= 1
        return None
    
    def _check_exploitability(self, context, chars, response_text, marker_pos):
        """
        根据上下文和字符转义状态判断XSS是否可利用
        
        核心逻辑：
        - <script>上下文：需要能突破JS字符串或闭合script标签
          - > 未转义 → 可闭合script标签（高危）
          - " 未转义 → 可突破双引号字符串
          - ' 未转义但" 已过滤 → 需判断JS字符串类型，若为双引号字符串则不可利用
        - HTML属性上下文：需要能突破属性值
        - HTML正文上下文：需要能注入新标签（> 未转义）
        
        :param context: 回显上下文
        :param chars: 字符转义状态
        :param response_text: 完整响应文本
        :param marker_pos: marker位置
        :return: (bool, str) - (是否可利用, 原因说明)
        """
        if context == 'script':
            # JS上下文：需要能突破当前上下文
            if chars['gt'] == 'unescaped':
                return True, 'JS上下文中>未转义，可闭合script标签注入'
            if chars['double_quote'] == 'unescaped' and chars['single_quote'] == 'unescaped':
                return True, 'JS上下文中引号均未转义，可突破任意字符串'
            if chars['double_quote'] == 'unescaped':
                return True, 'JS上下文中"未转义，可突破双引号字符串'
            if chars['single_quote'] == 'unescaped' and chars['double_quote'] == 'escaped':
                # 关键：' 未转义但 " 已过滤 —— 需判断JS字符串类型
                before_text = response_text[max(0, marker_pos - 200):marker_pos]
                js_string_type = self._detect_js_string_type(before_text)
                if js_string_type == "'":
                    return True, "JS单引号字符串中'未转义，可突破字符串"
                else:
                    # 在双引号字符串或无法确定时，'单独出现不可利用
                    return False, "JS上下文中仅'未转义但\"已过滤，难以利用"
            if chars['single_quote'] == 'unescaped' and chars['double_quote'] == 'absent':
                # 类似情况：" 没有出现在响应中（可能被完全移除），只有 '
                before_text = response_text[max(0, marker_pos - 200):marker_pos]
                js_string_type = self._detect_js_string_type(before_text)
                if js_string_type == "'":
                    return True, "JS单引号字符串中'未转义，可突破字符串"
                return False, "JS上下文中仅'未转义，\"未回显，难以确认可利用性"
            return False, 'JS上下文中关键字符已转义'
        
        elif context == 'attribute':
            # HTML属性上下文：需要能突破属性值
            if chars['double_quote'] == 'unescaped':
                return True, 'HTML属性中"未转义，可突破属性值'
            if chars['gt'] == 'unescaped':
                return True, 'HTML属性中>未转义，可闭合标签'
            if chars['single_quote'] == 'unescaped':
                return True, "HTML属性中'未转义，可能突破属性值"
            return False, 'HTML属性中引号和>已转义'
        
        else:  # body
            # HTML正文上下文：需要能注入新标签
            if chars['gt'] == 'unescaped':
                return True, 'HTML正文中>未转义，可注入HTML标签'
            return False, 'HTML正文中>已转义，难以注入标签'
    
    def _analyze_xss_echo(self, response_text, payload="test631'\">"):
        """
        上下文感知的XSS回显分析
        
        分析流程：
        1. 在响应中查找payload标记（test631）
        2. 检测特殊字符的转义状态（', ", >）
        3. 判断回显上下文（script / attribute / body）
        4. 根据上下文和字符状态判断是否可利用
        
        :param response_text: HTTP响应文本
        :param payload: 使用的payload
        :return: list - 每个回显位置的分析结果
        """
        results = []
        pos = 0
        
        while True:
            idx = response_text.find(self.marker, pos)
            if idx == -1:
                break
            
            # 1. 解析marker之后的特殊字符转义状态
            after = response_text[idx + len(self.marker):idx + len(self.marker) + 30]
            chars = self._parse_echo_chars(after)
            
            # 2. 检测回显上下文
            context = self._detect_echo_context(response_text, idx)
            
            # 3. 判断可利用性
            exploitable, reason = self._check_exploitability(context, chars, response_text, idx)
            
            results.append({
                'context': context,
                'chars': chars,
                'exploitable': exploitable,
                'reason': reason,
            })
            
            pos = idx + len(self.marker)
        
        return results
    
    def scan(self, request_data, params_list=None, send_request_func=None):
        """
        XSS基础检测（无害化）
        
        Args:
            request_data: dict - HTTP请求数据
                {
                    "url": "http://127.0.0.1/test?name=1",
                    "method": "POST",
                    "headers": {"User-Agent": "Mozilla/5.0"},
                    "body": "aa=1&bb=a"
                }
            
            params_list: list - 参数列表（可选，如果为None则自动提取）
                [
                    {"param_name":"name", "param_value":"1", "param_type":"int", "position":"GET"},
                    {"param_name":"aa", "param_value":"1", "param_type":"int", "position":"POST"}
                ]
            
            send_request_func: function - 自定义发送请求函数（可选，如果为None则使用默认）
        
        Returns:
            list - 发现的漏洞列表
                [
                    {
                        'vuln_type': 'XSS疑似漏洞',
                        'xss_type': '反射型XSS（需人工验证）',
                        'param': 'name',
                        'position': 'GET',
                        'payload': 'test631\'">',
                        'evidence': '检测到原始回显（高危）',
                        'risk': '低风险-仅检测到回显，需人工验证是否可利用'
                    }
                ]
        """
        vulnerabilities = []
        
        # XSS 只扫描 GET 请求
        method = request_data.get('method', 'GET').upper()
        if method != 'GET':
            return vulnerabilities
        
        # 如果没有提供参数列表，自动提取参数
        if params_list is None:
            params_list = self.param_handler.callback_list_param(request_data)
        
        # 如果没有提供发送请求函数，使用默认
        if send_request_func is None:
            send_request_func = lambda req: send_http_request(req, timeout=self.timeout)
        
        # 遍历所有参数进行检测
        for param_info in params_list:
            for payload in self.payloads:
                try:
                    # 使用 ParamHandler.set_param_value 修改参数（追加模式）
                    test_request = self.param_handler.set_param_value(
                        request_data, 
                        param_info['param_name'], 
                        payload, 
                        mode=0  # mode=0 追加（默认）
                    )
                    response = send_request_func(test_request)
                    if response:
                        # 上下文感知的回显分析
                        response_text = response.text if hasattr(response, 'text') else str(response)
                        echo_results = self._analyze_xss_echo(response_text, payload)
                        
                        for echo in echo_results:
                            if echo['exploitable']:
                                from service.Class_Core_Function import Class_Core_Function
                                core_func = Class_Core_Function()
                                
                                url = request_data.get('url', '')
                                context_desc = {'script': 'JS上下文', 'attribute': 'HTML属性上下文', 'body': 'HTML正文上下文'}
                                
                                # 构建字符转义详情
                                chars_detail = []
                                for ch_name, ch_label in [('single_quote', "'"), ('double_quote', '"'), ('gt', '>')]:
                                    status = echo['chars'][ch_name]
                                    if status != 'absent':
                                        chars_detail.append(f"{ch_label}{'' if status == 'unescaped' else '(已转义)'}")
                                
                                vulnerabilities.append({
                                    'url': url,
                                    'method': request_data.get('method'),
                                    'headers': request_data.get('headers', {}),
                                    'body': request_data.get('body', ''),
                                    'website': core_func.callback_split_url(url, 0),
                                    'subdomain': core_func.callback_split_url(url, 2),
                                    'vuln_type': 'xss',
                                    'vuln_type_detail': f"xss-reflect-{echo['context']}",
                                    'level': 'medium',
                                    'paramname': param_info['param_name'],
                                    'payload': payload,
                                    'evidence': f"{context_desc.get(echo['context'], '未知上下文')}中{echo['reason']}（回显字符: {', '.join(chars_detail)}）",
                                    'description': f"反射型XSS({context_desc.get(echo['context'], '未知')}上下文)",
                                    'time': core_func.callback_time(0)
                                })
                                break  # 一个参数只报告一次
                            else:
                                # 记录未报漏洞的原因（调试用）
                                context_desc = {'script': 'JS上下文', 'attribute': 'HTML属性上下文', 'body': 'HTML正文上下文'}
                                print(f"    [XSS] {context_desc.get(echo['context'], '未知')}: {echo['reason']}，不报漏洞")
                except Exception as e:
                    continue
        
        return vulnerabilities



if __name__ == "__main__":
    # 测试代码
    scanner = XSSScanner()
    
    # 测试HTTP请求
    test_request = {
        "url": "http://127.0.0.1/test631?name=test",
        "method": "POST",
        "headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        "body": "aa=1&bb=a"
    }
    
    print("XSS扫描器测试")
    print(f"HTTP请求: {test_request}")
    print("\n开始扫描...")
    
    # 执行扫描（自动提取参数）
    results = scanner.scan(test_request)
    
    print(f"\n发现 {len(results)} 个漏洞:")
    for vuln in results:
        print(f"  [{vuln['vuln_type']}] {vuln['param']} - {vuln['payload']}")
        print(f"    位置: {vuln['position']}")
        print(f"    证据: {vuln['evidence']}")
