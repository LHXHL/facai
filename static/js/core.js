var FacaiCore = {
    currentProject: null,
    modules: {},

    init: function() {
        this.loadProjects();
        this.initModules();
        this.bindEvents();
        this.initModal();

        // 默认打开项目管理页面
        TabManager.openTab('projects', '项目管理', {});

        // 定期刷新项目状态（每5秒）
        var self = this;
        setInterval(function() {
            self.loadProjects();
        }, 5000);
    },

    loadProjects: function() {
        var self = this;
        $.ajax({
            url: '/api/projects/list',
            type: 'GET',
            success: function(data) {
                self.updateProjectStatus(data);
            },
            error: function() {
                self.updateProjectStatus({ error: true, projects: [] });
            }
        });
    },

    initModules: function() {
        this.modules.projects = new ProjectsModule();
        this.modules.services = new ServicesModule();
        this.modules.scaner = new ScanerModule();
        this.modules.traffic = new TrafficModule();
        this.modules.capture = new CaptureModule();
        this.modules.assets = new AssetsModule();
        this.modules.tools = new ToolsModule();
        this.modules.system = new SystemModule();
    },

    bindEvents: function() {
        var self = this;

        // 侧边栏菜单点击展开/收起
        $(document).on('click', '.menu > ul > li > a', function(e) {
            var parentLi = $(this).parent();
            var submenu = parentLi.find('.submenu');

            // 如果有子菜单，切换展开状态
            if (submenu.length > 0) {
                e.preventDefault();
                parentLi.toggleClass('open');
            }
        });

        // 刷新/关闭页面时提醒（有正在运行的任务时）
        window.addEventListener('beforeunload', function(e) {
            var hasRunningTask = false;
            // 检查是否有正在运行的项目
            if (self.currentProject) {
                hasRunningTask = true;
            }
            // 只要打开了 tab 就提醒（刷新会丢失所有页面状态）
            if (typeof TabManager !== 'undefined' && TabManager.tabs && TabManager.tabs.length > 0) {
                hasRunningTask = true;
            }

            if (hasRunningTask) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    },

    updateProjectStatus: function(data) {
        var statusDot = $('#statusDot');
        var statusText = $('#statusText');

        // 清除所有状态类
        statusDot.removeClass('running idle error');

        if (data.error) {
            statusDot.addClass('error');
            statusText.text('项目状态加载失败');
            return;
        }

        if (data.projects && data.projects.length > 0) {
            // 找到正在运行的项目（status_code === 1）
            var runningProject = data.projects.find(function(project) {
                return project.status_code === 1;
            });

            if (runningProject) {
                statusDot.addClass('running');
                statusText.text('运行中: ' + runningProject.Project);
                this.currentProject = runningProject.Project;
            } else {
                statusDot.addClass('idle');
                statusText.text('未运行项目');
                this.currentProject = null;
            }
        } else {
            statusDot.addClass('idle');
            statusText.text('未运行项目');
            this.currentProject = null;
        }
    },

    // Modal 模态框管理
    Modal: {
        show: function(modalId) {
            var modal = $('#' + modalId);
            modal.css('display', 'flex');
            modal.css('justify-content', 'center');
            modal.css('align-items', 'center');
            $('body').css('overflow', 'hidden');
        },

        hide: function(modalId) {
            var modal = $('#' + modalId);
            modal.css('display', 'none');
            modal.css('justify-content', '');
            modal.css('align-items', '');
            $('body').css('overflow', '');
            modal.trigger('close');
        },

        close: function(modalId) {
            this.hide(modalId);
        }
    },

    initModal: function() {
        var self = this;

        // 点击关闭按钮
        $(document).on('click', '.modal-close, .close', function() {
            var modal = $(this).closest('.modal-overlay');
            self.Modal.hide(modal.attr('id'));
        });

        // 点击遮罩层关闭
        $(document).on('click', '.modal-overlay', function(e) {
            if (e.target === this) {
                self.Modal.hide($(this).attr('id'));
            }
        });

        // ESC键关闭
        $(document).on('keydown', function(e) {
            if (e.key === 'Escape') {
                var modal = $('.modal-overlay[style*="display: flex"]');
                if (modal.length > 0) {
                    self.Modal.hide(modal.attr('id'));
                }
            }
        });
    }
};

$(document).ready(function() {
    FacaiCore.init();
});