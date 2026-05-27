function CaptureModule() {
    this.selectedId = null;
    this.autoRefresh = true;
    this.refreshTimer = null;
    this.contextMenuTarget = null;
    this.projectFilter = false;
    this._fullRespText = '';
    this._fullReqText = '';
    this._findMatches = [];
    this._findCurrentIdx = -1;
    this._findTarget = '';
    this._socket = null;
    this._socketReady = false;
    this._pendingItems = [];
    this._MAX_DISPLAY = 300;

    this.render = function(data, container) {
        this.container = container;

        container.html(`
<div class="capture-page">
    <div class="capture-toolbar">
        <div class="toolbar-left">
            <h3 class="capture-title">🔍 HTTP捕捉</h3>
            <span class="capture-count" id="captureCount">0 条记录</span>
        </div>
        <div class="toolbar-right">
            <label class="auto-refresh-label">
                <input type="checkbox" id="autoRefresh" checked>
                <span>自动刷新</span>
            </label>
            <label class="auto-refresh-label">
                <input type="checkbox" id="projectFilter">
                <span>项目过滤</span>
            </label>
            <button class="btn btn-primary btn-sm" id="refreshCapture">刷新</button>
            <button class="btn btn-danger btn-sm" id="clearCapture">清空</button>
        </div>
    </div>

    <div class="capture-main">
        <div class="capture-list-panel">
            <div class="capture-new-bar" id="captureNewBar" style="display:none;">
                <span id="captureNewCount"></span> 条新流量，点击加载
            </div>
            <table class="capture-table">
                <thead>
                    <tr>
                        <th class="col-method">方法</th>
                        <th class="col-url">URL</th>
                        <th class="col-ext">后缀</th>
                        <th class="col-status">状态</th>
                        <th class="col-type">类型</th>
                        <th class="col-time">时间</th>
                    </tr>
                </thead>
                <tbody id="captureList"></tbody>
            </table>
        </div>
        <div class="capture-resizer" id="captureResizer"></div>
        <div class="capture-detail-panel" id="captureDetail">
            <div class="detail-empty">
                <div class="empty-icon">📨</div>
                <p>点击左侧流量查看请求/响应详情</p>
            </div>
        </div>
    </div>
</div>
        `);

        if ($('#captureContextMenu').length === 0) {
            $('body').append(`
<div class="capture-context-menu" id="captureContextMenu" style="display:none;">
    <div class="ctx-item" data-action="replay">🔄 重放请求</div>
    <div class="ctx-item" data-action="scan">🔓 漏洞检测</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-action="copy-url">📋 复制URL</div>
    <div class="ctx-item" data-action="copy-domain">📋 复制域名</div>
</div>
            `);
        }

        this.bindEvents();
        this.loadCaptureList();
        this.startAutoRefresh();
    };

    this.loadCaptureList = function() {
        var self = this;
        self._pendingItems = [];
        self.container.find('#captureNewBar').hide();
        var url = '/api/capture/list';
        if (self.projectFilter) {
            url += '?filter=project';
        }
        $.ajax({
            url: url,
            type: 'GET',
            success: function(resp) {
                if (resp.success) {
                    self.renderList(resp.data);
                    $('#captureCount').text(resp.count + ' 条记录');
                }
            }
        });
    };

    this.renderList = function(items) {
        var self = this;
        var tbody = this.container.find('#captureList');
        var $panel = this.container.find('.capture-list-panel');
        var wasAtTop = $panel.scrollTop() <= 5;

        tbody.empty();

        if (!items || items.length === 0) {
            tbody.html('<tr><td colspan="6" class="empty-row">暂无捕捉数据</td></tr>');
            return;
        }

        items.forEach(function(item) {
            var methodClass = self.getMethodClass(item.method);
            var statusClass = self.getStatusClass(item.status_code);
            var $tr = $('<tr>')
                .attr('data-id', item._id)
                .addClass(self.selectedId === item._id ? 'selected' : '');

            $('<td>').addClass('method-cell').html('<span class="method-badge ' + methodClass + '">' + self.escapeHtml(item.method) + '</span>').appendTo($tr);
            $('<td>').addClass('url-cell').text(item.url).appendTo($tr);
            $('<td>').addClass('ext-cell').html('<span class="ext-badge">' + self.escapeHtml(item.extension || '-') + '</span>').appendTo($tr);
            $('<td>').addClass('status-cell').html('<span class="status-badge ' + statusClass + '">' + (item.status_code || '-') + '</span>').appendTo($tr);
            var typeInfo = self._classifyContentType(item.content_type || '');
            $('<td>').addClass('type-cell').html('<span class="type-badge type-' + typeInfo.cls + '">' + typeInfo.label + '</span>').appendTo($tr);
            $('<td>').addClass('time-cell').text(item.time ? item.time.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : '-').appendTo($tr);

            tbody.append($tr);
        });

        if (self.selectedId) {
            var $selectedRow = tbody.find('tr[data-id="' + self.selectedId + '"]');
            if ($selectedRow.length) {
                var rowTop = $selectedRow[0].offsetTop;
                var panelHeight = $panel.height();
                if (rowTop < $panel.scrollTop() || rowTop > $panel.scrollTop() + panelHeight - $selectedRow.height()) {
                    $panel.scrollTop(rowTop - panelHeight / 3);
                }
            }
        } else if (wasAtTop) {
            $panel.scrollTop(0);
        }
    };

    this.showDetail = function(id) {
        var self = this;
        this.selectedId = id;

        this.container.find('.capture-table tr').removeClass('selected');
        this.container.find('.capture-table tr[data-id="' + id + '"]').addClass('selected');

        $.ajax({
            url: '/api/capture/detail/' + id,
            type: 'GET',
            success: function(resp) {
                if (resp.success) {
                    self.renderDetail(resp.data);
                }
            }
        });
    };

    this.renderDetail = function(data) {
        var self = this;
        var detailPanel = this.container.find('#captureDetail');
        var reqData = data.request || {};
        var respData = data.response || {};

        var reqBurp = this.formatAsBurp(reqData);
        var respBurp = this.formatResponseAsBurp(respData);

        this._fullReqText = reqBurp;
        this._fullRespText = respBurp;

        var MAX_SIZE = 102400;
        var reqTruncated = reqBurp.length > MAX_SIZE;
        var respTruncated = respBurp.length > MAX_SIZE;
        var displayReq = reqTruncated ? reqBurp.substring(0, MAX_SIZE) : reqBurp;
        var displayResp = respTruncated ? respBurp.substring(0, MAX_SIZE) : respBurp;

        var reqHint = reqTruncated ? '<div class="capture-load-hint" data-target="req">⬇️ 内容已截断，滚动到底部加载全文 (' + self._formatSize(reqBurp.length) + ')</div>' : '';
        var respHint = respTruncated ? '<div class="capture-load-hint" data-target="resp">⬇️ 内容已截断，滚动到底部加载全文 (' + self._formatSize(respBurp.length) + ')</div>' : '';

        detailPanel.html(`
<div class="detail-content">
    <div class="capture-find-bar" id="captureFindBar" style="display:none;">
        <input type="text" id="captureFindInput" placeholder="搜索..." />
        <span class="capture-find-count" id="captureFindCount"></span>
        <button class="capture-find-btn" id="captureFindPrev">↑</button>
        <button class="capture-find-btn" id="captureFindNext">↓</button>
        <button class="capture-find-btn capture-find-close" id="captureFindClose">✕</button>
    </div>
    <div class="detail-panels">
        <div class="detail-request">
            <div class="detail-section-header">
                <span class="section-label">📤 请求</span>
                <div class="detail-header-actions">
                    <button class="btn btn-sm btn-outline capture-hex-btn" data-target="req">🔢 Hex</button>
                    <button class="btn btn-sm btn-outline capture-find-target-btn" data-target="req" title="搜索请求">🔍</button>
                    <button class="btn btn-sm btn-outline copy-btn" data-target="reqBody">复制</button>
                </div>
            </div>
            <pre class="detail-pre has-line-numbers" id="reqBody">${this._addLineNumbers(this.escapeHtml(displayReq))}</pre>
            <div class="capture-hex-container" id="reqHexContainer" style="display:none;"></div>
            ${reqHint}
        </div>
        <div class="detail-response">
            <div class="detail-section-header">
                <span class="section-label">📥 响应</span>
                <div class="detail-header-actions">
                    <button class="btn btn-sm btn-outline capture-hex-btn" data-target="resp">🔢 Hex</button>
                    <button class="btn btn-sm btn-outline capture-find-target-btn" data-target="resp" title="搜索响应">🔍</button>
                    <button class="btn btn-sm btn-outline copy-btn" data-target="respBody">复制</button>
                </div>
            </div>
            <pre class="detail-pre has-line-numbers" id="respBody">${this._addLineNumbers(this.escapeHtml(displayResp))}</pre>
            <div class="capture-hex-container" id="respHexContainer" style="display:none;"></div>
            ${respHint}
        </div>
    </div>
</div>
        `);

        if (reqTruncated) {
            var $reqPre = detailPanel.find('#reqBody');
            $reqPre.off('scroll.captureLoad').on('scroll.captureLoad', function() {
                if ($reqPre.scrollTop() + $reqPre.height() >= $reqPre[0].scrollHeight - 30) {
                    $reqPre.off('scroll.captureLoad');
                    $reqPre.html(self._addLineNumbers(self.escapeHtml(self._fullReqText)));
                    detailPanel.find('.capture-load-hint[data-target="req"]').remove();
                }
            });
        }
        if (respTruncated) {
            var $respPre = detailPanel.find('#respBody');
            $respPre.off('scroll.captureLoad').on('scroll.captureLoad', function() {
                if ($respPre.scrollTop() + $respPre.height() >= $respPre[0].scrollHeight - 30) {
                    $respPre.off('scroll.captureLoad');
                    $respPre.html(self._addLineNumbers(self.escapeHtml(self._fullRespText)));
                    detailPanel.find('.capture-load-hint[data-target="resp"]').remove();
                    self._applyHighlight($respPre[0], self._detectLangFromResp(respData));
                }
            });
        }

        if (window.SpeedHighlight) {
            var reqPre = detailPanel.find('#reqBody')[0];
            var respPre = detailPanel.find('#respBody')[0];
            if (reqPre) {
                self._applyHighlight(reqPre, 'http');
            }
            if (respPre) {
                var respLang = self._detectLangFromResp(respData);
                self._applyHighlight(respPre, respLang);
            }
        }
    };

    this._classifyContentType = function(ct) {
        if (!ct) return { cls: 'other', label: '-' };
        var lower = ct.toLowerCase();
        if (lower.indexOf('text/html') >= 0) return { cls: 'html', label: 'HTML' };
        if (lower.indexOf('application/xhtml') >= 0) return { cls: 'html', label: 'HTML' };
        if (lower.indexOf('text/javascript') >= 0 || lower.indexOf('application/javascript') >= 0 || lower.indexOf('application/x-javascript') >= 0) return { cls: 'js', label: 'JS' };
        if (lower.indexOf('text/css') >= 0) return { cls: 'css', label: 'CSS' };
        if (lower.indexOf('application/json') >= 0) return { cls: 'json', label: 'JSON' };
        if (lower.indexOf('application/xml') >= 0 || lower.indexOf('text/xml') >= 0) return { cls: 'xml', label: 'XML' };
        if (lower.indexOf('image/') >= 0) return { cls: 'img', label: 'IMG' };
        if (lower.indexOf('application/pdf') >= 0) return { cls: 'pdf', label: 'PDF' };
        if (lower.indexOf('application/octet-stream') >= 0) return { cls: 'bin', label: 'BIN' };
        if (lower.indexOf('text/plain') >= 0) return { cls: 'txt', label: 'TXT' };
        if (lower.indexOf('multipart/form-data') >= 0) return { cls: 'form', label: 'FORM' };
        if (lower.indexOf('application/x-www-form-urlencoded') >= 0) return { cls: 'form', label: 'FORM' };
        if (lower.indexOf('font/') >= 0 || lower.indexOf('application/font') >= 0) return { cls: 'font', label: 'FONT' };
        if (lower.indexOf('audio/') >= 0 || lower.indexOf('video/') >= 0) return { cls: 'media', label: 'MEDIA' };
        return { cls: 'other', label: 'OTHER' };
    };

    this._formatSize = function(bytes) {
        return FacaiUtils.formatSize(bytes);
    };

    this._toggleFindBar = function(target) {
        var self = this;
        var $bar = this.container.find('#captureFindBar');
        this._findTarget = target || 'resp';

        if ($bar.is(':visible') && $bar.data('target') === this._findTarget) {
            $bar.hide();
            this._clearCaptureHighlights();
            return;
        }

        $bar.show().data('target', this._findTarget);
        this.container.find('#captureFindInput').val('').focus();
        this.container.find('#captureFindCount').text('');
        this._findMatches = [];
        this._findCurrentIdx = -1;
    };

    this._doCaptureFind = function() {
        var self = this;
        var keyword = this.container.find('#captureFindInput').val();
        if (!keyword) {
            this.container.find('#captureFindCount').text('');
            this._clearCaptureHighlights();
            return;
        }

        var targetId = this._findTarget === 'req' ? 'reqBody' : 'respBody';
        var fullText = this._findTarget === 'req' ? this._fullReqText : this._fullRespText;
        var $pre = this.container.find('#' + targetId);

        if ($pre.text().length < fullText.length) {
            $pre.text(fullText);
            this.container.find('.capture-load-hint[data-target="' + this._findTarget + '"]').remove();
        }

        this._clearCaptureHighlights();

        var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var regex = new RegExp(escaped, 'gi');
        var matches = [];
        var match;
        while ((match = regex.exec(fullText)) !== null) {
            matches.push(match.index);
        }

        this._findMatches = matches;
        this.container.find('#captureFindCount').text(matches.length > 0 ? '1/' + matches.length : '0');

        if (matches.length === 0) return;

        this._findCurrentIdx = 0;
        this._highlightCaptureFind(targetId, fullText, keyword);
    };

    this._highlightCaptureFind = function(targetId, text, keyword) {
        var self = this;
        var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var regex = new RegExp('(' + escaped + ')', 'gi');
        var parts = text.split(regex);

        var html = '';
        var matchIdx = 0;
        for (var i = 0; i < parts.length; i++) {
            if (regex.test(parts[i])) {
                var cls = matchIdx === self._findCurrentIdx ? 'capture-find-highlight capture-find-current' : 'capture-find-highlight';
                html += '<span class="' + cls + '" data-idx="' + matchIdx + '">' + self.escapeHtml(parts[i]) + '</span>';
                matchIdx++;
            } else {
                html += self.escapeHtml(parts[i]);
            }
            regex.lastIndex = 0;
        }

        var $pre = this.container.find('#' + targetId);
        $pre.html(self._addLineNumbers(html));

        this._scrollCaptureToMatch(targetId);
    };

    this._navigateCaptureFind = function(direction) {
        if (this._findMatches.length === 0) return;
        if (direction === 'next') {
            this._findCurrentIdx = (this._findCurrentIdx + 1) % this._findMatches.length;
        } else {
            this._findCurrentIdx = (this._findCurrentIdx - 1 + this._findMatches.length) % this._findMatches.length;
        }

        this.container.find('#captureFindCount').text((this._findCurrentIdx + 1) + '/' + this._findMatches.length);

        var targetId = this._findTarget === 'req' ? 'reqBody' : 'respBody';
        this.container.find('#' + targetId + ' .capture-find-highlight').removeClass('capture-find-current');
        this.container.find('#' + targetId + ' .capture-find-highlight[data-idx="' + this._findCurrentIdx + '"]').addClass('capture-find-current');
        this._scrollCaptureToMatch(targetId);
    };

    this._scrollCaptureToMatch = function(targetId) {
        var $current = this.container.find('#' + targetId + ' .capture-find-current');
        if ($current.length) {
            var $pre = this.container.find('#' + targetId);
            var preTop = $pre.offset().top;
            var preHeight = $pre.height();
            var curTop = $current.offset().top;
            var curHeight = $current.height();
            var scrollTop = $pre.scrollTop();
            var relTop = curTop - preTop + scrollTop;
            if (relTop < scrollTop || relTop > scrollTop + preHeight - curHeight) {
                $pre.scrollTop(relTop - preHeight / 3);
            }
        }
    };

    this._clearCaptureHighlights = function() {
        var targetId = this._findTarget === 'req' ? 'reqBody' : 'respBody';
        var $pre = this.container.find('#' + targetId);
        if ($pre.length) {
            var text = this._findTarget === 'req' ? this._fullReqText : this._fullRespText;
            var currentText = $pre.text();
            if (currentText.length >= text.length) {
                $pre.html(this._addLineNumbers(this.escapeHtml(currentText)));
            }
        }
        this._findMatches = [];
        this._findCurrentIdx = -1;
    };

    this.formatAsBurp = function(reqData) {
        var method = reqData.method || 'GET';
        var url = reqData.url || '';
        var headers = reqData.headers || {};
        var body = reqData.body || '';
        var bodyEncoding = reqData.body_encoding || 'plain';

        var burp = method + ' ' + url + ' HTTP/1.1\n';
        for (var key in headers) {
            burp += key + ': ' + headers[key] + '\n';
        }
        burp += '\n';
        if (body) {
            if (bodyEncoding === 'base64') {
                burp += '[Binary data encoded as base64 - ' + body.length + ' chars]';
            } else {
                burp += body;
            }
        }
        return burp;
    };

    this.formatResponseAsBurp = function(respData) {
        var statusCode = respData.status_code || 0;
        var headers = respData.headers || {};
        var body = respData.body || '';
        var bodyEncoding = respData.body_encoding || 'plain';

        var burp = 'HTTP/1.1 ' + statusCode + '\n';
        for (var key in headers) {
            burp += key + ': ' + headers[key] + '\n';
        }
        burp += '\n';
        if (body) {
            if (bodyEncoding === 'base64') {
                burp += '[Binary data encoded as base64 - ' + body.length + ' chars]';
            } else {
                burp += body;
            }
        }
        return burp;
    };

    this._detectLangFromResp = function(respData) {
        var headers = respData.headers || {};
        var ct = '';
        for (var key in headers) {
            if (key.toLowerCase() === 'content-type') {
                ct = headers[key].toLowerCase();
                break;
            }
        }
        if (ct.indexOf('application/json') >= 0) return 'json';
        if (ct.indexOf('text/html') >= 0 || ct.indexOf('application/xhtml') >= 0) return 'html';
        if (ct.indexOf('text/javascript') >= 0 || ct.indexOf('application/javascript') >= 0 || ct.indexOf('application/x-javascript') >= 0) return 'js';
        if (ct.indexOf('text/css') >= 0) return 'css';
        if (ct.indexOf('application/xml') >= 0 || ct.indexOf('text/xml') >= 0 || ct.indexOf('+xml') >= 0) return 'xml';
        if (ct.indexOf('text/yaml') >= 0 || ct.indexOf('application/yaml') >= 0 || ct.indexOf('+yaml') >= 0) return 'yaml';
        if (ct.indexOf('text/x-python') >= 0 || ct.indexOf('application/x-python') >= 0) return 'py';
        if (ct.indexOf('text/x-shellscript') >= 0 || ct.indexOf('application/x-sh') >= 0) return 'bash';
        if (ct.indexOf('text/markdown') >= 0) return 'md';
        if (ct.indexOf('text/plain') >= 0) {
            if (window.SpeedHighlightDetect) {
                var body = respData.body || '';
                if (body && body.length < 50000) {
                    return window.SpeedHighlightDetect.detectLanguage(body);
                }
            }
            return 'plain';
        }
        if (window.SpeedHighlightDetect) {
            var body = respData.body || '';
            if (body && body.length < 50000) {
                return window.SpeedHighlightDetect.detectLanguage(body);
            }
        }
        return 'plain';
    };

    this._applyHighlight = function(el, lang) {
        if (!window.SpeedHighlight || !el) return;
        el.className = 'detail-pre shj-lang-' + lang;
        SpeedHighlight.highlightElement(el, lang, 'multiline').catch(function() {});
    };

    this.showContextMenu = function(e, id) {
        e.preventDefault();
        this.contextMenuTarget = id;
        var $menu = $('#captureContextMenu');
        $menu.css({
            display: 'block',
            left: '0px',
            top: '0px'
        });
        var menuWidth = $menu.outerWidth();
        var menuHeight = $menu.outerHeight();
        var x = e.clientX;
        var y = e.clientY;
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 5;
        }
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 5;
        }
        if (x < 0) x = 5;
        if (y < 0) y = 5;
        $menu.css({
            left: x + 'px',
            top: y + 'px'
        });
    };

    this.hideContextMenu = function() {
        $('#captureContextMenu').hide();
        this.contextMenuTarget = null;
    };

    this.handleContextAction = function(action) {
        var self = this;
        var id = this.contextMenuTarget;
        if (!id) return;

        $.ajax({
            url: '/api/capture/detail/' + id,
            type: 'GET',
            success: function(resp) {
                if (!resp.success) return;
                var data = resp.data;
                var reqData = data.request || {};

                switch (action) {
                    case 'replay':
                        self.replayRequest(reqData);
                        break;
                    case 'scan':
                        self.scanRequest(reqData);
                        break;
                    case 'copy-url':
                        self.copyToClipboard(data.url || '');
                        break;
                    case 'copy-domain':
                        self.copyToClipboard(data.website || '');
                        break;
                }
            }
        });
    };

    this.replayRequest = function(reqData) {
        var burpText = this.formatAsBurp(reqData);
        var initialData = {
            burpFormat: burpText
        };
        TabManager.openTab('tools/replay', 'HTTP请求重放', {
            subModule: 'replay',
            initialData: initialData
        });
    };


    this.scanRequest = function(reqData) {
        var burpText = this.formatAsBurp(reqData);
        var jsonData = {
            method: reqData.method || 'GET',
            url: reqData.url || '',
            headers: reqData.headers || {},
            body: reqData.body || '',
            body_encoding: reqData.body_encoding || 'plain'
        };
        TabManager.openTab('scaner/manual', '手动模式', {
            subModule: 'manual',
            initialData: {
                burpText: burpText,
                jsonText: JSON.stringify(jsonData, null, 2)
            }
        });
    };

    this.copyToClipboard = function(text) {
        FacaiUtils.copyToClipboard(text);
    };

    this.startAutoRefresh = function() {
        var self = this;
        this._connectSocket();
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.refreshTimer = setInterval(function() {
            if (self.autoRefresh && !self._socketReady) {
                self.loadCaptureList();
            }
        }, 3000);
    };

    this._connectSocket = function() {
        var self = this;
        if (self._socket) return;

        try {
            self._socket = io({ reconnection: true, reconnectionDelay: 2000 });

            self._socket.on('connect', function() {
                self._socketReady = true;
            });

            self._socket.on('disconnect', function() {
                self._socketReady = false;
            });

            self._socket.on('capture_new', function(data) {
                if (!self.projectFilter) {
                    self._onCaptureNew(data);
                }
            });

            self._socket.on('capture_new_filtered', function(data) {
                if (self.projectFilter) {
                    self._onCaptureNew(data);
                }
            });

            self._socket.on('capture_cleared', function() {
                self._onCaptureCleared();
            });
        } catch (e) {
            self._socketReady = false;
        }
    };

    this._onCaptureNew = function(data) {
        var self = this;
        if (!data || !data.item) return;

        var item = data.item;
        var tbody = self.container.find('#captureList');

        if (data.removed_id) {
            tbody.find('tr[data-id="' + data.removed_id + '"]').remove();
            if (self.selectedId === data.removed_id) {
                self.selectedId = null;
            }
        }

        self._pendingItems.push(item);

        var $bar = self.container.find('#captureNewBar');
        var $count = self.container.find('#captureNewCount');
        $count.text(self._pendingItems.length);
        $bar.show();

        var totalInList = tbody.find('tr:not(.empty-row)').length;
        $('#captureCount').text((totalInList + self._pendingItems.length) + ' 条记录');
    };

    this._loadPendingItems = function() {
        var self = this;
        if (self._pendingItems.length === 0) return;

        var tbody = self.container.find('#captureList');
        var $panel = self.container.find('.capture-list-panel');

        if (tbody.find('.empty-row').length) {
            tbody.empty();
        }

        var items = self._pendingItems.slice();
        self._pendingItems = [];

        items.forEach(function(item) {
            var methodClass = self.getMethodClass(item.method);
            var statusClass = self.getStatusClass(item.status_code);
            var $tr = $('<tr>').attr('data-id', item._id);

            $('<td>').addClass('method-cell').html('<span class="method-badge ' + methodClass + '">' + self.escapeHtml(item.method) + '</span>').appendTo($tr);
            $('<td>').addClass('url-cell').text(item.url).appendTo($tr);
            $('<td>').addClass('ext-cell').html('<span class="ext-badge">' + self.escapeHtml(item.extension || '-') + '</span>').appendTo($tr);
            $('<td>').addClass('status-cell').html('<span class="status-badge ' + statusClass + '">' + (item.status_code || '-') + '</span>').appendTo($tr);
            var typeInfo = self._classifyContentType(item.content_type || '');
            $('<td>').addClass('type-cell').html('<span class="type-badge type-' + typeInfo.cls + '">' + typeInfo.label + '</span>').appendTo($tr);
            $('<td>').addClass('time-cell').text(item.time ? item.time.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : '-').appendTo($tr);

            tbody.prepend($tr);
        });

        self.container.find('#captureNewBar').hide();
        $panel.scrollTop(0);

        self._trimList();
    };

    this._trimList = function() {
        var self = this;
        var tbody = self.container.find('#captureList');
        var $rows = tbody.find('tr:not(.empty-row)');
        if ($rows.length > self._MAX_DISPLAY) {
            var removeCount = $rows.length - self._MAX_DISPLAY;
            $rows.slice($rows.length - removeCount).remove();
        }
        var totalInList = tbody.find('tr:not(.empty-row)').length;
        $('#captureCount').text((totalInList + self._pendingItems.length) + ' 条记录');
    };

    this._onCaptureCleared = function() {
        var self = this;
        self.selectedId = null;
        self._pendingItems = [];
        self.container.find('#captureNewBar').hide();
        self.container.find('#captureList').html('<tr><td colspan="6" class="empty-row">暂无捕捉数据</td></tr>');
        self.container.find('#captureDetail').html(
            '<div class="detail-empty"><div class="empty-icon">📨</div><p>点击左侧流量查看请求/响应详情</p></div>'
        );
        $('#captureCount').text('0 条记录');
    };

    this.getMethodClass = function(method) {
        var m = (method || '').toUpperCase();
        switch (m) {
            case 'GET': return 'method-get';
            case 'POST': return 'method-post';
            case 'PUT': return 'method-put';
            case 'DELETE': return 'method-delete';
            case 'PATCH': return 'method-patch';
            default: return 'method-other';
        }
    };

    this.getStatusClass = function(statusCode) {
        if (!statusCode) return 'status-unknown';
        if (statusCode >= 200 && statusCode < 300) return 'status-2xx';
        if (statusCode >= 300 && statusCode < 400) return 'status-3xx';
        if (statusCode >= 400 && statusCode < 500) return 'status-4xx';
        if (statusCode >= 500) return 'status-5xx';
        return 'status-unknown';
    };

    this.escapeHtml = function(text) {
        return FacaiUtils.escapeHtml(text);
    };

    this.bindEvents = function() {
        var self = this;

        self.container.find('#captureNewBar').off('click').on('click', function() {
            self._loadPendingItems();
        });

        self.container.find('.capture-list-panel').off('scroll.newBar').on('scroll.newBar', function() {
            var $panel = $(this);
            if ($panel.scrollTop() <= 0 && self._pendingItems.length > 0) {
                self._loadPendingItems();
            }
        });

        self.container.find('#refreshCapture').off('click').on('click', function() {
            self.loadCaptureList();
        });

        self.container.find('#clearCapture').off('click').on('click', function() {
            if (confirm('确定要清空所有捕捉数据吗？')) {
                $.ajax({
                    url: '/api/capture/clear',
                    type: 'POST',
                    success: function(resp) {
                        if (resp.success) {
                            self.selectedId = null;
                            self.loadCaptureList();
                            self.container.find('#captureDetail').html(
                                '<div class="detail-empty"><div class="empty-icon">📨</div><p>点击左侧流量查看请求/响应详情</p></div>'
                            );
                        }
                    }
                });
            }
        });

        self.container.find('#autoRefresh').off('change').on('change', function() {
            self.autoRefresh = $(this).is(':checked');
        });

        self.container.find('#projectFilter').off('change').on('change', function() {
            self.projectFilter = $(this).is(':checked');
            self.selectedId = null;
            self.loadCaptureList();
        });

        self.container.on('click', '.capture-table tbody tr', function(e) {
            var id = $(this).data('id');
            if (id) {
                if (self.selectedId === id) {
                    self.selectedId = null;
                    self.container.find('.capture-table tr').removeClass('selected');
                    self.container.find('#captureDetail').html(
                        '<div class="detail-empty"><div class="empty-icon">📨</div><p>点击左侧流量查看请求/响应详情</p></div>'
                    );
                } else {
                    self.showDetail(id);
                }
            }
        });

        self.container.on('contextmenu', '.capture-table tbody tr', function(e) {
            var id = $(this).data('id');
            if (id) {
                self.showContextMenu(e, id);
            }
        });

        $(document).on('click', '#captureContextMenu .ctx-item', function() {
            var action = $(this).data('action');
            self.handleContextAction(action);
            self.hideContextMenu();
        });

        $(document).on('click', function() {
            self.hideContextMenu();
        });

        self.container.on('click', '.copy-btn', function() {
            var target = $(this).data('target');
            var fullText = target === 'reqBody' ? self._fullReqText : self._fullRespText;
            self.copyToClipboard(fullText);
        });

        self.container.on('click', '.capture-hex-btn', function() {
            var target = $(this).data('target');
            self._toggleCaptureHexView(target, $(this));
        });

        self.container.on('click', '.capture-find-target-btn', function() {
            var target = $(this).data('target');
            self._toggleFindBar(target);
        });

        self.container.on('click', '#captureFindClose', function() {
            self.container.find('#captureFindBar').hide();
            self._clearCaptureHighlights();
        });

        self.container.on('click', '#captureFindNext', function() {
            self._navigateCaptureFind('next');
        });

        self.container.on('click', '#captureFindPrev', function() {
            self._navigateCaptureFind('prev');
        });

        self.container.on('keydown', '#captureFindInput', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    self._navigateCaptureFind('prev');
                } else {
                    self._navigateCaptureFind('next');
                }
            }
        });

        var _captureFindTimer = null;
        self.container.on('input', '#captureFindInput', function() {
            clearTimeout(_captureFindTimer);
            _captureFindTimer = setTimeout(function() {
                self._doCaptureFind();
            }, 300);
        });

        self.container.on('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                self._toggleFindBar(self._findTarget || 'resp');
            }
        });

        var $resizer = self.container.find('#captureResizer');
        var $listPanel = self.container.find('.capture-list-panel');
        var $detailPanel = self.container.find('.capture-detail-panel');
        var $main = self.container.find('.capture-main');
        var _dragging = false;

        $resizer.on('mousedown.capture', function(e) {
            e.preventDefault();
            _dragging = true;
            $resizer.addClass('active');
            $('body').css('cursor', 'col-resize');
            $('body').css('user-select', 'none');
        });

        $(document).on('mousemove.capture', function(e) {
            if (!_dragging) return;
            var mainOffset = $main.offset();
            var mainWidth = $main.width();
            var resizerWidth = $resizer.outerWidth();
            var newLeftWidth = e.clientX - mainOffset.left;
            var minWidth = 200;
            if (newLeftWidth < minWidth) newLeftWidth = minWidth;
            if (newLeftWidth > mainWidth - minWidth - resizerWidth) newLeftWidth = mainWidth - minWidth - resizerWidth;
            $listPanel.css('width', newLeftWidth + 'px');
        });

        $(document).on('mouseup.capture', function() {
            if (!_dragging) return;
            _dragging = false;
            $resizer.removeClass('active');
            $('body').css('cursor', '');
            $('body').css('user-select', '');
        });
    };

    this._toggleCaptureHexView = function(target, $btn) {
        if (!window.HexViewer) return;

        var containerId = target === 'req' ? 'reqHexContainer' : 'respHexContainer';
        var preId = target === 'req' ? 'reqBody' : 'respBody';
        var $hexContainer = this.container.find('#' + containerId);
        var $pre = this.container.find('#' + preId);

        if ($hexContainer.is(':visible')) {
            $hexContainer.hide();
            $pre.show();
            $btn.text('🔢 Hex');
            return;
        }

        var fullText = target === 'req' ? this._fullReqText : this._fullRespText;

        if (!this._captureHexViewers) {
            this._captureHexViewers = {};
        }

        if (!this._captureHexViewers[target]) {
            this._captureHexViewers[target] = new HexViewer();
        }

        this._captureHexViewers[target].setData(fullText);
        this._captureHexViewers[target].render($hexContainer, { editable: false });

        $pre.hide();
        $hexContainer.show();
        $btn.text('📝 文本');
    };

    this._addLineNumbers = function(escapedHtml) {
        return FacaiUtils.addLineNumbers(escapedHtml);
    };
}
