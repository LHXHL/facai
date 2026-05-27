var TabManager = {
    tabs: [],
    activeTab: null,
    _containerMap: {},  // tabId -> jQuery DOM 容器（持久化，切换不销毁）
    _syncingNav: false, // 防止 _syncNav 和 hashchange 循环触发

    init: function() {
        this.bindEvents();
    },

    bindEvents: function() {
        var self = this;
        $(document).on('click', '.tab-item', function() {
            var tabId = $(this).data('tab-id');
            self.activateTab(tabId);
        });

        $(document).on('click', '.tab-close', function(e) {
            e.stopPropagation();
            var tabId = $(this).parent().data('tab-id');
            self.closeTab(tabId);
        });

        var _dragTabId = null;

        $(document).on('dragstart', '.tab-item', function(e) {
            _dragTabId = $(this).data('tab-id');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            e.originalEvent.dataTransfer.setData('text/plain', _dragTabId);
            $(this).addClass('dragging');
        });

        $(document).on('dragend', '.tab-item', function() {
            $(this).removeClass('dragging');
            $('.tab-item').removeClass('drag-over');
            _dragTabId = null;
        });

        $(document).on('dragover', '.tab-item', function(e) {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'move';
            var $target = $(this);
            if (!$target.hasClass('dragging')) {
                $target.addClass('drag-over');
            }
        });

        $(document).on('dragleave', '.tab-item', function() {
            $(this).removeClass('drag-over');
        });

        $(document).on('drop', '.tab-item', function(e) {
            e.preventDefault();
            $('.tab-item').removeClass('drag-over');
            var targetTabId = $(this).data('tab-id');
            if (!_dragTabId || _dragTabId === targetTabId) return;

            var fromIdx = self.tabs.findIndex(function(t) { return t.id === _dragTabId; });
            var toIdx = self.tabs.findIndex(function(t) { return t.id === targetTabId; });
            if (fromIdx === -1 || toIdx === -1) return;

            var moved = self.tabs.splice(fromIdx, 1)[0];
            self.tabs.splice(toIdx, 0, moved);
            self.renderTabs();
        });
    },

    openTab: function(module, title, data) {
        // 检查是否已存在相同模块的tab
        var existingTab = this.tabs.find(function(tab) {
            return tab.module === module;
        });
        
        if (existingTab) {
            var hasNewData = data && (data.initialData || data.forceRender);
            if (hasNewData) {
                existingTab.data = data;
                var $container = this._containerMap[existingTab.id];
                if ($container) {
                    if (window.__replayInstance && window.__replayInstance._uiReady) {
                        window.__replayInstance.saveCurrentTab();
                        window.__replayInstance.saveToStorage();
                    }
                    $container.empty();
                    $container.css({ padding: '', overflow: '' });
                    var parts = existingTab.module.split('/');
                    var moduleName = parts[0];
                    var mod = FacaiCore.modules[moduleName];
                    if (mod && mod.render) {
                        mod.render(existingTab.data, $container);
                    }
                }
            }
            this.activateTab(existingTab.id);
            return existingTab.id;
        }
        
        // 不存在则创建新tab
        var tabId = module + '_' + Date.now();
        var tab = {
            id: tabId,
            module: module,
            title: title,
            data: data || {}
        };
        this.tabs.push(tab);

        // 为该 tab 创建独立的持久化 DOM 容器（挂到 .tab-content 下，初始隐藏）
        var $container = $('<div class="tab-pane" data-tab-id="' + tabId + '"></div>');
        $container.hide();
        $('.tab-content').append($container);
        this._containerMap[tabId] = $container;

        // 首次渲染内容到独立容器
        var parts = module.split('/');
        var moduleName = parts[0];
        var mod = FacaiCore.modules[moduleName];
        if (mod && mod.render) {
            mod.render(tab.data, $container);
        }

        this.renderTabs();
        this.activateTab(tabId);
        return tabId;
    },

    activateTab: function(tabId) {
        this.activeTab = tabId;
        this.renderTabs();
        this._switchPane(tabId);
        this._syncNav(tabId);
    },

    closeTab: function(tabId) {
        var index = this.tabs.findIndex(function(tab) {
            return tab.id === tabId;
        });
        if (index > -1) {
            // 销毁该 tab 的 DOM 容器
            var $container = this._containerMap[tabId];
            if ($container) {
                $container.remove();
                delete this._containerMap[tabId];
            }
            this.tabs.splice(index, 1);
            if (this.activeTab === tabId) {
                this.activeTab = this.tabs.length > 0 ? this.tabs[this.tabs.length - 1].id : null;
            }
            this.renderTabs();
            this._switchPane(this.activeTab);
            this._syncNav(this.activeTab);
        }
    },

    refreshCurrentTab: function() {
        if (this.activeTab) {
            var $container = this._containerMap[this.activeTab];
            if ($container) {
                $container.empty();
                $container.css({ padding: '', overflow: '' });
                var tab = this.tabs.find(function(t) { return t.id === this.activeTab; }.bind(this));
                if (tab) {
                    var parts = tab.module.split('/');
                    var moduleName = parts[0];
                    var mod = FacaiCore.modules[moduleName];
                    if (mod && mod.render) {
                        mod.render(tab.data, $container);
                    }
                }
            }
        }
    },

    renderTabs: function() {
        var self = this;
        var tabList = $('.tab-list');
        tabList.empty();
        
        // 创建 tab 项容器
        var $wrapper = $('<div class="tab-items-wrapper"></div>');
        this.tabs.forEach(function(tab) {
            var activeClass = tab.id === self.activeTab ? 'active' : '';
            $wrapper.append('<div class="tab-item ' + activeClass + '" data-tab-id="' + tab.id + '" draggable="true">' +
                '<span>' + tab.title + '</span>' +
                '<span class="tab-close">×</span>' +
                '</div>');
        });
        tabList.append($wrapper);
        
        // 追加状态显示到右侧（绝对定位）
        tabList.append('<div class="project-status-display" id="projectStatusDisplay">' +
            '<div class="status-indicator">' +
            '<span class="status-dot" id="statusDot"></span>' +
            '<span class="status-text" id="statusText">加载中...</span>' +
            '</div>' +
            '</div>');
        
        // 渲染完成后，重新加载项目状态
        if (window.FacaiCore) {
            window.FacaiCore.loadProjects();
        }
    },

    /**
     * 切换面板：隐藏所有 tab-pane，显示目标 tab-pane
     * 不销毁 DOM，WebSocket / 定时器 / XHR 等运行状态完整保留
     */
    _switchPane: function(tabId) {
        // 隐藏所有面板
        $('.tab-pane').hide();

        if (tabId) {
            var $container = this._containerMap[tabId];
            if ($container) {
                $container.show();
            }
        }
    },

    /**
     * 同步左侧导航菜单：高亮当前模块、展开父菜单、更新 URL hash
     */
    _syncNav: function(tabId) {
        if (!tabId || this._syncingNav) return;
        this._syncingNav = true;
        try {
            var tab = this.tabs.find(function(t) { return t.id === tabId; });
            if (!tab) return;

            var module = tab.module;  // e.g. "ai-agent/chat" 或 "projects"

            // 更新 URL hash（replaceState 不触发 hashchange 事件）
            var newHash = '#' + module;
            if (window.location.hash !== newHash) {
                window.history.replaceState(null, '', newHash);
            }

            // 清除所有导航高亮
            var $menuItems = $('.menu li');
            $menuItems.removeClass('active');
            $menuItems.find('a').removeClass('active');

            // 找到对应的导航链接
            var $navLink = $('.menu a[data-module="' + module + '"]');

            if ($navLink.length) {
                // 高亮当前链接
                $navLink.addClass('active');

                // 如果在子菜单中，高亮父 li 并展开子菜单
                if ($navLink.closest('.submenu').length) {
                    // 子菜单项：高亮所在 li，展开父菜单
                    $navLink.closest('li').addClass('active');
                    var $parentItem = $navLink.closest('.submenu').parent();
                    $parentItem.addClass('open active');
                    $parentItem.children('a').addClass('active');
                } else {
                    // 顶层菜单项
                    $navLink.closest('li').addClass('active open');
                }
            } else {
                // 模块有子路径（如 "assets/overview"），尝试匹配父级菜单
                var moduleName = module.split('/')[0];
                var $parentLink = $('.menu > ul > li > a[data-module="' + moduleName + '"]');
                if ($parentLink.length) {
                    $parentLink.addClass('active');
                    $parentLink.closest('li').addClass('open active');
                }
            }
        } finally {
            this._syncingNav = false;
        }
    }
};

$(document).ready(function() {
    TabManager.init();
});