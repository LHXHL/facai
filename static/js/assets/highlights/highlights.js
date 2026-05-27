function HighlightsModule() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.searchKeyword = '';
    this.searchType = 'url';
    this.sortBy = 'time';
    this.sortOrder = -1;
    this.activeTag = '';

    // XSS安全：只允许 http/https 协议的URL
    this.safeUrl = function(url) {
        if (url && /^https?:\/\//i.test(url)) return url;
        return '#';
    };

    this.render = function(data, container) {
        // 保存容器引用
        this.container = container;

        container.html(`
            <div class="card">
                <div class="card-header">
                    <div class="row">
                        <div class="col-md-6">重点资产管理</div>
                        <div class="col-md-6 text-right">
                            <button class="btn btn-success" id="addHighlight">添加资产</button>
                            <button class="btn btn-primary" id="refreshHighlights">刷新</button>
                            <button class="btn btn-warning" id="clearHighlights">清空</button>
                        </div>
                    </div>
                </div>
                <div class="hl-tags-cloud" id="tagsCloud">
                    <span class="hl-tags-label">标签筛选</span>
                    <span class="hl-tag-item hl-tag-all active" data-tag="">全部</span>
                    <!-- 动态填充 -->
                </div>
                <div class="form-group-p3">
                    <div class="row mb-3">
                        <div class="col-md-2">
                            <select class="form-control" id="searchType">
                                <option value="url">URL</option>
                                <option value="title">标题</option>
                                <option value="tags">标签</option>
                                <option value="type">类型</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <input type="text" class="form-control" id="searchHighlight" placeholder="搜索URL、标题、标签...">
                        </div>
                        <div class="col-md-2">
                            <button class="btn btn-primary" id="searchBtn">搜索</button>
                            <button class="btn btn-secondary" id="clearSearchBtn">清除</button>
                        </div>
                    </div>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th class="sortable" data-sort="type" style="width: 100px;">类型 <span class="sort-icon"></span></th>
                                    <th class="sortable" data-sort="url">URL <span class="sort-icon"></span></th>
                                    <th class="sortable" data-sort="title" style="width: 150px;">标题 <span class="sort-icon"></span></th>
                                    <th style="width: 200px;">标签</th>
                                    <th class="sortable" data-sort="time" style="width: 150px;">时间 <span class="sort-icon"></span></th>
                                    <th style="width: 150px;">操作</th>
                                </tr>
                            </thead>
                            <tbody id="highlightsList"></tbody>
                        </table>
                    </div>
                    <div id="highlightsPagination" class="module-pagination"></div>
                </div>
            </div>
        `);
        this.updateSortIcons();
        this.loadHighlights();
        this.loadTags();
        this.bindEvents();
    };

    this.loadTags = function() {
        var self = this;
        AssetsAPI.highlights.tags(function(data) {
            if (data.success && data.tags) {
                var tags = data.tags;
                var cloud = $('#tagsCloud');
                cloud.empty();

                var $label = $('<span class="hl-tags-label">').text('标签筛选');
                var $all = $('<span class="hl-tag-item hl-tag-all">').attr('data-tag', '').text('全部');
                if (self.activeTag === '') $all.addClass('active');
                cloud.append($label).append($all);

                var sortedTags = Object.keys(tags).sort(function(a, b) { return tags[b] - tags[a]; });
                sortedTags.forEach(function(tag) {
                    var $tag = $('<span class="hl-tag-item">').attr('data-tag', tag).text(tag);
                    if (self.activeTag === tag) $tag.addClass('active');
                    var $count = $('<span class="hl-tag-count">').text(tags[tag]);
                    $tag.append($count);
                    cloud.append($tag);
                });
            }
        });
    };

    this.loadHighlights = function() {
        var self = this;
        AssetsAPI.highlights.list(
            {
                page: self.currentPage,
                page_size: self.pageSize,
                search_keyword: self.searchKeyword,
                search_type: self.searchType,
                sort_by: self.sortBy,
                sort_order: self.sortOrder,
                tag: self.activeTag || ''
            },
            function(data) {
                var tbody = $('#highlightsList');
                tbody.empty();
                if (data.data && data.data.length > 0) {
                    data.data.forEach(function(item) {
                        var typeDisplay = self.getTypeDisplay(item.type);
                        var typeColor = self.getTypeColor(item.type);

                        var urlDisplay = item.url || '';
                        if (urlDisplay.length > 60) urlDisplay = urlDisplay.substring(0, 60) + '...';

                        var titleDisplay = item.title || '';
                        if (titleDisplay.length > 20) titleDisplay = titleDisplay.substring(0, 20) + '...';

                        var $tr = $('<tr>');

                        // 类型
                        var $tdType = $('<td>');
                        $('<span>').addClass('badge badge-' + typeColor).text(typeDisplay).appendTo($tdType);
                        $tr.append($tdType);

                        // URL
                        var $tdUrl = $('<td>');
                        $('<a>').attr('href', self.safeUrl(item.url)).attr('target', '_blank').attr('title', item.url || '').text(urlDisplay).appendTo($tdUrl);
                        $tr.append($tdUrl);

                        // 标题
                        $('<td>').attr('title', item.title || '').text(titleDisplay).appendTo($tr);

                        // 标签
                        var $tdTags = $('<td>');
                        if (item.tags && item.tags.length > 0) {
                            item.tags.forEach(function(tag) {
                                $('<span class="highlight-tag">').text(tag).appendTo($tdTags);
                            });
                        }
                        $tr.append($tdTags);

                        // 时间
                        $('<td>').text(item.time || '').appendTo($tr);

                        // 操作
                        var $tdActions = $('<td>');
                        $('<button>').addClass('btn btn-info btn-sm hl-view-detail').attr('data-id', item._id).text('详情').appendTo($tdActions);
                        $('<button>').addClass('btn btn-warning btn-sm hl-edit').attr('data-id', item._id).text('编辑').appendTo($tdActions);
                        $('<button>').addClass('btn btn-danger btn-sm hl-delete').attr('data-id', item._id).text('删除').appendTo($tdActions);
                        $tr.append($tdActions);

                        tbody.append($tr);
                    });

                    var paginationHtml = PageUp.generatePagination({
                        currentPage: data.page,
                        totalPages: data.total_pages,
                        onPageChange: function(page) {
                            self.currentPage = page;
                            self.loadHighlights();
                        }
                    }, self.container);
                    self.container.find('.module-pagination').html(paginationHtml);
                    self.loadTags();
                } else {
                    tbody.append('<tr><td colspan="6" class="text-center text-muted">暂无重点资产数据</td></tr>');
                    self.container.find('.module-pagination').html('');
                }
            },
            function(xhr) {
                var tbody = $('#highlightsList');
                tbody.empty();
                if (xhr.status === 404 || xhr.status === 500) {
                    tbody.append('<tr><td colspan="6" class="text-center text-muted">暂无项目或暂无数据</td></tr>');
                } else {
                    tbody.append('<tr><td colspan="6" class="text-center text-danger">加载失败，请重试</td></tr>');
                }
                self.container.find('.module-pagination').html('');
            }
        );
    };

    this.getTypeDisplay = function(type) {
        var typeMap = {
            'web': 'Web',
            'win_client': 'Win客户端',
            'mac_client': 'Mac客户端',
            'android_client': 'Android',
            'ios_client': 'iOS',
            'mini_client': '小程序',
            'linux_client': 'Linux客户端',
            'other': '其他'
        };
        return typeMap[type] || type || '未知';
    };

    this.getTypeColor = function(type) {
        var colorMap = {
            'web': 'primary',
            'win_client': 'info',
            'mac_client': 'secondary',
            'android_client': 'success',
            'ios_client': 'warning',
            'mini_client': 'danger',
            'linux_client': 'primary',
            'other': 'secondary'
        };
        return colorMap[type] || 'secondary';
    };

    // 更新排序图标
    this.updateSortIcons = function() {
        var self = this;
        // 移除所有排序状态
        this.container.find('.sortable').removeClass('sort-asc sort-desc');
        this.container.find('.sort-icon').html('');

        // 设置当前排序字段的图标
        this.container.find('.sortable').each(function() {
            var field = $(this).data('sort');
            if (field === self.sortBy) {
                $(this).addClass(self.sortOrder === 1 ? 'sort-asc' : 'sort-desc');
                $(this).find('.sort-icon').html(self.sortOrder === 1 ? '▲' : '▼');
            }
        });
    };

    this.bindEvents = function() {
        var self = this;

        // 标签云点击筛选
        this.container.on('click', '.hl-tag-item', function() {
            var tag = $(this).data('tag');
            self.activeTag = tag;
            self.currentPage = 1;
            // 更新选中状态
            self.container.find('.hl-tag-item').removeClass('active');
            $(this).addClass('active');
            self.loadHighlights();
        });

        // 表头排序点击事件
        this.container.on('click', '.sortable', function() {
            var field = $(this).data('sort');
            
            if (self.sortBy === field) {
                self.sortOrder = self.sortOrder === 1 ? -1 : 1;
            } else {
                self.sortBy = field;
                self.sortOrder = -1;
            }
            
            self.updateSortIcons();
            self.currentPage = 1;
            self.loadHighlights();
        });

        // 添加资产按钮
        this.container.on('click', '#addHighlight', function() {
            self.showAddModal();
        });

        // 刷新按钮
        this.container.on('click', '#refreshHighlights', function() {
            self.currentPage = 1;
            self.loadHighlights();
        });

        // 清空按钮
        this.container.on('click', '#clearHighlights', function() {
            if (confirm('确定要清空所有重点资产数据吗？')) {
                AssetsAPI.highlights.clear(function(data) {
                    if (data.success) {
                        alert(data.message);
                        self.currentPage = 1;
                        self.loadHighlights();
                    } else {
                        alert(data.message);
                    }
                });
            }
        });

        // 搜索按钮
        this.container.on('click', '#searchBtn', function() {
            self.searchType = $('#searchType').val();
            self.searchKeyword = $('#searchHighlight').val();
            self.currentPage = 1;
            self.loadHighlights();
        });

        // 清除搜索按钮
        this.container.on('click', '#clearSearchBtn', function() {
            $('#searchHighlight').val('');
            self.searchKeyword = '';
            self.activeTag = '';
            self.currentPage = 1;
            self.container.find('.hl-tag-item').removeClass('active');
            self.container.find('.hl-tag-all').addClass('active');
            self.loadHighlights();
        });

        // 搜索框回车搜索
        this.container.on('keypress', '#searchHighlight', function(e) {
            if (e.which === 13) {
                $('#searchBtn').click();
            }
        });

        // 查看详情
        this.container.on('click', '.hl-view-detail', function() {
            var id = $(this).data('id');
            self.showDetailModal(id);
        });

        // 编辑
        this.container.on('click', '.hl-edit', function() {
            var id = $(this).data('id');
            self.showEditModal(id);
        });

        // 删除
        this.container.on('click', '.hl-delete', function() {
            var id = $(this).data('id');
            if (confirm('确定要删除这条重点资产数据吗？')) {
                AssetsAPI.highlights.delete(id, function(data) {
                    if (data.success) {
                        alert(data.message);
                        self.loadHighlights();
                    } else {
                        alert(data.message);
                    }
                });
            }
        });
    };

    // ==================== 添加/编辑弹窗 ====================
    
    // 获取表单HTML（添加和编辑共用），不包含服务端数据
    this.getFormHtml = function(isEdit) {
        var typeOptions = `
            <option value="web">Web</option>
            <option value="win_client">Win客户端</option>
            <option value="mac_client">Mac客户端</option>
            <option value="linux_client">Linux客户端</option>
            <option value="android_client">Android</option>
            <option value="ios_client">iOS</option>
            <option value="mini_client">小程序</option>
            <option value="other">其他</option>
        `;
        
        var title = isEdit ? '编辑重点资产' : '添加重点资产';
        var btnText = isEdit ? '更新' : '保存';
        var btnId = isEdit ? 'updateHighlight' : 'saveHighlight';
        
        return `
            <div class="modal" id="highlightModal">
                <div class="modal-content hl-form-modal">
                    <div class="modal-header">
                        <h5 class="modal-title" id="hl_modal_title"></h5>
                        <button type="button" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="highlightForm" class="hl-form">
                            <!-- 基础信息 -->
                            <div class="hl-section">
                                <div class="hl-section-title">基础信息</div>
                                <div class="hl-field-row">
                                    <div class="hl-field">
                                        <label>URL <span class="hl-required">*</span></label>
                                        <input type="text" class="form-control" id="hl_url" required placeholder="https://example.com/path">
                                    </div>
                                    <div class="hl-field hl-field-sm">
                                        <label>类型</label>
                                        <select class="form-control" id="hl_type">
                                            ${typeOptions}
                                        </select>
                                    </div>
                                </div>
                                <div class="hl-field-row">
                                    <div class="hl-field">
                                        <label>标题</label>
                                        <input type="text" class="form-control" id="hl_title" placeholder="页面标题或资产名称">
                                    </div>
                                    <div class="hl-field">
                                        <label>来源URL</label>
                                        <input type="text" class="form-control" id="hl_referer_url" placeholder="发现该资产的页面URL">
                                    </div>
                                </div>
                                <div class="hl-field">
                                    <label>标签</label>
                                    <input type="text" class="form-control" id="hl_tags" placeholder="登录点, 敏感接口, 后台管理（逗号分隔）">
                                </div>
                            </div>
                            
                            <!-- 报告内容（核心） -->
                            <div class="hl-section">
                                <div class="hl-section-title">
                                    报告内容
                                    <span class="hl-section-hint">（安全报告核心内容，正文描述）</span>
                                </div>
                                <div class="hl-field">
                                    <label>简述</label>
                                    <input type="text" class="form-control" id="hl_desc" placeholder="简要描述该资产的用途或发现过程">
                                </div>
                                <div class="hl-field">
                                    <label>正文 <span class="hl-required">*</span></label>
                                    <textarea class="form-control hl-textarea-body" id="hl_body_text" required placeholder="详细的安全报告内容...\n\n包括：\n1. 资产描述\n2. 发现的漏洞或安全问题\n3. 影响范围\n4. 复现步骤\n5. 修复建议"></textarea>
                                </div>
                            </div>
                            
                            <!-- 附加信息 -->
                            <div class="hl-section">
                                <div class="hl-section-title">附加信息</div>
                                <div class="hl-field-row">
                                    <div class="hl-field">
                                        <label>平台</label>
                                        <input type="text" class="form-control" id="hl_platform" placeholder="操作系统平台">
                                    </div>
                                    <div class="hl-field">
                                        <label>版本</label>
                                        <input type="text" class="form-control" id="hl_version" placeholder="版本号">
                                    </div>
                                    <div class="hl-field">
                                        <label>包名</label>
                                        <input type="text" class="form-control" id="hl_package_name" placeholder="应用包名">
                                    </div>
                                </div>
                                <div class="hl-field">
                                    <label>下载URL</label>
                                    <input type="text" class="form-control" id="hl_download_url" placeholder="APK/客户端下载地址">
                                </div>
                            </div>
                            
                            <!-- HTTP信息（可折叠） -->
                            <div class="hl-section hl-section-collapsible">
                                <div class="hl-section-title hl-toggle">
                                    <span>HTTP信息</span>
                                    <span class="hl-toggle-icon">▼</span>
                                </div>
                                <div class="hl-section-content">
                                    <div class="hl-field">
                                        <label>HTTP请求</label>
                                        <textarea class="form-control hl-textarea-code" id="hl_http_request" placeholder="完整的HTTP请求报文"></textarea>
                                    </div>
                                    <div class="hl-field">
                                        <label>HTTP响应</label>
                                        <textarea class="form-control hl-textarea-code" id="hl_http_response" placeholder="完整的HTTP响应报文"></textarea>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-primary" id="${btnId}">${btnText}</button>
                        <button type="button" class="btn btn-secondary modal-close-btn">取消</button>
                    </div>
                </div>
            </div>
        `;
    };

    // 安全填充表单数据（使用 .val() 和 .text()，不拼HTML）
    this.fillFormData = function(hl) {
        if (!hl) return;
        $('#hl_modal_title').text($('#hl_modal_title').text()); // 标题已经是静态的，无需改
        if (hl.url) $('#hl_url').val(hl.url);
        if (hl.type) $('#hl_type').val(hl.type);
        if (hl.title) $('#hl_title').val(hl.title);
        if (hl.referer_url) $('#hl_referer_url').val(hl.referer_url);
        if (hl.tags && hl.tags.length > 0) $('#hl_tags').val(hl.tags.join(', '));
        if (hl.desc) $('#hl_desc').val(hl.desc);
        if (hl.body_text) $('#hl_body_text').val(hl.body_text);
        if (hl.platform) $('#hl_platform').val(hl.platform);
        if (hl.version) $('#hl_version').val(hl.version);
        if (hl.package_name) $('#hl_package_name').val(hl.package_name);
        if (hl.download_url) $('#hl_download_url').val(hl.download_url);
        if (hl.http_request) $('#hl_http_request').val(hl.http_request);
        if (hl.http_response) $('#hl_http_response').val(hl.http_response);
    };

    // 绑定表单事件
    this.bindFormEvents = function(isEdit, id) {
        var self = this;
        
        // 折叠切换
        $('#highlightModal').on('click', '.hl-toggle', function() {
            $(this).toggleClass('collapsed');
            $(this).siblings('.hl-section-content').slideToggle();
        });
        
        // 保存/更新按钮
        $('#highlightModal').on('click', '#saveHighlight, #updateHighlight', function() {
            var tagsStr = $('#hl_tags').val();
            var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [];

            var data = {
                url: $('#hl_url').val(),
                type: $('#hl_type').val(),
                title: $('#hl_title').val(),
                referer_url: $('#hl_referer_url').val(),
                tags: tags,
                desc: $('#hl_desc').val(),
                body_text: $('#hl_body_text').val(),
                platform: $('#hl_platform').val(),
                version: $('#hl_version').val(),
                package_name: $('#hl_package_name').val(),
                download_url: $('#hl_download_url').val(),
                http_request: $('#hl_http_request').val(),
                http_response: $('#hl_http_response').val()
            };

            // 验证
            if (!data.url) {
                alert('请输入URL');
                return;
            }
            if (!data.body_text) {
                alert('请输入正文内容');
                return;
            }

            var saveCallback = function(result) {
                if (result.success) {
                    alert(result.message);
                    if (!isEdit) self.clearFormDraft();
                    $('#highlightModal').removeClass('active');
                    setTimeout(function() { $('#highlightModal').remove(); }, 300);
                    self.loadHighlights();
                } else {
                    alert(result.message);
                }
            };

            if (isEdit) {
                AssetsAPI.highlights.update(id, data, saveCallback);
            } else {
                AssetsAPI.highlights.add(data, saveCallback);
            }
        });
    };

    this.showAddModal = function() {
        var self = this;
        var draft = self.loadFormDraft();
        var modalHtml = this.getFormHtml(false);
        
        $('body').append(modalHtml);
        $('#hl_modal_title').text('添加重点资产');
        this.fillFormData(draft);
        $('#highlightModal').addClass('active');
        this.bindFormEvents(false);
        this.bindModalCloseEvents('#highlightModal', true); // isAdd=true，关闭时保存草稿
    };

    this.showEditModal = function(id) {
        var self = this;
        AssetsAPI.highlights.detail(id, function(data) {
            if (data.success && data.highlight) {
                var modalHtml = self.getFormHtml(true);
                $('body').append(modalHtml);
                $('#hl_modal_title').text('编辑重点资产');
                self.fillFormData(data.highlight);
                $('#highlightModal').addClass('active');
                self.bindFormEvents(true, id);
                self.bindModalCloseEvents('#highlightModal', false);
            } else {
                alert('获取数据失败');
            }
        });
    };

    // 保存添加表单草稿
    this.saveFormDraft = function() {
        try {
            var fields = ['hl_url','hl_type','hl_title','hl_referer_url','hl_tags',
                          'hl_desc','hl_body_text','hl_platform','hl_version',
                          'hl_package_name','hl_download_url','hl_http_request','hl_http_response'];
            var draft = {};
            fields.forEach(function(f) {
                var el = $('#' + f);
                if (el.length) draft[f] = el.val() || '';
            });
            sessionStorage.setItem('hl_add_draft', JSON.stringify(draft));
        } catch (e) {}
    };

    // 读取添加表单草稿
    this.loadFormDraft = function() {
        try {
            var str = sessionStorage.getItem('hl_add_draft');
            if (!str) return null;
            var draft = JSON.parse(str);
            // 转换为 highlight 对象格式供 fillFormData 使用
            return {
                url: draft.hl_url || '',
                type: draft.hl_type || 'web',
                title: draft.hl_title || '',
                referer_url: draft.hl_referer_url || '',
                tags: draft.hl_tags ? draft.hl_tags.split(',').map(function(t){return t.trim();}).filter(function(t){return t;}) : [],
                desc: draft.hl_desc || '',
                body_text: draft.hl_body_text || '',
                platform: draft.hl_platform || '',
                version: draft.hl_version || '',
                package_name: draft.hl_package_name || '',
                download_url: draft.hl_download_url || '',
                http_request: draft.hl_http_request || '',
                http_response: draft.hl_http_response || ''
            };
        } catch (e) {
            return null;
        }
    };

    // 清除草稿
    this.clearFormDraft = function() {
        try {
            sessionStorage.removeItem('hl_add_draft');
        } catch (e) {}
    };

    // ==================== 详情弹窗 ====================
    
    this.showDetailModal = function(id) {
        var self = this;
        AssetsAPI.highlights.detail(id, function(data) {
            if (data.success && data.highlight) {
                var hl = data.highlight;
                var typeDisplay = self.getTypeDisplay(hl.type);
                var statusText = hl.status === 1 ? '已处理' : '待处理';
                var statusClass = hl.status === 1 ? 'status-done' : 'status-pending';

                // 构建详情弹窗DOM（不拼接服务端数据到HTML）
                var $modal = $('<div class="modal" id="detailModal">');
                var $content = $('<div class="modal-content hl-detail-modal">');

                // header
                var $header = $('<div class="modal-header">');
                $header.append($('<h5 class="modal-title">').text('重点资产详情'));
                $header.append($('<button type="button" class="modal-close">').text('\u00D7'));
                $content.append($header);

                // body
                var $body = $('<div class="modal-body">');

                // 基本信息
                var $section1 = $('<div class="hl-detail-section">');
                var $detailHeader = $('<div class="hl-detail-header">');
                $detailHeader.append($('<span>').addClass('hl-detail-badge badge-' + self.getTypeColor(hl.type)).text(typeDisplay));
                $detailHeader.append($('<span>').addClass('hl-detail-status ' + statusClass).text(statusText));
                $section1.append($detailHeader);

                var $detailTitle = $('<div class="hl-detail-title">').text(hl.title || '无标题');
                $section1.append($detailTitle);

                var $detailUrl = $('<div class="hl-detail-url">');
                var $urlLink = $('<a>').attr('href', self.safeUrl(hl.url)).attr('target', '_blank').text(hl.url || '无URL');
                $detailUrl.append($urlLink);
                $section1.append($detailUrl);

                if (hl.referer_url) {
                    var $detailReferer = $('<div class="hl-detail-referer">');
                    $detailReferer.append(document.createTextNode('来源: '));
                    var $refererLink = $('<a>').attr('href', self.safeUrl(hl.referer_url)).attr('target', '_blank').text(hl.referer_url);
                    $detailReferer.append($refererLink);
                    $section1.append($detailReferer);
                }
                $body.append($section1);

                // 标签
                if (hl.tags && hl.tags.length > 0) {
                    var $sectionTags = $('<div class="hl-detail-section">');
                    $sectionTags.append($('<div class="hl-detail-label">').text('标签'));
                    var $tagsDiv = $('<div class="hl-detail-tags">');
                    hl.tags.forEach(function(t) {
                        $('<span class="highlight-tag">').text(t).appendTo($tagsDiv);
                    });
                    $sectionTags.append($tagsDiv);
                    $body.append($sectionTags);
                }

                // 简述
                if (hl.desc) {
                    var $sectionDesc = $('<div class="hl-detail-section">');
                    $sectionDesc.append($('<div class="hl-detail-label">').text('简述'));
                    $sectionDesc.append($('<div class="hl-detail-desc">').text(hl.desc));
                    $body.append($sectionDesc);
                }

                // 正文
                var $sectionBody = $('<div class="hl-detail-section hl-detail-section-main">');
                $sectionBody.append($('<div class="hl-detail-label">').text('正文内容'));
                var $bodyTextDiv = $('<div class="hl-detail-body">');
                if (hl.body_text) {
                    // 安全换行：用 text() 设内容，再用 <br> 替换换行
                    var lines = hl.body_text.split('\n');
                    lines.forEach(function(line, i) {
                        $bodyTextDiv.append(document.createTextNode(line));
                        if (i < lines.length - 1) {
                            $bodyTextDiv.append($('<br>'));
                        }
                    });
                } else {
                    $bodyTextDiv.append($('<span class="text-muted">').text('无正文内容'));
                }
                $sectionBody.append($bodyTextDiv);
                $body.append($sectionBody);

                // 附加信息
                var $sectionMeta = $('<div class="hl-detail-section hl-detail-meta">');
                if (hl.platform) {
                    var $item = $('<div class="hl-meta-item">');
                    $item.append($('<label>').text('平台:'));
                    $item.append(document.createTextNode(' ' + hl.platform));
                    $sectionMeta.append($item);
                }
                if (hl.version) {
                    var $item = $('<div class="hl-meta-item">');
                    $item.append($('<label>').text('版本:'));
                    $item.append(document.createTextNode(' ' + hl.version));
                    $sectionMeta.append($item);
                }
                if (hl.package_name) {
                    var $item = $('<div class="hl-meta-item">');
                    $item.append($('<label>').text('包名:'));
                    $item.append(document.createTextNode(' ' + hl.package_name));
                    $sectionMeta.append($item);
                }
                if (hl.download_url) {
                    var $item = $('<div class="hl-meta-item">');
                    $item.append($('<label>').text('下载:'));
                    $item.append(document.createTextNode(' '));
                    var $dlLink = $('<a>').attr('href', self.safeUrl(hl.download_url)).attr('target', '_blank').text(hl.download_url);
                    $item.append($dlLink);
                    $sectionMeta.append($item);
                }
                var $timeItem = $('<div class="hl-meta-item">');
                $timeItem.append($('<label>').text('时间:'));
                $timeItem.append(document.createTextNode(' ' + (hl.time || '')));
                $sectionMeta.append($timeItem);
                $body.append($sectionMeta);

                // HTTP信息（可折叠）
                if (hl.http_request || hl.http_response) {
                    var $sectionHttp = $('<div class="hl-detail-section hl-section-collapsible">');
                    var $httpToggle = $('<div class="hl-detail-label hl-toggle">');
                    $httpToggle.append($('<span>').text('HTTP信息'));
                    $httpToggle.append($('<span class="hl-toggle-icon">').text('▼'));
                    $sectionHttp.append($httpToggle);

                    var $httpContent = $('<div class="hl-section-content">');
                    if (hl.http_request) {
                        var $reqBlock = $('<div class="hl-http-block">');
                        $reqBlock.append($('<div class="hl-http-label">').text('请求'));
                        $reqBlock.append($('<pre class="hl-http-pre">').text(hl.http_request));
                        $httpContent.append($reqBlock);
                    }
                    if (hl.http_response) {
                        var $resBlock = $('<div class="hl-http-block">');
                        $resBlock.append($('<div class="hl-http-label">').text('响应'));
                        $resBlock.append($('<pre class="hl-http-pre">').text(hl.http_response));
                        $httpContent.append($resBlock);
                    }
                    $sectionHttp.append($httpContent);
                    $body.append($sectionHttp);
                }

                $content.append($body);

                // footer
                var $actions = $('<div class="form-actions">');
                $actions.append($('<button type="button" class="btn btn-secondary modal-close-btn">').text('关闭'));
                $content.append($actions);

                $modal.append($content);

                $('body').append($modal);
                $('#detailModal').addClass('active');
                
                // 折叠切换
                $('#detailModal').on('click', '.hl-toggle', function() {
                    $(this).toggleClass('collapsed');
                    $(this).siblings('.hl-section-content, .hl-detail-body').slideToggle();
                });
                
                self.bindModalCloseEvents('#detailModal');
            } else {
                alert('获取数据失败');
            }
        });
    };

    // 绑定弹窗关闭事件
    this.bindModalCloseEvents = function(modalId, isAdd) {
        var self = this;
        $(modalId).on('click', '.modal-close, .modal-close-btn', function() {
            if (isAdd) self.saveFormDraft();
            $(modalId).removeClass('active');
            setTimeout(function() { $(modalId).remove(); }, 300);
        });
        $(modalId).on('click', function(e) {
            if (e.target === this) {
                if (isAdd) self.saveFormDraft();
                $(this).removeClass('active');
                setTimeout(function() { $(modalId).remove(); }, 300);
            }
        });
    };
}
