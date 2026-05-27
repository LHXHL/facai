# coding: utf-8
"""
CDP 服务层（基于 Playwright，持久连接）
@Time :    4/25/2026
@Author:  facai

【重要说明】
本文件与 browser_cdp.py 是完全独立的两个模块，用于不同场景：

- browser_cdp.py：使用无头Chrome（headless）进行自动化资产收集
- spider_cdp.py：控制有界面Chrome实例，供"手动测试"和"自动测试"共用同一个Chrome

使用场景：
- 用户可以手动在Chrome中操作登录、填写表单等
- 同时程序也可以控制这个Chrome进行自动化操作
- 两者共享同一个Chrome实例和浏览器上下文

设计：
- 后台事件循环 + 缓存 browser 实例，避免每次重连
- get_tabs 用 HTTP /json 端点（快，不需要 Playwright）
- collect/scroll/fill 通过缓存的 Playwright 连接操作页面
"""

import asyncio
import socket
import threading
import urllib.request
import json
from service.Class_Core_Function import Class_Core_Function
from playwright.async_api import async_playwright


# ========== 后台事件循环（单例，daemon 线程） ==========

_event_loop = None


def _get_event_loop():
    global _event_loop
    if _event_loop is None or _event_loop.is_closed():
        _event_loop = asyncio.new_event_loop()
        t = threading.Thread(target=_event_loop.run_forever, daemon=True)
        t.start()
    return _event_loop


def _run_async(coro, timeout=60):
    """在后台事件循环中运行协程并等待结果"""
    loop = _get_event_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


# ========== 公共 JavaScript 收集函数 ==========

_JS_COLLECT_PAGE_INFO = r"""
(function() {
    var result = {
        title: document.title,
        url: window.location.href,
        links: [],
        scripts: [],
        forms: [],
        iframes: [],
        stylesheets: [],
        images: [],
        tags: [],
        meta: {}
    };

    // 收集 meta 信息
    var metaTags = document.getElementsByTagName('meta');
    for (var i = 0; i < metaTags.length; i++) {
        var meta = metaTags[i];
        var name = meta.name || meta.getAttribute('property') || '';
        var content = meta.content || '';
        if (name === 'description' || name === 'keywords') {
            result.meta[name] = content;
        }
    }

    // 收集链接
    var aTags = document.getElementsByTagName('a');
    for (var i = 0; i < aTags.length; i++) {
        var href = aTags[i].href;
        if (href && href.indexOf('http') === 0) result.links.push(href);
    }

    // 收集 JS 文件
    var scriptTags = document.getElementsByTagName('script');
    for (var i = 0; i < scriptTags.length; i++) {
        if (scriptTags[i].src) result.scripts.push(scriptTags[i].src);
    }

    // 收集样式表
    var linkTags = document.getElementsByTagName('link');
    for (var i = 0; i < linkTags.length; i++) {
        if (linkTags[i].rel === 'stylesheet' && linkTags[i].href) {
            result.stylesheets.push(linkTags[i].href);
        }
    }

    // 收集图片
    var imgTags = document.getElementsByTagName('img');
    for (var i = 0; i < imgTags.length; i++) {
        if (imgTags[i].src) result.images.push(imgTags[i].src);
    }

    // 收集表单
    var formTags = document.getElementsByTagName('form');
    for (var i = 0; i < formTags.length; i++) {
        var form = formTags[i];
        var formInfo = {
            action: form.action,
            method: form.method || 'get',
            inputs: [],
            buttons: []
        };
        var inputs = form.getElementsByTagName('input');
        for (var j = 0; j < inputs.length; j++) {
            formInfo.inputs.push({
                name: inputs[j].name || '',
                type: inputs[j].type || 'text',
                id: inputs[j].id || '',
                placeholder: inputs[j].placeholder || ''
            });
        }
        var buttons = form.getElementsByTagName('button');
        for (var k = 0; k < buttons.length; k++) {
            formInfo.buttons.push({
                type: buttons[k].type || 'submit',
                text: buttons[k].textContent || ''
            });
        }
        result.forms.push(formInfo);
    }

    // 收集 iframe
    var iframeTags = document.getElementsByTagName('iframe');
    for (var i = 0; i < iframeTags.length; i++) {
        result.iframes.push({
            src: iframeTags[i].src || '',
            srcdoc: iframeTags[i].srcdoc ? '[inline html]' : ''
        });
    }

    // 去重（使用 Set 自动去重）
    result.links = [...new Set(result.links)];
    result.scripts = [...new Set(result.scripts)];
    result.stylesheets = [...new Set(result.stylesheets)];
    result.images = [...new Set(result.images)];

    // 检测页面标签
    var allInputs = document.querySelectorAll('input, textarea, select');
    var allTextareas = document.getElementsByTagName('textarea');
    var hasForm = false, hasPassword = false, hasFileUpload = false, hasSearch = false, hasLogin = false;

    for (var m = 0; m < allInputs.length; m++) {
        var inputType = (allInputs[m].type || 'text').toLowerCase();
        var name = (allInputs[m].name || allInputs[m].id || '').toLowerCase();
        var placeholder = (allInputs[m].placeholder || '').toLowerCase();

        if (inputType === 'password') hasPassword = true;
        if (inputType === 'file') hasFileUpload = true;
        if (inputType === 'search' || name.indexOf('search') !== -1 || placeholder.indexOf('搜索') !== -1) hasSearch = true;
    }

    if (allInputs.length > 0 || allTextareas.length > 0) hasForm = true;

    // 检测登录特征
    var hasUsernameField = false;
    for (var n = 0; n < allInputs.length; n++) {
        var nm = (allInputs[n].name || allInputs[n].id || allInputs[n].placeholder || '').toLowerCase();
        if (nm.indexOf('user') !== -1 || nm.indexOf('account') !== -1 || nm.indexOf('email') !== -1 || nm.indexOf('phone') !== -1) {
            hasUsernameField = true;
            break;
        }
    }
    hasLogin = hasPassword && hasUsernameField;

    // 添加标签
    if (hasForm) result.tags.push('表单');
    if (hasPassword) result.tags.push('密码字段');
    if (hasFileUpload) result.tags.push('文件上传');
    if (hasSearch) result.tags.push('搜索');
    if (hasLogin) result.tags.push('登录');
    if (document.querySelector('[type="number"]')) result.tags.push('数字输入');
    if (result.iframes.length > 0) result.tags.push('内嵌页面');
    if (document.querySelector('video, audio')) result.tags.push('多媒体');

    return result;
})();
"""





class SpiderCDP:
    """CDP 服务层，封装 Playwright CDP 操作（持久连接）"""

    def __init__(self):
        self.Core_Function = Class_Core_Function()
        self._playwright = None
        self._browser = None

    def _get_cdp_port(self):
        try:
            config = self.Core_Function.callback_config()
            if config and 'chrome_spider_cdp_port' in config:
                return config['chrome_spider_cdp_port']
        except:
            pass
        return 19228

    def _check_port_open(self, host='127.0.0.1', port=None, timeout=2):
        port = port or self._get_cdp_port()
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                return s.connect_ex((host, port)) == 0
        except:
            return False

    # ========== 持久连接管理 ==========

    async def _ensure_browser(self):
        """确保 Playwright browser 连接存在且可用"""
        # 检查已有连接
        if self._browser is not None:
            try:
                if self._browser.is_connected():
                    return self._browser
            except:
                pass
            # 连接已断开，清理
            try:
                await self._browser.close()
            except:
                pass
            self._browser = None

        # 新建连接
        if self._playwright is None:
            self._playwright = await async_playwright().start()

        cdp_port = self._get_cdp_port()
        self._browser = await self._playwright.chromium.connect_over_cdp(
            endpoint_url=f"http://127.0.0.1:{cdp_port}",
            timeout=10000
        )
        return self._browser

    async def _get_page_by_url(self, url):
        """根据 URL 查找已打开的 page，找不到返回 None"""
        browser = await self._ensure_browser()
        for ctx in browser.contexts:
            for page in ctx.pages:
                try:
                    if page.url == url:
                        return page
                except:
                    pass
        return None

    # ========== 获取 Tab 列表（HTTP /json，快速） ==========

    def get_tabs(self):
        cdp_port = self._get_cdp_port()
        if not self._check_port_open('127.0.0.1', cdp_port):
            return {
                'success': False,
                'message': f'Chrome CDP 未连接（端口 {cdp_port} 未开放），请先启动 Chrome',
                'tabs': [],
                'cdp_port': cdp_port
            }
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json', timeout=5) as resp:
                targets = json.loads(resp.read().decode())
            tabs = []
            for t in targets:
                tabs.append({
                    'id': t.get('id', ''),
                    'title': t.get('title', '无标题'),
                    'url': t.get('url', ''),
                    'type': t.get('type', 'page'),
                    'webSocketDebuggerUrl': t.get('webSocketDebuggerUrl', '')
                })
            return {'success': True, 'tabs': tabs, 'cdp_port': cdp_port}
        except Exception as e:
            return {'success': False, 'message': f'连接 CDP 失败: {str(e)}', 'tabs': [], 'cdp_port': cdp_port}

    # ========== 收集页面信息 ==========

    async def _collect_page_info_async(self, tab_url):
        page = await self._get_page_by_url(tab_url)
        if not page:
            return {'success': False, 'message': f'未找到对应的页面: {tab_url}'}

        info = await page.evaluate(_JS_COLLECT_PAGE_INFO)

        return {'success': True, 'data': info}

    def collect_page_info(self, tab_url):
        try:
            return _run_async(self._collect_page_info_async(tab_url), timeout=30)
        except Exception as e:
            return {'success': False, 'message': f'收集页面信息异常: {str(e)}'}

    # ========== 批量收集多个 Tab ==========

    async def _collect_batch_async(self, tab_urls):
        all_info = {'links': [], 'scripts': [], 'forms': [], 'iframes': [], 'stylesheets': [], 'images': []}
        page_tags = {}  # url -> [tags]
        browser = await self._ensure_browser()

        for tab_url in tab_urls:
            page = None
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    try:
                        if pg.url == tab_url:
                            page = pg
                            break
                    except:
                        pass
                if page:
                    break
            if not page:
                continue

            try:
                info = await page.evaluate(_JS_COLLECT_PAGE_INFO)
                all_info['links'].extend(info.get('links', []))
                all_info['scripts'].extend(info.get('scripts', []))
                all_info['forms'].extend(info.get('forms', []))
                all_info['iframes'].extend([x.get('src', '') if isinstance(x, dict) else x for x in info.get('iframes', [])])
                all_info['stylesheets'].extend(info.get('stylesheets', []))
                all_info['images'].extend(info.get('images', []))
                tags = info.get('tags', [])
                if tags:
                    page_tags[tab_url] = tags
            except Exception as e:
                self.Core_Function.callback_logging().error(f'收集页面信息失败: {tab_url}, {str(e)}')

        # 去重
        all_info['links'] = list(set(all_info['links']))
        all_info['scripts'] = list(set(all_info['scripts']))
        all_info['iframes'] = list(set(all_info['iframes']))
        all_info['stylesheets'] = list(set(all_info['stylesheets']))
        all_info['images'] = list(set(all_info['images']))
        return {
            'success': True,
            'data': all_info,
            'page_tags': page_tags,
            'stats': {
                'link_count': len(all_info['links']),
                'script_count': len(all_info['scripts']),
                'form_count': len(all_info['forms']),
                'iframe_count': len(all_info['iframes']),
                'stylesheet_count': len(all_info['stylesheets']),
                'image_count': len(all_info['images'])
            }
        }

    def collect_batch(self, tab_urls):
        try:
            return _run_async(self._collect_batch_async(tab_urls), timeout=60)
        except Exception as e:
            return {'success': False, 'message': f'批量收集异常: {str(e)}'}

    # ========== 滚动页面 ==========

    async def _scroll_pages_async(self, tab_urls, max_scrolls=10):
        browser = await self._ensure_browser()
        results = []

        for tab_url in tab_urls:
            page = None
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    try:
                        if pg.url == tab_url:
                            page = pg
                            break
                    except:
                        pass
                if page:
                    break

            if not page:
                results.append({'url': tab_url, 'success': False, 'message': '未找到页面'})
                continue

            try:
                scroll_result = await page.evaluate("""(maxScrolls) => {
                    var count = 0;
                    var lastHeight = document.body.scrollHeight;
                    return new Promise(function(resolve) {
                        function doScroll() {
                            window.scrollTo(0, document.body.scrollHeight);
                            count++;
                            var newHeight = document.body.scrollHeight;
                            if (count >= maxScrolls || newHeight === lastHeight) {
                                resolve({scrolls: count, finalHeight: newHeight});
                            } else {
                                lastHeight = newHeight;
                                setTimeout(doScroll, 800);
                            }
                        }
                        doScroll();
                    });
                }""", max_scrolls)

                results.append({
                    'url': tab_url,
                    'success': True,
                    'scrolls': scroll_result.get('scrolls', 0),
                    'finalHeight': scroll_result.get('finalHeight', 0)
                })
            except Exception as e:
                results.append({'url': tab_url, 'success': False, 'message': str(e)})

        return {'success': True, 'results': results}

    def scroll_pages(self, tab_urls, max_scrolls=10):
        try:
            return _run_async(self._scroll_pages_async(tab_urls, max_scrolls), timeout=60)
        except Exception as e:
            return {'success': False, 'message': f'滚动异常: {str(e)}'}

    # ========== 自动填表 ==========

    async def _fill_forms_async(self, tab_urls, personal_info):
        browser = await self._ensure_browser()
        results = []

        for tab_url in tab_urls:
            page = None
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    try:
                        if pg.url == tab_url:
                            page = pg
                            break
                    except:
                        pass
                if page:
                    break

            if not page:
                results.append({'url': tab_url, 'success': False, 'message': '未找到页面'})
                continue

            try:
                filled = await page.evaluate("""(info) => {
                    var count = 0;
                    var inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], input:not([type])');
                    for (var i = 0; i < inputs.length; i++) {
                        var input = inputs[i];
                        var name = (input.name || input.id || input.placeholder || '').toLowerCase();
                        var value = '';
                        for (var key in info) {
                            if (name.indexOf(key.toLowerCase()) !== -1 || key.toLowerCase().indexOf(name) !== -1) {
                                value = info[key];
                                break;
                            }
                        }
                        if (value) {
                            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                            nativeInputValueSetter.call(input, value);
                            input.dispatchEvent(new Event('input', {bubbles: true}));
                            input.dispatchEvent(new Event('change', {bubbles: true}));
                            count++;
                        }
                    }
                    return count;
                }""", personal_info)

                results.append({
                    'url': tab_url,
                    'success': True,
                    'filled_count': filled
                })
            except Exception as e:
                results.append({'url': tab_url, 'success': False, 'message': str(e)})

        return {'success': True, 'results': results}

    def fill_forms(self, tab_urls, personal_info):
        try:
            return _run_async(self._fill_forms_async(tab_urls, personal_info), timeout=30)
        except Exception as e:
            return {'success': False, 'message': f'填表异常: {str(e)}'}

    # ========== 打开新Tab并爬取 ==========

    async def _open_tab_and_crawl_async(self, url, timeout=30):
        """打开新Tab并爬取页面信息（在现有Chrome中创建新Tab）
        
        Args:
            url: 要打开的URL
            
        Returns:
            dict: 包含爬取结果的字典
        """
        try:
            browser = await self._ensure_browser()
            
            # 在现有浏览器上下文中创建新Tab（不用 browser.new_page()，否则会创建新上下文=新窗口）
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = await context.new_page()
            
            try:
                # 注入反检测脚本
                await page.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {get: () => false});
                    window.open = function(url) { location.href = url; };
                """)
                
                # 导航到目标URL
                await page.goto(url, timeout=timeout * 1000, wait_until='networkidle')
                
                # 收集页面信息
                info = await page.evaluate(_JS_COLLECT_PAGE_INFO)

                return {
                    'success': True,
                    'url': url,
                    'final_url': page.url,
                    'data': info
                }

            finally:
                # 检查当前Tab数量，如果只剩1个Tab则保留不关闭，避免关闭整个Chrome
                try:
                    context = page.context
                    tabs = context.pages
                    if len(tabs) > 1:
                        await page.close()
                    else:
                        # 只保留1个Tab，跳转到空白页
                        await page.goto('about:blank', timeout=5000)
                except:
                    # 忽略关闭错误
                    pass

        except Exception as e:
            return {
                'success': False,
                'url': url,
                'message': str(e)
            }

    def open_tab_and_crawl(self, url, timeout=30):
        """同步版本：打开新Tab并爬取页面信息"""
        try:
            return _run_async(self._open_tab_and_crawl_async(url, timeout), timeout=timeout + 10)
        except Exception as e:
            return {'success': False, 'url': url, 'message': f'打开Tab爬取异常: {str(e)}'}

    # ========== 批量打开新Tab并爬取 ==========

    async def _crawl_urls_async(self, urls, max_concurrent=5, timeout_per_page=30, 
                                  progress_callback=None, pause_check_callback=None):
        """批量打开新Tab并爬取页面信息
        
        Args:
            urls: URL列表
            max_concurrent: 最大并发数，默认5
            timeout_per_page: 每个页面超时时间，默认30秒
            progress_callback: 进度回调函数，签名为 (url, success, error_msg) -> None
            pause_check_callback: 暂停检查回调函数，签名为 () -> bool，返回True表示已暂停
            
        Returns:
            dict: 包含所有爬取结果的字典
        """
        results = []
        all_links = []
        all_scripts = []
        all_forms = []
        all_iframes = []
        all_stylesheets = []
        all_images = []
        page_tags = {}
        paused = False

        # 分批处理，每批最多 max_concurrent 个
        for i in range(0, len(urls), max_concurrent):
            # 检查是否暂停
            if pause_check_callback and pause_check_callback():
                paused = True
                break
            
            batch = urls[i:i + max_concurrent]
            batch_tasks = []
            batch_urls = []

            for url in batch:
                if url and isinstance(url, str):
                    task = self._open_tab_and_crawl_async(url, timeout_per_page)
                    batch_tasks.append(task)
                    batch_urls.append(url)

            if batch_tasks:
                batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

                for idx, result in enumerate(batch_results):
                    # 检查是否暂停
                    if pause_check_callback and pause_check_callback():
                        paused = True
                    
                    if isinstance(result, Exception):
                        results.append({'success': False, 'message': str(result)})
                        # 回调：URL爬取失败
                        if progress_callback and idx < len(batch_urls):
                            progress_callback(batch_urls[idx], False, str(result))
                        continue

                    results.append(result)
                    # 回调：URL爬取成功或失败
                    if progress_callback and idx < len(batch_urls):
                        success = result.get('success', False)
                        error_msg = result.get('message', '') if not success else ''
                        progress_callback(batch_urls[idx], success, error_msg)

                    if result.get('success') and result.get('data'):
                        info = result['data']
                        all_links.extend(info.get('links', []))
                        all_scripts.extend(info.get('scripts', []))
                        all_forms.extend(info.get('forms', []))
                        all_iframes.extend([x.get('src', '') if isinstance(x, dict) else x for x in info.get('iframes', [])])
                        all_stylesheets.extend(info.get('stylesheets', []))
                        all_images.extend(info.get('images', []))

                        # 记录页面标签
                        tags = info.get('tags', [])
                        if tags:
                            page_tags[result['final_url'] or result['url']] = tags

            # 批次间短暂休眠，让出控制权以便检查暂停
            await asyncio.sleep(0.1)

        # 去重
        all_links = list(set(all_links))
        all_scripts = list(set(all_scripts))
        all_iframes = list(set(all_iframes))
        all_stylesheets = list(set(all_stylesheets))
        all_images = list(set(all_images))

        return {
            'success': True,
            'paused': paused,
            'results': results,
            'data': {
                'links': all_links,
                'scripts': all_scripts,
                'forms': all_forms,
                'iframes': all_iframes,
                'stylesheets': all_stylesheets,
                'images': all_images
            },
            'page_tags': page_tags,
            'stats': {
                'total': len(urls),
                'success': sum(1 for r in results if r.get('success')),
                'failed': sum(1 for r in results if not r.get('success')),
                'link_count': len(all_links),
                'script_count': len(all_scripts),
                'form_count': len(all_forms),
                'iframe_count': len(all_iframes),
                'stylesheet_count': len(all_stylesheets),
                'image_count': len(all_images)
            }
        }

    def crawl_urls(self, urls, max_concurrent=5, timeout_per_page=30, 
                   progress_callback=None, pause_check_callback=None):
        """同步版本：批量打开新Tab并爬取页面信息"""
        try:
            return _run_async(
                self._crawl_urls_async(urls, max_concurrent, timeout_per_page, 
                                        progress_callback, pause_check_callback),
                timeout=len(urls) * (timeout_per_page + 10) // max_concurrent + 60
            )
        except Exception as e:
            return {'success': False, 'message': f'批量爬取异常: {str(e)}'}
