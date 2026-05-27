function HtmlModule() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.searchKeyword = '';
    this.searchType = 'md5';

    this.render = function(data, container) {
        // 保存容器引用
        this.container = container;

        container.html(`
            <div class="card">
                <div class="card-header">
                    <div class="row">
                        <div class="col-md-6">HTML大文件管理</div>
                        <div class="col-md-6 text-right">
                            <button class="btn btn-primary" id="refreshHtml">刷新</button>
                            <button class="btn btn-warning" id="clearHtml">清空</button>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <div class="row mb-3">
                        <div class="col-md-1">
                            <select class="form-control" id="searchType">
                                <option value="md5">MD5</option>
                                <option value="html">HTML内容</option>
                            </select>
                        </div>
                        <div class="col-md-5">
                            <input type="text" class="form-control" id="searchHtml" placeholder="搜索MD5或HTML内容...">
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
                                    <th>MD5</th>
                                    <th>HTML长度</th>
                                    <th style="width:100px;">状态</th>
                                    <th>时间</th>
                                    <th style="width:140px;">操作</th>
                                </tr>
                            </thead>
                            <tbody id="htmlList"></tbody>
                        </table>
                    </div>
                    <div id="htmlPagination" class="module-pagination"></div>
                </div>
            </div>
        `);
        this.loadHtml();
        this.bindEvents();
    };

    this.loadHtml = function() {
        var self = this;
        $.ajax({
            url: '/api/assets/html',
            type: 'GET',
            data: {
                page: self.currentPage,
                page_size: self.pageSize,
                search_keyword: self.searchKeyword,
                search_type: self.searchType,
                sort_by: 'time',
                sort_order: -1
            },
            success: function(data) {
                var tbody = $('#htmlList');
                tbody.empty();
                if (data.htmls && data.htmls.length > 0) {
                    data.htmls.forEach(function(item) {
                        var sizeDisplay = item.html_len || 0;
                        if (sizeDisplay > 1024 * 1024) {
                            sizeDisplay = (sizeDisplay / 1024 / 1024).toFixed(2) + ' MB';
                        } else if (sizeDisplay > 1024) {
                            sizeDisplay = (sizeDisplay / 1024).toFixed(2) + ' KB';
                        } else {
                            sizeDisplay = sizeDisplay + ' B';
                        }

                        var $tr = $('<tr>');
                        $('<td>').append($('<code>').text(item.html_md5 || 'N/A')).appendTo($tr);
                        $('<td>').text(sizeDisplay).appendTo($tr);

                        var statusText = item.status === 1 ? '已处理' : '未处理';
                        var statusClass = item.status === 1 ? 'success' : 'secondary';
                        $('<td>').append($('<span>').addClass('badge badge-' + statusClass).text(statusText)).appendTo($tr);

                        $('<td>').text(item.time || '').appendTo($tr);

                        var $tdActions = $('<td>').css({ 'white-space': 'nowrap', 'text-align': 'center' });
                        $('<button>').addClass('btn btn-info btn-sm view-detail').attr({
                            'data-md5': item.html_md5,
                            'style': 'min-width:60px;padding:6px 12px;font-size:13px;border-radius:8px;margin-right:4px;'
                        }).text('详情').appendTo($tdActions);
                        $('<button>').addClass('btn btn-danger btn-sm delete-html').attr({
                            'data-md5': item.html_md5,
                            'style': 'min-width:60px;padding:6px 12px;font-size:13px;border-radius:8px;'
                        }).text('删除').appendTo($tdActions);
                        $tr.append($tdActions);

                        tbody.append($tr);
                    });

                    var paginationHtml = PageUp.generatePagination({
                        currentPage: data.page,
                        totalPages: data.total_pages,
                        onPageChange: function(page) {
                            self.currentPage = page;
                            self.loadHtml();
                        }
                    }, self.container);
                    self.container.find('.module-pagination').html(paginationHtml);
                } else {
                    tbody.append('<tr><td colspan="5" class="text-center text-muted">暂无HTML数据</td></tr>');
                    self.container.find('.module-pagination').html('');
                }
            },
            error: function(xhr) {
                var tbody = $('#htmlList');
                tbody.empty();
                if (xhr.status === 404 || xhr.status === 500) {
                    tbody.append('<tr><td colspan="5" class="text-center text-muted">暂无项目或暂无数据</td></tr>');
                } else {
                    tbody.append('<tr><td colspan="5" class="text-center text-danger">加载失败，请重试</td></tr>');
                }
                self.container.find('.module-pagination').html('');
            }
        });
    };

    this.bindEvents = function() {
        var self = this;

        // 刷新按钮
        this.container.on('click', '#refreshHtml', function() {
            self.currentPage = 1;
            self.loadHtml();
        });

        // 清空按钮
        this.container.on('click', '#clearHtml', function() {
            if (confirm('确定要清空所有HTML数据吗？')) {
                $.ajax({
                    url: '/api/assets/html/clear',
                    type: 'POST',
                    success: function(data) {
                        if (data.success) {
                            alert(data.message);
                            self.currentPage = 1;
                            self.loadHtml();
                        } else {
                            alert(data.message);
                        }
                    }
                });
            }
        });

        // 搜索按钮
        this.container.on('click', '#searchBtn', function() {
            self.searchType = $('#searchType').val();
            self.searchKeyword = $('#searchHtml').val();
            self.currentPage = 1;
            self.loadHtml();
        });

        // 清除搜索按钮
        this.container.on('click', '#clearSearchBtn', function() {
            $('#searchHtml').val('');
            self.searchKeyword = '';
            self.currentPage = 1;
            self.loadHtml();
        });

        // 搜索框回车搜索
        this.container.on('keypress', '#searchHtml', function(e) {
            if (e.which === 13) {
                $('#searchBtn').click();
            }
        });

        // 查看详情
        this.container.on('click', '.view-detail', function() {
            var md5 = $(this).data('md5');
            self.showDetailModal(md5);
        });

        // 删除HTML（通过 html_md5 删除）
        this.container.on('click', '.delete-html', function() {
            var md5 = $(this).data('md5');
            if (confirm('确定要删除这条HTML数据吗？')) {
                // 通过 md5 查找并删除
                $.ajax({
                    url: '/api/assets/html/' + md5,
                    type: 'GET',
                    success: function(data) {
                        if (data.success && data.html && data.html._id) {
                            $.ajax({
                                url: '/api/assets/html/' + data.html._id,
                                type: 'DELETE',
                                success: function(delData) {
                                    if (delData.success) {
                                        alert(delData.message);
                                        self.loadHtml();
                                    } else {
                                        alert(delData.message);
                                    }
                                }
                            });
                        } else {
                            alert('HTML数据不存在');
                        }
                    }
                });
            }
        });
    };

    this.showDetailModal = function(md5) {
        var self = this;
        $.ajax({
            url: '/api/assets/html/' + md5,
            type: 'GET',
            success: function(data) {
                if (data.success && data.html) {
                    var html = data.html;

                    var sizeDisplay = html.html_len || 0;
                    if (sizeDisplay > 1024 * 1024) {
                        sizeDisplay = (sizeDisplay / 1024 / 1024).toFixed(2) + ' MB';
                    } else if (sizeDisplay > 1024) {
                        sizeDisplay = (sizeDisplay / 1024).toFixed(2) + ' KB';
                    } else {
                        sizeDisplay = sizeDisplay + ' B';
                    }

                    // 用 DOM 构建，防止 XSS
                    var $modal = $('<div class="modal" id="htmlDetailModal">');
                    var $content = $('<div class="modal-content" style="max-width: 900px;">');

                    // header
                    var $header = $('<div class="modal-header">');
                    $header.append($('<h5 class="modal-title">').text('HTML详情'));
                    $header.append($('<button type="button" class="modal-close">').text('\u00D7'));
                    $content.append($header);

                    // body
                    var $body = $('<div class="modal-body">');

                    // MD5
                    var $group1 = $('<div class="form-group">');
                    $group1.append($('<label>').text('MD5'));
                    $('<input type="text" class="form-control" readonly>').val(html.html_md5 || '').appendTo($group1);
                    $body.append($group1);

                    // HTML长度
                    var $group2 = $('<div class="form-group">');
                    $group2.append($('<label>').text('HTML长度'));
                    $('<input type="text" class="form-control" readonly>').val(sizeDisplay + ' (' + (html.html_len || 0) + ' bytes)').appendTo($group2);
                    $body.append($group2);

                    // 时间
                    var $group3 = $('<div class="form-group">');
                    $group3.append($('<label>').text('时间'));
                    $('<input type="text" class="form-control" readonly>').val(html.time || '').appendTo($group3);
                    $body.append($group3);

                    // HTML内容
                    var $group4 = $('<div class="form-group">');
                    $group4.append($('<label>').text('HTML内容'));
                    $('<textarea class="form-control" rows="20" readonly>').css({
                        'font-family': "'Consolas', 'Monaco', 'Courier New', monospace",
                        'font-size': '12px'
                    }).val(html.html || '').appendTo($group4);
                    $body.append($group4);

                    $content.append($body);

                    // footer
                    var $footer = $('<div class="modal-footer">');
                    $footer.append($('<button type="button" class="btn btn-secondary modal-close-btn">').text('关闭'));
                    $content.append($footer);

                    $modal.append($content);

                    $('body').append($modal);
                    $('#htmlDetailModal').addClass('active');

                    // 关闭modal
                    $('#htmlDetailModal').on('click', '.modal-close, .modal-close-btn', function() {
                        $('#htmlDetailModal').removeClass('active');
                        setTimeout(function() {
                            $('#htmlDetailModal').remove();
                        }, 300);
                    });

                    // 点击modal外部关闭
                    $('#htmlDetailModal').on('click', function(e) {
                        if (e.target === this) {
                            $(this).removeClass('active');
                            setTimeout(function() {
                                $(this).remove();
                            }, 300);
                        }
                    });
                } else {
                    console.log('获取HTML详情失败');
                }
            },
            error: function(xhr) {
                console.log('请求失败，状态码:', xhr.status);
            }
        });
    };
}
