var HashManager = {
    _initialized: false,

    init: function() {
        this.bindEvents();
        // 首次通过 hashchange 事件触发，不再手动调用避免重复
        // 浏览器在页面加载时会自动触发 hashchange（仅当有 hash 时）
        // 若无 hash，hashchange 不会触发，需等待后续导航
    },

    bindEvents: function() {
        var self = this;
        $(window).on('hashchange', function() {
            self.handleHashChange();
        });

        // 页面加载时：处理无 hash 的情况（默认加载 projects）
        $(document).ready(function() {
            if (!self._initialized) {
                self._initialized = true;
                var hash = window.location.hash.substring(1);
                if (!hash) {
                    self.handleHashChange();
                }
                // 若有 hash，浏览器的 hashchange 事件会处理，无需重复调用
            }
        });
    },

    handleHashChange: function() {
        var hash = window.location.hash.substring(1);
        if (!hash) {
            hash = 'projects';
        }
        this.loadModule(hash);
    },

    loadModule: function(hash) {
        var parts = hash.split('/');
        var moduleName = parts[0];
        var subModule = parts[1];

        var moduleMap = {
            'projects': { name: '项目管理', module: 'projects' },
            'services': { name: '服务管理', module: 'services' },
            'traffic': { name: 'HTTP流量', module: 'traffic' },
            'capture': { name: 'HTTP捕捉', module: 'capture' },
            'assets': { name: '资产管理', module: 'assets', hasSubmenu: true },
            'tools': { name: '工具与插件', module: 'tools', hasSubmenu: true },
            'spider': { name: '爬虫管理', module: 'spider', hasSubmenu: true },
            'ai-agent': { name: 'AI Agent', module: 'ai-agent', hasSubmenu: true },
            'scaner': { name: '漏洞扫描管理', module: 'scaner', hasSubmenu: true },
            'system': { name: '系统配置', module: 'system' }
        };

        // 子模块中文名称映射
        var subModuleNames = {
            'spider/config': '爬虫配置',
            'spider/cdp': 'CDP管理',
            'spider/sites': '站点信息总览',
            'spider/forms': '表单信息编辑',
            'assets/overview': '资产总览',
            'assets/config': '资产管理配置',
            'assets/subdomains': '子域名管理',
            'assets/websites': '网站管理',
            'assets/http': 'HTTP请求响应管理',
            'assets/html': 'HTML大文件管理',
            'assets/ip-cidr': 'IP C段资产',
            'assets/ip': 'IP资产',
            'assets/highlights': '重点资产管理',
            'tools/replay': 'HTTP请求重放',
            'tools/encode-decode': '编码解码',
            'tools/port-scan': '端口扫描',
            'ai-agent/chat': 'Chat',
            'ai-agent/audit': '代码审计',
            'ai-agent/mcp': 'MCP管理',
            'ai-agent/skills': 'Skills管理',
            'ai-agent/website-check': '站点安全审计',
            'ai-agent/client-check': '客户端安全审计',
            'scaner/overview': '扫描概览',
            'scaner/config': '漏洞扫描设置',
            'scaner/manual': '手动模式',
            'scaner/results': '扫描结果',
            'scaner/logs': '盲打日志'
        };

        if (moduleMap[moduleName]) {
            var moduleInfo = moduleMap[moduleName];
            
            // 如果模块有子菜单且没有指定子模块，则只展开菜单，不打开tab
            if (moduleInfo.hasSubmenu && !subModule) {
                // 只展开菜单
                var $menuItem = $('.menu a[href="#' + moduleName + '"]').parent();
                if ($menuItem.length && !$menuItem.hasClass('open')) {
                    $menuItem.addClass('open');
                }
                return;
            }
            
            // 打开tab
            if (subModule) {
                var fullModule = moduleInfo.module + '/' + subModule;
                var tabName = subModuleNames[fullModule] || moduleInfo.name + ' - ' + subModule;
                TabManager.openTab(fullModule, tabName, { subModule: subModule });
            } else {
                TabManager.openTab(moduleInfo.module, moduleInfo.name, {});
            }
        }
    }
};

$(document).ready(function() {
    HashManager.init();
});