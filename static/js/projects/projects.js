function ProjectsModule() {
    this._currentMode = 'form';  // 当前编辑模式: 'form' | 'json'
    this._editingProject = null;  // 当前编辑的项目名（null=新增）
    this._savedJson = null;       // 切换模式时保存的原始 JSON 数据

    // ========== 渲染入口 ==========

    this.render = function(data, container) {
        container.html(`
            <div class="card">
                <div class="card-header">
                    <div class="row">
                        <div class="col-md-6">
                            项目管理
                        </div>
                        <div class="col-md-6 text-right">
                            <span id="projectCount" class="mr-3"></span>
                            <span id="runningStatus" class="mr-3"></span>
                            <button class="btn btn-primary" id="addProject">添加项目</button>
                        </div>
                    </div>
                </div>
                <div class="form-group p-3">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>项目名称</th>
                                <th>描述</th>
                                <th>状态</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="projectList"></tbody>
                    </table>
                </div>
            </div>
        `);
        this.loadProjects();
        this.loadProjectStatus();
        this.bindEvents();
    };

    // ========== 加载项目列表 ==========

    this.loadProjects = function() {
        var self = this;
        $.ajax({
            url: '/api/projects/list',
            type: 'GET',
            success: function(data) {
                var tbody = $('#projectList');
                tbody.empty();
                if (data.projects && data.projects.length > 0) {
                    data.projects.forEach(function(project) {
                        var statusText = project.status_code === 1 ? '运行中' : '未运行';
                        var statusClass = project.status_code === 1 ? 'text-success' : 'text-muted';
                        var startButton = project.status_code === 1
                            ? `<button class="btn btn-warning btn-sm stop-project" data-project="${project.Project}">停止</button>`
                            : `<button class="btn btn-success btn-sm start-project" data-project="${project.Project}">启动</button>`;
                        tbody.append(`
                            <tr>
                                <td>${self._escapeHtml(project.Project)}</td>
                                <td>${self._escapeHtml(project.Description || '')}</td>
                                <td class="${statusClass}">${statusText}</td>
                                <td>${project.created_at || ''}</td>
                                <td>
                                    ${startButton}
                                    <button class="btn btn-primary btn-sm edit-project" data-project="${project.Project}">编辑</button>
                                    <button class="btn btn-danger btn-sm delete-project" data-project="${project.Project}">删除</button>
                                </td>
                            </tr>
                        `);
                    });
                } else {
                    tbody.append('<tr><td colspan="5" class="text-center text-muted">暂无项目，点击「添加项目」创建</td></tr>');
                }
            }
        });
    };

    this.loadProjectStatus = function() {
        var self = this;
        $.ajax({
            url: '/api/projects/count',
            type: 'GET',
            success: function(data) {
                $('#projectCount').text('项目总数: ' + (data.count || 0));
            }
        });
        $.ajax({
            url: '/api/projects/status',
            type: 'GET',
            success: function(data) {
                if (data.running_project) {
                    $('#runningStatus').html('<span class="text-success">运行中: ' + self._escapeHtml(data.running_project.Project) + '</span>');
                } else {
                    $('#runningStatus').html('<span class="text-muted">无运行项目</span>');
                }
            }
        });
    };

    // ========== 事件绑定 ==========

    this.bindEvents = function() {
        var self = this;

        // --- 统一解绑，防止重复绑定 ---
        $(document).off('click', '#addProject');
        $(document).off('click', '.edit-project');
        $(document).off('click', '.delete-project');
        $(document).off('click', '.start-project');
        $(document).off('click', '.stop-project');
        $(document).off('click', '#saveProject');
        $(document).off('click', '#btnFormMode');
        $(document).off('click', '#btnJsonMode');
        $(document).off('change', '#projectJson');
        $(document).off('click', '#addDnsServer');
        $(document).off('click', '.remove-dns-server');
        $(document).off('click', '#formatJson');
        $(document).off('click', '#resetForm');
        $(document).off('hidden.bs.modal', '#projectModal');
        $(document).off('shown.bs.modal', '#projectModal');

        // 添加项目
        $(document).on('click', '#addProject', function() {
            self._editingProject = null;
            self._savedJson = null;
            self._currentMode = 'form';
            self.showProjectModal(null);
        });

        // 编辑项目
        $(document).on('click', '.edit-project', function() {
            var projectName = $(this).data('project');
            self._editingProject = projectName;
            self._savedJson = null;
            self._currentMode = 'form';
            self.showProjectModal(projectName);
        });

        // 删除项目
        $(document).on('click', '.delete-project', function() {
            var projectName = $(this).data('project');
            if (confirm('确定要删除项目「' + projectName + '」吗？')) {
                $.ajax({
                    url: '/api/projects/delete',
                    type: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ Project: projectName }),
                    success: function(data) {
                        alert(data.message || (data.success ? '删除成功' : '删除失败'));
                        if (data.success) {
                            self.loadProjects();
                            self.loadProjectStatus();
                        }
                    },
                    error: function() {
                        alert('删除请求失败，请检查网络');
                    }
                });
            }
        });

        // 启动项目
        $(document).on('click', '.start-project', function() {
            var projectName = $(this).data('project');
            $.ajax({
                url: '/api/projects/start',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ Project: projectName }),
                success: function(data) {
                    alert(data.message || (data.success ? '启动成功' : '启动失败'));
                    if (data.success) {
                        self.loadProjects();
                        self.loadProjectStatus();
                    }
                },
                error: function() {
                    alert('启动请求失败，请检查网络');
                }
            });
        });

        // 停止项目
        $(document).on('click', '.stop-project', function() {
            var projectName = $(this).data('project');
            $.ajax({
                url: '/api/projects/stop',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ Project: projectName }),
                success: function(data) {
                    alert(data.message || (data.success ? '停止成功' : '停止失败'));
                    if (data.success) {
                        self.loadProjects();
                        self.loadProjectStatus();
                    }
                },
                error: function() {
                    alert('停止请求失败，请检查网络');
                }
            });
        });

        // 保存项目
        $(document).on('click', '#saveProject', function() {
            self.saveProject();
        });

        // 切换到表单模式
        $(document).on('click', '#btnFormMode', function() {
            self.switchToFormMode();
        });

        // 切换到 JSON 模式
        $(document).on('click', '#btnJsonMode', function() {
            self.switchToJsonMode();
        });

        // JSON 内容变化时更新表单（实时同步）
        $(document).on('change', '#projectJson', function() {
            self.syncFormFromJson();
        });

        // 格式化 JSON
        $(document).on('click', '#formatJson', function() {
            self.formatJson();
        });

        // 重置表单
        $(document).on('click', '#resetForm', function() {
            self.resetForm();
        });

        // 添加 DNS 服务器
        $(document).on('click', '#addDnsServer', function() {
            $('#projectDnsServers').append(self._dnsServerTemplate());
        });

        // 删除 DNS 服务器
        $(document).on('click', '.remove-dns-server', function() {
            $(this).closest('.dns-server-row').remove();
        });
    };

    // ========== 显示项目模态框 ==========

    this.showProjectModal = function(projectName) {
        var self = this;
        var isEdit = !!projectName;
        var title = isEdit ? '编辑项目' : '添加项目';

        // 防止重复打开：移除已存在的模态框
        $('#projectModal').remove();

        var modalHtml = `
        <div class="modal-overlay" id="projectModal" tabindex="-1" role="dialog">
            <div class="modal-dialog modal-lg" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="关闭">&times;</button>
                    </div>
                    <div class="modal-body">
                        <!-- 编辑模式切换 -->
                        <div class="d-flex justify-content-between align-items-center mb-3 mode-toggle">
                            <label class="mb-0 font-weight-bold">编辑模式</label>
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-primary active" id="btnFormMode">
                                    <i class="fas fa-edit mr-1"></i>表单编辑
                                </button>
                                <button type="button" class="btn btn-outline-secondary" id="btnJsonMode">
                                    <i class="fas fa-code mr-1"></i>JSON编辑
                                </button>
                            </div>
                        </div>
                        <hr>

                        <!-- 表单编辑模式 -->
                        <div id="formMode">
                            <div class="row">
                                <div class="col-md-8">
                                    <div class="form-group">
                                        <label>项目名称 <span class="text-danger">*</span></label>
                                        <input type="text" class="form-control" id="projectName" placeholder="输入项目名称" required>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <div class="form-group">
                                        <label>&nbsp;</label>
                                        <div class="mt-1">
                                            <button type="button" class="btn btn-outline-secondary btn-sm" id="resetForm" title="重置为初始值">
                                                <i class="fas fa-undo mr-1"></i>重置
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="form-group">
                                <label>描述</label>
                                <input type="text" class="form-control" id="projectDescription" placeholder="项目描述（可选）">
                            </div>

                            <div class="form-group">
                                <label>域名列表（每行一个）</label>
                                <textarea class="form-control" id="projectDomains" rows="4" placeholder="https://www.example.com"></textarea>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>端口目标</label>
                                        <input type="text" class="form-control" id="projectPorts"
                                            value="21,22,80-89,443,1080,1433,1521,3000,3306,3389,5432,5900,6379,7001,8000,8069,8080-8099,8161,8888,9080,9081,9090,9200,9300,10000-10002,11211,11434,27016-27018,36000,50000,50070">
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>超时时间（秒）</label>
                                        <input type="number" class="form-control" id="projectTimeout" value="8" min="1" max="120">
                                    </div>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>浏览器线程</label>
                                        <input type="number" class="form-control" id="projectBrowserThread" value="10" min="1" max="100">
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>HTTP线程</label>
                                        <input type="number" class="form-control" id="projectHttpThread" value="10" min="1" max="100">
                                    </div>
                                </div>
                            </div>

                            <div class="form-group">
                                <label>文件类型（每行一个）</label>
                                <textarea class="form-control" id="projectFileTypes" rows="3" placeholder=".html&#10;.js&#10;.css&#10;.json"></textarea>
                            </div>

                            <div class="form-group">
                                <label>禁用文件类型（每行一个）</label>
                                <textarea class="form-control" id="projectDisallowedFileTypes" rows="3" placeholder=".png&#10;.jpg&#10;.mp4"></textarea>
                            </div>

                            <div class="form-group">
                                <label>User Agent</label>
                                <input type="text" class="form-control" id="projectUserAgent"
                                    value="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/132.0.0.0">
                            </div>

                            <div class="form-group">
                                <label>剪贴板文本（每行一个）</label>
                                <textarea class="form-control" id="projectClipboard" rows="2" placeholder="备用文本1&#10;备用文本2"></textarea>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>DNS日志URL</label>
                                        <input type="text" class="form-control" id="projectDnslogUrl" placeholder="http://dnslog.example.com">
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>DNSLOG域名</label>
                                        <input type="text" class="form-control" id="projectDnslogDomain" placeholder="dnslog.example.com">
                                    </div>
                                </div>
                            </div>

                            <div class="form-group">
                                <label>服务锁状态</label>
                                <div class="row">
                                    <div class="col-md-4">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="spiderService">
                                            <label class="form-check-label" for="spiderService">爬虫服务</label>
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="monitorService">
                                            <label class="form-check-label" for="monitorService">资产监控</label>
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="scanerService">
                                            <label class="form-check-label" for="scanerService">漏洞扫描</label>
                                        </div>
                                    </div>
                                </div>
                                <small class="form-text text-muted">勾选表示服务开启（1），不勾选表示关闭（0）</small>
                            </div>

                            <div class="form-group">
                                <label>个人信息配置（JSON格式）</label>
                                <textarea class="form-control" id="projectPersonalInfo" rows="6"
                                    placeholder='{"username":"test","password":"xxx","email":"test@example.com"}'></textarea>
                                <small class="form-text text-muted">用于自动化测试中的个人信息填充，Key 对应表单字段的 name/id/placeholder</small>
                            </div>

                            <div class="form-group">
                                <label>DNS服务器（每行一组，逗号分隔）</label>
                                <div id="projectDnsServers"></div>
                                <button class="btn btn-sm btn-secondary mt-2" id="addDnsServer">
                                    <i class="fas fa-plus mr-1"></i>添加DNS服务器组
                                </button>
                            </div>
                        </div>

                        <!-- JSON编辑模式 -->
                        <div id="jsonMode" style="display: none;">
                            <div class="form-group">
                                <div class="d-flex justify-content-between align-items-center">
                                    <label>JSON配置 <span class="text-danger">*</span></label>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" id="formatJson">
                                        <i class="fas fa-indent mr-1"></i>格式化
                                    </button>
                                </div>
                                <textarea class="form-control" id="projectJson" rows="20" placeholder='{"Project":"项目名称","domain_list":[],...}'></textarea>
                                <small class="form-text text-muted" id="jsonError" style="display:none;color:#e74c3c;"></small>
                            </div>
                        </div>

                        <!-- 错误提示区域 -->
                        <div class="alert alert-danger mt-3" id="projectFormError" style="display:none;"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">关闭</button>
                        <button type="button" class="btn btn-primary" id="saveProject">
                            <i class="fas fa-save mr-1"></i>保存
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        $('body').append(modalHtml);
        var $modal = $('#projectModal');
        $modal.data('mode', 'form');
        $modal.data('editing', projectName);

        // 初始化 DNS 服务器默认行
        $('#projectDnsServers').append(this._dnsServerTemplate('119.29.29.29,119.28.28.28'));
        $('#projectDnsServers').append(this._dnsServerTemplate('180.76.76.76,180.76.76.76'));

        // 加载项目数据（编辑模式）
        if (isEdit) {
            $.ajax({
                url: '/api/projects/list',
                type: 'GET',
                success: function(data) {
                    var project = (data.projects || []).find(function(p) { return p.Project === projectName; });
                    if (project) {
                        self._fillFormFromProject(project);
                    } else {
                        self._showError('未找到项目「' + projectName + '」的数据');
                    }
                },
                error: function() {
                    self._showError('加载项目数据失败，请重试');
                }
            });
        } else {
            self._savedJson = null;
            $('#projectJson').val(self._getDefaultJsonTemplate());
        }

        // 绑定模态框关闭/卸载事件
        $modal.on('hidden.bs.modal', function() {
            $(this).remove();
        });

        // 显示模态框
        $modal.css('display', 'flex');
        $modal.css('justify-content', 'center');
        $modal.css('align-items', 'center');
        $('body').css('overflow', 'hidden');

        // 点击遮罩关闭
        $modal.on('click', function(e) {
            if (e.target === this) {
                $modal.css('display', 'none');
                $('body').css('overflow', '');
                $modal.trigger('hidden.bs.modal');
            }
        });

        // ESC 键关闭
        $(document).on('keydown.modalClose', function(e) {
            if (e.key === 'Escape') {
                $modal.css('display', 'none');
                $('body').css('overflow', '');
                $modal.trigger('hidden.bs.modal');
                $(document).off('keydown.modalClose');
            }
        });

        // 关闭按钮
        $modal.find('[data-dismiss="modal"], .close').on('click', function() {
            $modal.css('display', 'none');
            $('body').css('overflow', '');
            $modal.trigger('hidden.bs.modal');
        });
    };

    // ========== 填充表单（从项目数据） ==========

    this._fillFormFromProject = function(project) {
        var self = this;

        // 基本字段
        $('#projectName').val(project.Project || '');
        $('#projectDescription').val(project.Description || '');
        $('#projectDomains').val(Array.isArray(project.domain_list) ? project.domain_list.join('\n') : '');
        $('#projectPorts').val(project.port_target || '');
        $('#projectFileTypes').val(Array.isArray(project.file_type) ? project.file_type.join('\n') : '');
        $('#projectDisallowedFileTypes').val(Array.isArray(project.file_type_disallowed) ? project.file_type_disallowed.join('\n') : '');
        $('#projectUserAgent').val(project.user_agent || '');
        $('#projectClipboard').val(Array.isArray(project.clipboard_text) ? project.clipboard_text.join('\n') : '');
        $('#projectBrowserThread').val(project.browser_thread || 10);
        $('#projectHttpThread').val(project.http_thread || 10);
        $('#projectTimeout').val(project.timeout || 8);
        $('#projectDnslogUrl').val(project.dnslog_url || '');
        $('#projectDnslogDomain').val(project.dnslog_domain || '');

        // 服务锁
        if (project.service_lock) {
            $('#spiderService').prop('checked', project.service_lock.spider_service == 1 || project.service_lock.spider_service === true);
            $('#monitorService').prop('checked', project.service_lock.monitor_service == 1 || project.service_lock.monitor_service === true);
            $('#scanerService').prop('checked', project.service_lock.scaner_service == 1 || project.service_lock.scaner_service === true);
        } else {
            $('#spiderService, #monitorService, #scanerService').prop('checked', false);
        }

        // 个人信息
        var pi = project.personal_info;
        if (pi) {
            var piStr = typeof pi === 'string' ? pi : JSON.stringify(pi, null, 2);
            $('#projectPersonalInfo').val(piStr);
        } else {
            $('#projectPersonalInfo').val('');
        }

        // DNS 服务器
        $('#projectDnsServers').empty();
        if (Array.isArray(project.dns_server) && project.dns_server.length > 0) {
            project.dns_server.forEach(function(servers) {
                var val = Array.isArray(servers) ? servers.join(',') : servers;
                $('#projectDnsServers').append(self._dnsServerTemplate(val));
            });
        } else {
            $('#projectDnsServers').append(self._dnsServerTemplate('119.29.29.29,119.28.28.28'));
            $('#projectDnsServers').append(self._dnsServerTemplate('180.76.76.76,180.76.76.76'));
        }

        // 保存完整 JSON 数据用于模式切换
        this._savedJson = $.extend(true, {}, project);
        // 初始化 JSON 编辑器
        $('#projectJson').val(JSON.stringify(project, null, 2));
    };

    // ========== 切换到 JSON 模式 ==========

    this.switchToJsonMode = function() {
        var self = this;
        this._currentMode = 'json';
        var $modal = $('#projectModal');

        // 更新按钮状态
        $('#btnFormMode').removeClass('btn-primary active').addClass('btn-outline-secondary');
        $('#btnJsonMode').removeClass('btn-outline-secondary').addClass('btn-primary active');

        // 切换显示
        $('#formMode').hide();
        $('#jsonMode').show();

        // 以 _savedJson（完整原始数据）为基础，将表单修改合并进去
        // 这样不在表单中的额外字段（如 spider_cdp_service）不会丢失
        try {
            var base = this._savedJson;
            if (!base) {
                var defaultTemplate = JSON.parse(this._getDefaultJsonTemplate());
                var formChanges = this._getFormDataForJson();
                var jsonData = $.extend(true, {}, defaultTemplate, formChanges);
                this._savedJson = jsonData;
                $('#projectJson').val(JSON.stringify(jsonData, null, 2));
            } else {
                var formChanges = this._getFormDataForJson();
                var jsonData = $.extend(true, {}, base, formChanges);
                this._savedJson = jsonData;
                $('#projectJson').val(JSON.stringify(jsonData, null, 2));
            }
            $('#jsonError').hide();
        } catch (e) {
            if (this._savedJson) {
                $('#projectJson').val(JSON.stringify(this._savedJson, null, 2));
            } else {
                $('#projectJson').val(this._getDefaultJsonTemplate());
            }
            $('#jsonError').text('表单数据生成 JSON 失败: ' + e.message).show();
        }

        $modal.data('mode', 'json');
    };

    // ========== 切换到表单模式 ==========

    this.switchToFormMode = function() {
        this._currentMode = 'form';
        var $modal = $('#projectModal');

        // 更新按钮状态
        $('#btnFormMode').removeClass('btn-outline-secondary').addClass('btn-primary active');
        $('#btnJsonMode').removeClass('btn-primary active').addClass('btn-outline-secondary');

        // 切换显示
        $('#formMode').show();
        $('#jsonMode').hide();

        // 从 JSON 同步到表单
        this.syncFormFromJson();

        $modal.data('mode', 'form');
    };

    // ========== JSON 变化时同步到表单 ==========

    this.syncFormFromJson = function() {
        var jsonStr = $('#projectJson').val().trim();
        if (!jsonStr) {
            $('#jsonError').text('JSON 内容不能为空').show();
            return;
        }

        try {
            var data = JSON.parse(jsonStr);
            this._savedJson = data;
            $('#jsonError').hide();

            // 只更新表单字段（不覆盖项目名，避免空字符串覆盖已有值）
            if (data.Description !== undefined) $('#projectDescription').val(data.Description);
            if (data.domain_list !== undefined) $('#projectDomains').val(Array.isArray(data.domain_list) ? data.domain_list.join('\n') : '');
            if (data.port_target !== undefined) $('#projectPorts').val(data.port_target);
            if (data.file_type !== undefined) $('#projectFileTypes').val(Array.isArray(data.file_type) ? data.file_type.join('\n') : '');
            if (data.file_type_disallowed !== undefined) $('#projectDisallowedFileTypes').val(Array.isArray(data.file_type_disallowed) ? data.file_type_disallowed.join('\n') : '');
            if (data.user_agent !== undefined) $('#projectUserAgent').val(data.user_agent);
            if (data.clipboard_text !== undefined) $('#projectClipboard').val(Array.isArray(data.clipboard_text) ? data.clipboard_text.join('\n') : '');
            if (data.browser_thread !== undefined) $('#projectBrowserThread').val(data.browser_thread);
            if (data.http_thread !== undefined) $('#projectHttpThread').val(data.http_thread);
            if (data.timeout !== undefined) $('#projectTimeout').val(data.timeout);
            if (data.dnslog_url !== undefined) $('#projectDnslogUrl').val(data.dnslog_url);
            if (data.dnslog_domain !== undefined) $('#projectDnslogDomain').val(data.dnslog_domain);

            // 服务锁
            if (data.service_lock) {
                $('#spiderService').prop('checked', data.service_lock.spider_service == 1 || data.service_lock.spider_service === true);
                $('#monitorService').prop('checked', data.service_lock.monitor_service == 1 || data.service_lock.monitor_service === true);
                $('#scanerService').prop('checked', data.service_lock.scaner_service == 1 || data.service_lock.scaner_service === true);
            }

            // 个人信息
            if (data.personal_info !== undefined) {
                var pi = data.personal_info;
                $('#projectPersonalInfo').val(typeof pi === 'string' ? pi : JSON.stringify(pi, null, 2));
            }

            // DNS 服务器
            if (Array.isArray(data.dns_server) && data.dns_server.length > 0) {
                var self = this;
                $('#projectDnsServers').empty();
                data.dns_server.forEach(function(servers) {
                    var val = Array.isArray(servers) ? servers.join(',') : servers;
                    $('#projectDnsServers').append(self._dnsServerTemplate(val));
                });
            }
        } catch (e) {
            $('#jsonError').text('JSON 格式错误: ' + e.message).show();
        }
    };

    // ========== 格式化 JSON ==========

    this.formatJson = function() {
        var jsonStr = $('#projectJson').val().trim();
        if (!jsonStr) return;

        try {
            var data = JSON.parse(jsonStr);
            $('#projectJson').val(JSON.stringify(data, null, 2));
            $('#jsonError').hide();
        } catch (e) {
            $('#jsonError').text('无法格式化: ' + e.message).show();
        }
    };

    // ========== 重置表单 ==========

    this.resetForm = function() {
        if (this._savedJson) {
            this._fillFormFromProject(this._savedJson);
        } else {
            // 新增模式，清空表单
            var self = this;
            $('#formMode input, #formMode textarea').each(function() {
                var $el = $(this);
                var id = $el.attr('id');
                if (id === 'projectPorts') $el.val('21,22,80-89,443,1080,1433,1521,3000,3306,3389,5432,5900,6379,7001,8000,8069,8080-8099,8161,8888,9080,9081,9090,9200,9300,10000-10002,11211,11434,27016-27018,36000,50000,50070');
                else if (id === 'projectBrowserThread' || id === 'projectHttpThread') $el.val(10);
                else if (id === 'projectTimeout') $el.val(8);
                else if (id === 'projectUserAgent') $el.val('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/132.0.0.0');
                else $el.val('');
            });
            $('#spiderService, #monitorService, #scanerService').prop('checked', false);
            $('#projectDnsServers').empty()
                .append(self._dnsServerTemplate('119.29.29.29,119.28.28.28'))
                .append(self._dnsServerTemplate('180.76.76.76,180.76.76.76'));
            $('#projectJson').val(this._getDefaultJsonTemplate());
        }
    };

    // ========== 保存项目 ==========

    this.saveProject = function() {
        var self = this;
        var $modal = $('#projectModal');
        var currentMode = $modal.data('mode') || 'form';
        var projectData;

        this._hideError();

        // --- 根据当前模式获取数据 ---
        if (currentMode === 'json') {
            // JSON 模式
            var jsonStr = $('#projectJson').val().trim();
            if (!jsonStr) {
                this._showError('JSON 内容不能为空');
                return;
            }
            try {
                projectData = JSON.parse(jsonStr);
            } catch (e) {
                this._showError('JSON 格式错误: ' + e.message);
                return;
            }
        } else {
            // 表单模式
            try {
                projectData = this._getFormDataForJson();
            } catch (e) {
                this._showError(e.message);
                return;
            }
        }

        // --- 校验项目名称 ---
        var projectName = (projectData.Project || '').trim();
        if (!projectName) {
            this._showError('项目名称不能为空');
            return;
        }
        if (!/^[\w\u4e00-\u9fa5\-\.]+$/.test(projectName)) {
            this._showError('项目名称只允许字母、数字、下划线、中划线、点和中文字符');
            return;
        }

        // --- 校验域名格式（给出警告但不阻止） ---
        if (Array.isArray(projectData.domain_list) && projectData.domain_list.length > 0) {
            var invalidDomains = projectData.domain_list.filter(function(d) {
                return d && !/^https?:\/\/.+/.test(d.trim());
            });
            if (invalidDomains.length > 0) {
                console.warn('以下域名格式可能不正确:', invalidDomains);
            }
        }

        // --- 提交 ---
        var url = this._editingProject ? '/api/projects/update' : '/api/projects/add';

        $.ajax({
            url: url,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(projectData),
            success: function(data) {
                if (data.success) {
                    alert((data.message || '保存成功') + '\n重启程序后生效');
                    // 关闭模态框
                    $modal.css('display', 'none');
                    $('body').css('overflow', '');
                    $modal.trigger('hidden.bs.modal');
                    // 刷新列表
                    self.loadProjects();
                    self.loadProjectStatus();
                } else {
                    self._showError(data.message || '保存失败');
                }
            },
            error: function(xhr) {
                var msg = '保存失败，请检查网络';
                try {
                    var resp = JSON.parse(xhr.responseText);
                    msg = resp.message || msg;
                } catch (e) {}
                self._showError(msg);
            }
        });
    };

    // ========== 从表单获取数据（用于 JSON 生成） ==========

    this._getFormDataForJson = function() {
        var projectName = $('#projectName').val().trim();
        var description = $('#projectDescription').val().trim();
        var domainList = this._splitLines($('#projectDomains').val());
        var portTarget = $('#projectPorts').val().trim();
        var fileType = this._splitLines($('#projectFileTypes').val());
        var fileTypeDisallowed = this._splitLines($('#projectDisallowedFileTypes').val());
        var userAgent = $('#projectUserAgent').val().trim();
        var clipboardText = this._splitLines($('#projectClipboard').val());
        var browserThread = parseInt($('#projectBrowserThread').val()) || 10;
        var httpThread = parseInt($('#projectHttpThread').val()) || 10;
        var timeout = parseInt($('#projectTimeout').val()) || 8;
        var dnslogUrl = $('#projectDnslogUrl').val().trim();
        var dnslogDomain = $('#projectDnslogDomain').val().trim();

        var serviceLock = {
            spider_service: $('#spiderService').is(':checked') ? 1 : 0,
            monitor_service: $('#monitorService').is(':checked') ? 1 : 0,
            scaner_service: $('#scanerService').is(':checked') ? 1 : 0
        };

        var dnsServers = [];
        $('#projectDnsServers .dns-server').each(function() {
            var val = $(this).val().trim();
            if (val) {
                var servers = val.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
                if (servers.length > 0) dnsServers.push(servers);
            }
        });

        // 解析个人信息
        var personalInfo = {};
        var personalInfoStr = $('#projectPersonalInfo').val().trim();
        if (personalInfoStr) {
            try {
                personalInfo = JSON.parse(personalInfoStr);
            } catch (e) {
                throw new Error('个人信息JSON格式错误: ' + e.message);
            }
        }

        return {
            Project: projectName,
            Description: description,
            domain_list: domainList,
            port_target: portTarget,
            file_type: fileType,
            file_type_disallowed: fileTypeDisallowed,
            user_agent: userAgent,
            clipboard_text: clipboardText,
            browser_thread: browserThread,
            http_thread: httpThread,
            timeout: timeout,
            dnslog_url: dnslogUrl,
            dnslog_domain: dnslogDomain,
            service_lock: serviceLock,
            dns_server: dnsServers,
            personal_info: personalInfo
        };
    };

    // ========== 工具方法 ==========

    // 将多行文本拆分为数组（过滤空行）
    this._splitLines = function(text) {
        if (!text) return [];
        return text.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    };

    // DNS 服务器行 HTML 模板
    this._dnsServerTemplate = function(defaultVal) {
        defaultVal = defaultVal || '';
        return `<div class="input-group mb-2 dns-server-row">
            <input type="text" class="form-control dns-server" value="${this._escapeHtml(defaultVal)}" placeholder="如: 119.29.29.29,8.8.8.8">
            <div class="input-group-append">
                <button class="btn btn-danger btn-sm remove-dns-server" type="button">删除</button>
            </div>
        </div>`;
    };

    // 默认 JSON 模板（新增项目时）
    this._getDefaultJsonTemplate = function() {
        return JSON.stringify({
            Project: '',
            Description: '',
            domain_list: [],
            port_target: '21,22,80-89,443,1080,1433,1521,3000,3306,3389,5432,5900,6379,7001,8000,8069,8080-8099,8161,8888,9080,9081,9090,9200,9300,10000-10002,11211,11434,27016-27018,36000,50000,50070',
            file_type: [],
            file_type_disallowed: [],
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/132.0.0.0',
            clipboard_text: [],
            browser_thread: 10,
            http_thread: 10,
            timeout: 8,
            dnslog_url: '',
            dnslog_domain: '',
            service_lock: { spider_service: 0, monitor_service: 0, scaner_service: 0 },
            dns_server: [['119.29.29.29', '119.28.28.28'], ['180.76.76.76']],
            personal_info: {}
        }, null, 2);
    };

    // HTML 转义
    this._escapeHtml = function(str) {
        return FacaiUtils.escapeHtml(str);
    };

    // 显示错误
    this._showError = function(msg) {
        var $err = $('#projectFormError');
        $err.text(msg).show();
        // 3秒后自动隐藏
        setTimeout(function() { $err.hide(); }, 5000);
    };

    // 隐藏错误
    this._hideError = function() {
        $('#projectFormError').hide();
        $('#jsonError').hide();
    };
}
