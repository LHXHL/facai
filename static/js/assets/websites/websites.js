function WebsitesModule() {
    this.currentPage = 1;
    this.pageSize = 21;
    this.searchKeyword = '';
    this.searchField = 'url';

    this.render = function(data, container) {
        // 保存容器引用
        this.container = container;

        container.html(`
            <div class="website-grid-container">
                <div class="card">
                    <div class="card-header">
                        <div class="row">
                            <div class="col-md-6">网站管理</div>
                            <div class="col-md-6 text-right">
                                <button class="btn btn-primary" id="refreshWebsites">刷新</button>
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <div class="row mb-3">
                            <div class="col-md-3">
                                <select class="form-control" id="searchField">
                                    <option value="url">URL</option>
                                    <option value="title">标题</option>
                                    <option value="time">时间</option>
                                    <option value="port">端口</option>
                                    <option value="tag">标签</option>
                                    <option value="current_url">当前URL</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <input type="text" class="form-control" id="searchWebsite" placeholder="输入搜索关键词...">
                            </div>
                            <div class="col-md-3">
                                <button class="btn btn-primary" id="searchBtn">搜索</button>
                                <button class="btn btn-secondary" id="clearSearchBtn">清除</button>
                            </div>
                        </div>
                        <div id="websiteList" class="website-grid"></div>
                        <div id="websitesPagination" class="module-pagination"></div>
                    </div>
                </div>
            </div>
        `);
        this.loadWebsites();
        this.bindEvents();
    };

    this.loadWebsites = function(callback) {
        var self = this;
        $.ajax({
            url: '/api/assets/websites',
            type: 'GET',
            data: {
                page: self.currentPage,
                page_size: self.pageSize,
                search_keyword: self.searchKeyword,
                search_field: self.searchField,
                sort_by: 'time_update',
                sort_order: -1
            },
            success: function(data) {
                var $listContainer = $('#websiteList');
                $listContainer.empty();
                if (data.websites && data.websites.length > 0) {
                    var gridHtml = '<div class="row">';
                    data.websites.forEach(function(item) {
                        // 处理状态码颜色
                        var statusColor = 'info';
                        if (item.http_status_code >= 200 && item.http_status_code < 300) {
                            statusColor = 'success';
                        } else if (item.http_status_code >= 300 && item.http_status_code < 400) {
                            statusColor = 'warning';
                        } else if (item.http_status_code >= 400) {
                            statusColor = 'danger';
                        }

                        // 处理截图背景
                        var screenshotStyle = '';
                        if (item.screenshot) {
                            screenshotStyle = `background-image: url('/${item.screenshot}');`;
                        }

                        gridHtml += `
                            <div class="col-md-6 col-lg-4 mb-4">
                                <div class="website-card">
                                    <!-- 顶部截图区域 -->
                                    <div class="website-hero" style="${screenshotStyle}" data-src="${item.screenshot ? '/' + item.screenshot : ''}">
                                        <div class="hero-overlay">
                                            <div class="status-badge status-${statusColor}">
                                                <span class="status-number">${item.http_status_code || 'N/A'}</span>
                                            </div>
                                            <div class="hero-actions">
                                                <button class="action-btn view-detail" data-id="${item._id}" title="查看详情">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                        <circle cx="12" cy="12" r="3"></circle>
                                                    </svg>
                                                </button>
                                                <button class="action-btn delete-website" data-id="${item._id}" title="删除">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <polyline points="3,6 5,6 21,6"></polyline>
                                                        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- 内容区域 -->
                                    <div class="website-content">
                                        <div class="content-main">
                                            <a href="${item.url}" target="_blank" class="website-url">${item.url}</a>
                                            ${item.title ? `<div class="website-title">${item.title}</div>` : ''}
                                        </div>
                                        
                                        <div class="content-meta">
                                            ${item.subdomain ? `
                                                <span class="meta-tag">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <circle cx="12" cy="12" r="10"></circle>
                                                        <line x1="2" y1="12" x2="22" y2="12"></line>
                                                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                                    </svg>
                                                    ${item.subdomain}
                                                </span>
                                            ` : ''}
                                            ${item.port ? `
                                                <span class="meta-tag">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                                    </svg>
                                                    ${item.port}
                                                </span>
                                            ` : ''}
                                            ${item.server ? `
                                                <span class="meta-tag">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                                        <line x1="8" y1="21" x2="16" y2="21"></line>
                                                        <line x1="12" y1="17" x2="12" y2="21"></line>
                                                    </svg>
                                                    ${item.server}
                                                </span>
                                            ` : ''}
                                        </div>
                                        
                                        ${item.tag && item.tag.length > 0 ? `
                                            <div class="content-tags">
                                                ${item.tag.map(tag => `<span class="tag">${tag}</span>`).join('')}
                                            </div>
                                        ` : ''}
                                        
                                        <div class="content-footer">
                                            <span class="timestamp">${item.time_update || ''}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    gridHtml += '</div>';
                    $listContainer.html(gridHtml);

                    // 渲染分页
                    var paginationHtml = PageUp.generatePagination({
                        currentPage: data.page,
                        totalPages: data.total_pages,
                        onPageChange: function(page) {
                            self.currentPage = page;
                            self.loadWebsites();
                        }
                    }, self.container);
                    self.container.find('.module-pagination').html(paginationHtml);
                } else {
                    $listContainer.html('<div class="text-center text-muted p-5"><h4>暂无网站数据</h4></div>');
                    self.container.find('.module-pagination').html('');
                }
                // 执行回调
                if (callback) callback();
            },
            error: function() {
                $listContainer.html('<div class="text-center text-danger p-5"><h4>加载失败</h4></div>');
                if (callback) callback();
            }
        });
    };

    this.bindEvents = function() {
        var self = this;

        // 刷新按钮
        this.container.on('click', '#refreshWebsites', function() {
            self.currentPage = 1;
            self.loadWebsites(function() {
                alert('刷新完成');
            });
        });

        // 搜索按钮
        this.container.on('click', '#searchBtn', function() {
            self.searchKeyword = $('#searchWebsite').val();
            self.searchField = $('#searchField').val();
            self.currentPage = 1;
            self.loadWebsites();
        });

        // 清除搜索按钮
        this.container.on('click', '#clearSearchBtn', function() {
            $('#searchWebsite').val('');
            self.searchKeyword = '';
            self.searchField = 'url';
            $('#searchField').val('url');
            self.currentPage = 1;
            self.loadWebsites();
        });

        // 搜索框回车搜索
        this.container.on('keypress', '#searchWebsite', function(e) {
            if (e.which === 13) {
                $('#searchBtn').click();
            }
        });

        // 查看详情 - 限制在网站容器内
        this.container.on('click', '.view-detail', function(e) {
            e.stopPropagation();
            e.preventDefault();
            var id = $(this).data('id');
            self.showDetailModal(id);
        });

        // 删除网站 - 限制在网站容器内
        this.container.on('click', '.delete-website', function(e) {
            e.stopPropagation();
            e.preventDefault();
            var id = $(this).data('id');
            if (confirm('确定要删除这条网站数据吗？')) {
                $.ajax({
                    url: '/api/assets/websites/' + id,
                    type: 'DELETE',
                    success: function(data) {
                        if (data.success) {
                            alert(data.message);
                            self.loadWebsites();
                        } else {
                            alert(data.message);
                        }
                    }
                });
            }
        });

        // 点击截图放大显示
        this.container.on('click', '.website-hero', function(e) {
            // 避免点击操作按钮时触发
            if ($(e.target).closest('.action-btn').length) {
                return;
            }
            var src = $(this).data('src');
            if (src) {
                self.showImageModal(src);
            }
        });
    };

    this.showDetailModal = function(id) {
        var self = this;
        $.ajax({
            url: '/api/assets/websites/' + id,
            type: 'GET',
            success: function(data) {
                if (data.success && data.website) {
                    var website = data.website;

                    // 处理标签显示
                    var tagsHtml = '';
                    if (website.tag && website.tag.length > 0) {
                        tagsHtml = website.tag.map(function(tag) {
                            return '<span class="detail-tag">' + tag + '</span>';
                        }).join('');
                    }

                    // 状态码颜色
                    var statusClass = 'info';
                    if (website.http_status_code >= 200 && website.http_status_code < 300) {
                        statusClass = 'success';
                    } else if (website.http_status_code >= 300 && website.http_status_code < 400) {
                        statusClass = 'warning';
                    } else if (website.http_status_code >= 400) {
                        statusClass = 'danger';
                    }

                    // 截图区域
                    var screenshotSection = '';
                    if (website.screenshot) {
                        screenshotSection = `
                            <div class="detail-screenshot" data-src="/${website.screenshot}">
                                <img src="/${website.screenshot}" alt="网站截图">
                            </div>`;
                    }

                    var modalHtml = `
                        <div class="modal" id="websiteDetailModal">
                            <div class="modal-content website-detail-modal">
                                <div class="modal-header">
                                    <h5 class="modal-title">网站详情</h5>
                                    <button type="button" class="modal-close">&times;</button>
                                </div>
                                <div class="modal-body">
                                    ${screenshotSection}

                                    <!-- 核心信息 -->
                                    <div class="detail-section">
                                        <div class="detail-main-info">
                                            ${website.url ? '<div class="detail-url"><a href="' + website.url + '" target="_blank">' + website.url + '</a></div>' : ''}
                                            ${website.title ? '<div class="detail-title">' + website.title + '</div>' : ''}
                                        </div>
                                        <div class="detail-meta-grid">
                                            ${website.http_status_code ? '<div class="detail-meta-item"><span class="meta-label">状态码</span><span class="status-badge status-' + statusClass + '" style="min-width:auto;height:28px;border-radius:6px;font-size:13px;"><span class="status-number">' + website.http_status_code + '</span></span></div>' : ''}
                                            ${website.method ? '<div class="detail-meta-item"><span class="meta-label">方法</span><span class="meta-value">' + website.method + '</span></div>' : ''}
                                            ${website.port ? '<div class="detail-meta-item"><span class="meta-label">端口</span><span class="meta-value">' + website.port + '</span></div>' : ''}
                                            ${website.server ? '<div class="detail-meta-item"><span class="meta-label">服务器</span><span class="meta-value">' + website.server + '</span></div>' : ''}
                                            ${website.subdomain ? '<div class="detail-meta-item"><span class="meta-label">子域名</span><span class="meta-value">' + website.subdomain + '</span></div>' : ''}
                                            ${website.domain ? '<div class="detail-meta-item"><span class="meta-label">域名</span><span class="meta-value">' + website.domain + '</span></div>' : ''}
                                            ${website.web_fingerprint ? '<div class="detail-meta-item"><span class="meta-label">Web指纹</span><span class="meta-value">' + website.web_fingerprint + '</span></div>' : ''}
                                        </div>
                                    </div>

                                    ${tagsHtml ? `
                                    <!-- 标签 -->
                                    <div class="detail-section">
                                        <div class="detail-tags">${tagsHtml}</div>
                                    </div>` : ''}

                                    <!-- 时间信息（折叠） -->
                                    <details class="detail-extra">
                                        <summary>更多详细信息</summary>
                                        <div class="detail-extra-content">
                                            ${website.time_first ? '<div class="detail-meta-item"><span class="meta-label">首次访问</span><span class="meta-value">' + website.time_first + '</span></div>' : ''}
                                            ${website.time_update ? '<div class="detail-meta-item"><span class="meta-label">更新时间</span><span class="meta-value">' + website.time_update + '</span></div>' : ''}
                                            ${website.html_md5 ? '<div class="detail-meta-item"><span class="meta-label">HTML MD5</span><span class="meta-value mono">' + website.html_md5 + '</span></div>' : ''}
                                            ${website.html_len ? '<div class="detail-meta-item"><span class="meta-label">HTML长度</span><span class="meta-value">' + website.html_len + '</span></div>' : ''}
                                        </div>
                                    </details>
                                </div>
                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary modal-close-btn">关闭</button>
                                </div>
                            </div>
                        </div>
                    `;

                    $('body').append(modalHtml);
                    $('#websiteDetailModal').addClass('active');

                    // 点击截图放大
                    $('#websiteDetailModal').on('click', '.detail-screenshot', function() {
                        var src = $(this).data('src');
                        if (src) {
                            self.showImageModal(src);
                        }
                    });

                    // 关闭modal
                    $('#websiteDetailModal').on('click', '.modal-close, .modal-close-btn', function() {
                        $('#websiteDetailModal').removeClass('active');
                        setTimeout(function() {
                            $('#websiteDetailModal').remove();
                        }, 300);
                    });

                    // 点击modal外部关闭
                    $('#websiteDetailModal').on('click', function(e) {
                        if (e.target === this) {
                            $(this).removeClass('active');
                            setTimeout(function() {
                                $(this).remove();
                            }, 300);
                        }
                    });
                } else {
                    // 静默处理错误
                }
            },
            error: function() {
                alert('请求失败，请检查网络连接');
            }
        });
    };

    this.showImageModal = function(src) {
        // 移除已存在的图片模态框
        $('#imageModal').remove();

        var modalHtml = `
            <div class="modal" id="imageModal" style="display: flex; align-items: center; justify-content: center; background: transparent;">
                <div style="position: relative; max-width: 90vw; max-height: 90vh;">
                    <img src="${src}" alt="截图" style="max-width: 90vw; max-height: 90vh; border-radius: 4px;">
                    <button class="modal-close" style="position: absolute; top: -36px; right: 0; background: rgba(0,0,0,0.5); border: none; color: white; font-size: 24px; cursor: pointer; border-radius: 4px; width: 32px; height: 32px; line-height: 1;">&times;</button>
                </div>
            </div>
        `;

        $('body').append(modalHtml);
        $('#imageModal').fadeIn(200);

        // 关闭modal
        $('#imageModal').on('click', function(e) {
            if (e.target === this || $(e.target).hasClass('modal-close')) {
                $('#imageModal').fadeOut(200, function() {
                    $(this).remove();
                });
            }
        });
    };
}
