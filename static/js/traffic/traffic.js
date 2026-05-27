function TrafficModule() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.sortBy = 'time';
    this.sortOrder = -1;
    this.searchUrl = '';

    this.render = function(data, container) {
        this.container = container;

        container.html(`
            <div class="card">
                <div class="card-header">
                    <div class="row">
                        <div class="col-md-6">HTTP流量</div>
                        <div class="col-md-6 text-right">
                            <button class="btn btn-primary" id="refreshTraffic">刷新</button>
                            <button class="btn btn-warning" id="clearTraffic">清空</button>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <div class="row mb-3">
                        <div class="col-md-4">
                            <input type="text" class="form-control" id="searchUrl" placeholder="搜索URL...">
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
                                    <th><a href="#" class="sort-link" data-sort="time">时间 <span class="sort-icon"></span></a></th>
                                    <th><a href="#" class="sort-link" data-sort="method">方法 <span class="sort-icon"></span></a></th>
                                    <th><a href="#" class="sort-link" data-sort="url">URL <span class="sort-icon"></span></a></th>
                                    <th><a href="#" class="sort-link" data-sort="website">Website <span class="sort-icon"></span></a></th>
                                    <th>来源</th>
                                    <th>状态</th>
                                    <th>扫描状态</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody id="trafficList"></tbody>
                        </table>
                    </div>
                    <div id="trafficPagination" class="module-pagination"></div>
                </div>
            </div>
        `);
        this.initSortIcon();
        this.loadTraffic();
        this.bindEvents();
    };

    this.initSortIcon = function() {
        // 初始化默认排序图标（时间降序）
        var icon = this.sortOrder === 1 ? '↑' : '↓';
        $(`[data-sort="${this.sortBy}"] .sort-icon`).text(icon);
    };

    this.loadTraffic = function() {
        var self = this;
        $.ajax({
            url: '/api/traffic/list',
            type: 'GET',
            data: {
                page: self.currentPage,
                page_size: self.pageSize,
                sort_by: self.sortBy,
                sort_order: self.sortOrder,
                search_url: self.searchUrl
            },
            success: function(data) {
                var tbody = $('#trafficList');
                tbody.empty();
                if (data.traffic) {
                    data.traffic.forEach(function(item) {
                        var scanerStatus = item.scaner_status === 1 ? '已扫描' : '未扫描';
                        var scanerClass = item.scaner_status === 1 ? 'text-success' : 'text-warning';
                        var $tr = $('<tr>');
                        $('<td>').text(item.time ? item.time.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : '').appendTo($tr);
                        $('<td>').text(item.method).appendTo($tr);
                        $('<td>').text(item.url).appendTo($tr);
                        $('<td>').addClass('website-cell').text(item.website).appendTo($tr);
                        var sourceText = item.source === 1 ? 'URL生成' : '流量捕捉';
                        var sourceClass = item.source === 1 ? 'text-info' : 'text-muted';
                        $('<td>').addClass(sourceClass).text(sourceText).appendTo($tr);
                        $('<td>').text(item.status).appendTo($tr);
                        $('<td>').addClass(scanerClass).text(scanerStatus).appendTo($tr);
                        var $tdAction = $('<td>');
                        $('<button>').addClass('btn btn-primary btn-sm traffic-view-detail').text('详情').attr('data-id', item._id).appendTo($tdAction);
                        $('<button>').addClass('btn btn-success btn-sm traffic-replay-request').text('重放').attr('data-id', item._id).appendTo($tdAction);
                        $('<button>').addClass('btn btn-danger btn-sm delete-traffic').text('删除').attr('data-id', item._id).appendTo($tdAction);
                        $tdAction.appendTo($tr);
                        tbody.append($tr);
                    });
                }

                // 渲染分页
                var paginationHtml = PageUp.generatePagination({
                    currentPage: data.page,
                    totalPages: data.total_pages,
                    onPageChange: function(page) {
                        self.currentPage = page;
                        self.loadTraffic();
                    }
                }, self.container);
                self.container.find('.module-pagination').html(paginationHtml);
            }
        });
    };

    this.bindEvents = function() {
        var self = this;

        // 刷新按钮
        $('#refreshTraffic').on('click', function() {
            self.loadTraffic();
        });

        // 清空按钮
        $('#clearTraffic').on('click', function() {
            if (confirm('确定要清空所有流量数据吗？')) {
                $.ajax({
                    url: '/api/traffic/clear',
                    type: 'POST',
                    success: function(data) {
                        alert(data.message);
                        self.loadTraffic();
                    }
                });
            }
        });

        // 搜索按钮
        $('#searchBtn').on('click', function() {
            self.searchUrl = $('#searchUrl').val();
            self.currentPage = 1; // 重置到第一页
            self.loadTraffic();
        });

        // 清除搜索按钮
        $('#clearSearchBtn').on('click', function() {
            $('#searchUrl').val('');
            self.searchUrl = '';
            self.currentPage = 1; // 重置到第一页
            self.loadTraffic();
        });

        // 搜索框回车搜索
        $('#searchUrl').on('keypress', function(e) {
            if (e.which === 13) { // Enter键
                $('#searchBtn').click();
            }
        });

        // 查看详情
        $(document).on('click', '.traffic-view-detail', function() {
            var id = $(this).data('id');
            self.showTrafficDetail(id);
        });

        // 重放请求
        $(document).on('click', '.traffic-replay-request', function() {
            var id = $(this).data('id');
            self.showReplay(id);
        });

        // 删除流量
        $(document).on('click', '.delete-traffic', function() {
            var id = $(this).data('id');
            if (confirm('确定要删除这条流量数据吗？')) {
                $.ajax({
                    url: '/api/traffic/delete/' + id,
                    type: 'POST',
                    success: function(data) {
                        if (data.success) {
                            alert(data.message);
                            self.loadTraffic();
                        } else {
                            alert(data.message);
                        }
                    }
                });
            }
        });

        // 排序功能
        $(document).on('click', '.sort-link', function(e) {
            e.preventDefault();
            var sortBy = $(this).data('sort');

            if (self.sortBy === sortBy) {
                // 切换排序顺序
                self.sortOrder = self.sortOrder === 1 ? -1 : 1;
            } else {
                // 新的排序字段
                self.sortBy = sortBy;
                self.sortOrder = 1;
            }

            // 更新排序图标
            $('.sort-icon').text('');
            var icon = self.sortOrder === 1 ? '↑' : '↓';
            $(this).find('.sort-icon').text(icon);

            // 重新加载数据
            self.currentPage = 1; // 重置到第一页
            self.loadTraffic();
        });
    };

    this.showTrafficDetail = function(id) {
        var self = this;
        $.ajax({
            url: '/api/traffic/detail/' + id,
            type: 'GET',
            success: function(data) {
                if (data.success) {
                    var traffic = data.traffic;
                    $('#trafficDetailModal').remove();

                    var $modal = $('<div>').addClass('modal').attr('id', 'trafficDetailModal');
                    var $modalContent = $('<div>').addClass('modal-content');

                    var $modalHeader = $('<div>').addClass('modal-header');
                    $('<h5>').addClass('modal-title').text('流量详情').appendTo($modalHeader);
                    $('<button>').addClass('modal-close').html('&times;').appendTo($modalHeader);

                    var $modalBody = $('<div>').addClass('modal-body');
                    var $viewModeButtons = $('<div>').addClass('view-mode-buttons');
                    $('<button>').addClass('btn btn-primary view-mode-btn active').attr('data-mode', 'json').text('JSON模式').appendTo($viewModeButtons);
                    $('<button>').addClass('btn btn-secondary view-mode-btn').attr('data-mode', 'burp').text('Burp格式').appendTo($viewModeButtons);
                    $('<button>').addClass('btn btn-secondary find-in-modal-btn').attr('id', 'findInModal').text('🔍 搜索').appendTo($viewModeButtons);
                    $viewModeButtons.appendTo($modalBody);

                    var jsonStr = JSON.stringify(traffic, null, 2);
                    var isTruncated = jsonStr.length > 102400;
                    var displayJson = isTruncated ? jsonStr.substring(0, 102400) : jsonStr;

                    var $jsonView = $('<div>').addClass('mt-3 view-content').attr('id', 'jsonView');
                    $('<pre>').addClass('modal-pre-content').attr('id', 'modalJsonPre').text(displayJson).appendTo($jsonView);
                    if (isTruncated) {
                        $('<div>').addClass('load-full-hint-modal').attr('id', 'loadFullJson').html('⬇️ 内容已截断，滚动到此处加载全文').appendTo($jsonView);
                    }
                    $jsonView.appendTo($modalBody);

                    var $burpView = $('<div>').addClass('mt-3 view-content').attr('id', 'burpView').hide();
                    $('<pre>').addClass('modal-pre-content').attr('id', 'modalBurpPre').text(self.formatAsBurp(traffic)).appendTo($burpView);
                    $burpView.appendTo($modalBody);

                    var $findBar = $('<div>').addClass('find-bar-modal').attr('id', 'modalFindBar').hide();
                    $findBar.html('<input type="text" id="modalFindInput" placeholder="搜索..."/><span class="find-count" id="modalFindCount"></span><button class="find-btn" id="modalFindPrev">↑</button><button class="find-btn" id="modalFindNext">↓</button><button class="find-btn find-close-btn" id="modalFindClose">✕</button>');
                    $modalBody.append($findBar);

                    var $modalFooter = $('<div>').addClass('modal-footer');
                    $('<button>').addClass('btn btn-secondary modal-close-btn').text('关闭').appendTo($modalFooter);

                    $modalContent.append($modalHeader, $modalBody, $modalFooter);
                    $modal.append($modalContent);
                    $('body').append($modal);
                    setTimeout(function() {
                        $('#trafficDetailModal').addClass('active');
                    }, 10);

                    var fullJsonLoaded = false;
                    if (isTruncated) {
                        $jsonView.on('scroll', function() {
                            if (fullJsonLoaded) return;
                            var scrollTop = $jsonView.scrollTop();
                            var scrollHeight = $jsonView[0].scrollHeight;
                            var clientHeight = $jsonView.height();
                            if (scrollTop + clientHeight >= scrollHeight - 50) {
                                fullJsonLoaded = true;
                                $('#loadFullJson').html('加载全文中...');
                                $('#modalJsonPre').text(jsonStr);
                                $('#loadFullJson').html('✅ 全文已加载');
                            }
                        });
                    }

                    $('#findInModal').on('click', function() {
                        var $bar = $('#modalFindBar');
                        if ($bar.is(':visible')) {
                            $bar.hide();
                            self._clearModalHighlights();
                        } else {
                            $bar.show();
                            $('#modalFindInput').focus();
                        }
                    });

                    $('#modalFindInput').on('input', function() {
                        self._doModalFind($(this).val());
                    });

                    $('#modalFindInput').on('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            self._navigateModalFind(e.shiftKey ? -1 : 1);
                        } else if (e.key === 'Escape') {
                            $('#modalFindBar').hide();
                            self._clearModalHighlights();
                        }
                    });

                    $('#modalFindNext').on('click', function() { self._navigateModalFind(1); });
                    $('#modalFindPrev').on('click', function() { self._navigateModalFind(-1); });
                    $('#modalFindClose').on('click', function() {
                        $('#modalFindBar').hide();
                        self._clearModalHighlights();
                    });

                    $('#trafficDetailModal').on('click', '.view-mode-btn', function() {
                        var mode = $(this).data('mode');
                        $('#trafficDetailModal .view-mode-btn').removeClass('active');
                        $(this).addClass('active');

                        if (mode === 'json') {
                            $('#trafficDetailModal #jsonView').show();
                            $('#trafficDetailModal #burpView').hide();
                        } else {
                            $('#trafficDetailModal #jsonView').hide();
                            $('#trafficDetailModal #burpView').show();
                        }
                        self._clearModalHighlights();
                        $('#modalFindInput').val('').trigger('input');
                    });

                    $('#trafficDetailModal').on('click', '.modal-close, .modal-close-btn', function() {
                        $('#trafficDetailModal').removeClass('active');
                        setTimeout(function() {
                            $('#trafficDetailModal').remove();
                        }, 300);
                    });

                    $('#trafficDetailModal').on('click', function(e) {
                        if (e.target === this) {
                            $(this).removeClass('active');
                            setTimeout(function() {
                                $(this).remove();
                            }, 300);
                        }
                    });
                } else {
                    alert(data.message);
                }
            }
        });
    };

    this._doModalFind = function(keyword) {
        this._clearModalHighlights();
        if (!keyword) {
            $('#modalFindCount').text('');
            return;
        }
        var $activePre = $('#jsonView').is(':visible') ? $('#modalJsonPre') : $('#modalBurpPre');
        if (!$activePre.length) return;

        var text = $activePre.text();
        var lowerText = text.toLowerCase();
        var lowerKeyword = keyword.toLowerCase();
        var matches = [];
        var pos = 0;
        while ((pos = lowerText.indexOf(lowerKeyword, pos)) !== -1) {
            matches.push(pos);
            pos += 1;
        }

        $('#modalFindCount').text(matches.length > 0 ? '1/' + matches.length : '0/0');
        if (matches.length === 0) return;

        this._modalFindMatches = matches;
        this._modalFindIndex = 0;

        var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp('(' + escaped + ')', 'gi');
        var html = this._escapeModalHtml(text).replace(re, '<mark class="find-highlight">$1</mark>');
        $activePre.html(html);
        this._scrollModalToMatch(0);
    };

    this._navigateModalFind = function(direction) {
        if (!this._modalFindMatches || this._modalFindMatches.length === 0) return;
        this._modalFindIndex += direction;
        if (this._modalFindIndex >= this._modalFindMatches.length) this._modalFindIndex = 0;
        if (this._modalFindIndex < 0) this._modalFindIndex = this._modalFindMatches.length - 1;
        this._scrollModalToMatch(this._modalFindIndex);
        $('#modalFindCount').text((this._modalFindIndex + 1) + '/' + this._modalFindMatches.length);
    };

    this._scrollModalToMatch = function(index) {
        var $highlights = $('#trafficDetailModal .find-highlight');
        $highlights.removeClass('find-current');
        if ($highlights.length > index) {
            var $target = $($highlights[index]);
            $target.addClass('find-current');
            var $container = $target.closest('.view-content');
            var targetOffset = $target.position().top - $container.position().top;
            $container.scrollTop($container.scrollTop() + targetOffset - $container.height() / 3);
        }
    };

    this._clearModalHighlights = function() {
        var $jsonPre = $('#modalJsonPre');
        var $burpPre = $('#modalBurpPre');
        if ($jsonPre.length) {
            var jsonText = $jsonPre.text();
            $jsonPre.html(this._escapeModalHtml(jsonText));
        }
        if ($burpPre.length) {
            var burpText = $burpPre.text();
            $burpPre.html(this._escapeModalHtml(burpText));
        }
        this._modalFindMatches = null;
        this._modalFindIndex = 0;
    };

    this._escapeModalHtml = function(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    this.formatAsBurp = function(traffic) {
        var method = traffic.method || 'GET';
        var url = traffic.url || '';
        var headers = traffic.headers || {};
        var body = traffic.body || '';
        var bodyEncoding = traffic.body_encoding || 'plain';

        var burpFormat = `${method} ${url} HTTP/1.1\n`;

        // 添加headers
        for (var key in headers) {
            burpFormat += `${key}: ${headers[key]}\n`;
        }

        burpFormat += '\n';

        // 添加body
        if (body) {
            if (bodyEncoding === 'base64') {
                burpFormat += '[Binary data encoded as base64 - ' + body.length + ' chars]';
            } else {
                burpFormat += body;
            }
        }

        return burpFormat;
    };

    this.showReplay = function(id) {
        var self = this;
        $.ajax({
            url: '/api/traffic/detail/' + id,
            type: 'GET',
            success: function(data) {
                if (data.success) {
                    var traffic = data.traffic;

                    // 准备初始数据（以JSON为权威数据源，避免Burp格式有损转换丢失headers）
                    var initialData = {
                        mode: 'json', // 使用json模式，确保数据完整
                        jsonData: JSON.stringify(traffic, null, 2)
                    };

                    // 打开新的tab进行重放
                    TabManager.openTab('tools/replay', 'HTTP请求重放', {
                        subModule: 'replay',
                        initialData: initialData
                    });
                } else {
                    alert(data.message);
                }
            }
        });
    };
}