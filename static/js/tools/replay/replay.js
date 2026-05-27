function ReplayModule() {
    this.STORAGE_KEY = 'facai_replay_tabs';
    this.MAX_TABS = 20;
    this.MAX_RESPONSE_SIZE = 102400;
    this.tabs = [];
    this.activeTabId = null;
    this._uiReady = false;

    this.render = function(data, container) {
        this.container = container;
        this._uiReady = false;
        this.loadFromStorage();

        var initialData = (data && data.initialData) || {};
        var hasInitialData = initialData.jsonData || initialData.burpFormat;

        if (hasInitialData) {
            var dedupTabId = this._findDuplicateTab(initialData);
            if (dedupTabId) {
                this.activeTabId = dedupTabId;
            } else {
                this.addTab(initialData);
            }
        } else if (this.tabs.length === 0) {
            this.addTab();
        }

        window.__replayInstance = this;

        this.renderUI();
        this.bindEvents();
        this._uiReady = true;
        this.applyTab(this.activeTabId || (this.tabs.length > 0 ? this.tabs[0].id : null));
    };

    this._findDuplicateTab = function(initialData) {
        var burpText = '';
        if (initialData.jsonData) {
            burpText = this._jsonToBurpStr(initialData.jsonData);
        } else if (initialData.burpFormat) {
            burpText = initialData.burpFormat;
        }
        if (!burpText || !burpText.trim()) return null;

        var normalizedInput = burpText.replace(/\s+/g, ' ').trim();

        for (var i = 0; i < this.tabs.length; i++) {
            var tabBurp = (this.tabs[i].burpText || '').replace(/\s+/g, ' ').trim();
            if (tabBurp === normalizedInput) {
                return this.tabs[i].id;
            }
        }
        return null;
    };

    this.renderUI = function() {
        this.container.html(`
<div class="replay-page">
    <div class="replay-header">
        <h3>🔄 HTTP请求重放</h3>
        <div class="replay-actions">
            <button class="btn btn-secondary btn-sm" id="addReplayTab">➕ 新建</button>
            <button class="btn btn-success btn-sm" id="sendRequest">📤 发送</button>
        </div>
    </div>

    <div class="replay-tab-bar" id="replayTabBar"></div>

    <div class="replay-main">
        <div class="replay-left">
            <div class="replay-left-header">
                <span class="panel-label">📤 请求</span>
                <div class="mode-switcher">
                    <button class="mode-btn active" data-mode="burp">Burp</button>
                    <button class="mode-btn" data-mode="json">JSON</button>
                    <button class="mode-btn" data-mode="hex">Hex</button>
                    <button class="mode-btn" id="attachFileBtn" title="上传文件作为请求体">📎 文件</button>
                    <input type="file" id="fileInput" style="display:none;" />
                </div>
            </div>
            <div class="replay-editor" id="burpMode">
                <pre class="replay-input-editor" id="burpInput" contenteditable="true" data-lang="http" placeholder="GET /api HTTP/1.1&#10;Host: example.com&#10;&#10;"></pre>
            </div>
            <div class="replay-editor" id="jsonMode" style="display:none;">
                <pre class="replay-input-editor" id="jsonInput" contenteditable="true" data-lang="json" placeholder='{"method":"GET","url":"https://example.com","headers":{},"body":""}'></pre>
            </div>
            <div class="replay-editor" id="hexMode" style="display:none;">
                <div id="reqHexViewer"></div>
            </div>
        </div>

        <div class="replay-right">
            <div class="replay-right-header">
                <span class="panel-label">📥 响应</span>
                <div class="replay-right-actions" id="responseActions"></div>
            </div>
            <div class="replay-response" id="replayResult">
                <div class="empty-result">
                    <div class="empty-icon">📨</div>
                    <p>发送请求后在此显示响应结果</p>
                </div>
            </div>
        </div>
    </div>
</div>
        `);

        this.renderTabBar();
    };

    this.renderTabBar = function() {
        var self = this;
        var $bar = this.container.find('#replayTabBar');
        $bar.empty();

        this.tabs.forEach(function(tab) {
            var isActive = tab.id === self.activeTabId;
            var label = self.getTabLabel(tab);
            var $tab = $(`
<div class="replay-tab ${isActive ? 'active' : ''}" data-id="${tab.id}">
    <span class="tab-label" title="${self.escapeHtml(tab.burpText || '')}">${self.escapeHtml(label)}</span>
    <span class="tab-close" data-id="${tab.id}">✕</span>
</div>
            `);
            $bar.append($tab);
        });
    };

    this.getTabLabel = function(tab) {
        if (tab.burpText && tab.burpText.trim()) {
            var firstLine = tab.burpText.trim().split('\n')[0];
            var match = firstLine.match(/^([A-Z]+)\s+(\S+)/i);
            if (match) {
                var method = match[1];
                var path = match[2];
                if (path.length > 30) path = path.substring(0, 30) + '...';
                return method + ' ' + path;
            }
            return firstLine.length > 35 ? firstLine.substring(0, 35) + '...' : firstLine;
        }
        return '新请求';
    };

    this.addTab = function(initialData) {
        if (this.tabs.length >= this.MAX_TABS) {
            this.tabs.shift();
        }

        var tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var burpText = '';
        var jsonText = '';
        var mode = 'burp';

        if (initialData) {
            if (initialData.jsonData) {
                jsonText = initialData.jsonData;
                mode = 'json';
                burpText = this._jsonToBurpStr(jsonText);
            } else if (initialData.burpFormat) {
                burpText = initialData.burpFormat;
                mode = 'burp';
                jsonText = this._burpToJsonStr(burpText);
            }
        }

        var tab = {
            id: tabId,
            burpText: burpText,
            jsonText: jsonText,
            mode: mode,
            response: null,
            createdAt: Date.now()
        };

        this.tabs.push(tab);
        this.activeTabId = tabId;
        this.saveToStorage();
        return tabId;
    };

    this.closeTab = function(tabId) {
        var idx = this.tabs.findIndex(function(t) { return t.id === tabId; });
        if (idx === -1) return;

        this.tabs.splice(idx, 1);

        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                var newIdx = Math.min(idx, this.tabs.length - 1);
                this.activeTabId = this.tabs[newIdx].id;
            } else {
                this.addTab();
            }
        }

        this.saveToStorage();
        this.renderTabBar();
        this.applyTab(this.activeTabId);
    };

    this.switchTab = function(tabId) {
        if (!tabId) return;
        if (this.activeTabId && this.activeTabId !== tabId && this._uiReady) {
            this.saveCurrentTab();
        }
        this.activeTabId = tabId;
        this.saveToStorage();
        this.renderTabBar();
        this.applyTab(tabId);
    };

    this.applyTab = function(tabId) {
        if (!tabId) return;
        var tab = this.tabs.find(function(t) { return t.id === tabId; });
        if (!tab) return;

        this._setInputText('#burpInput', tab.burpText || '');
        this._setInputText('#jsonInput', tab.jsonText || '');

        this.container.find('.mode-btn').removeClass('active');
        if (tab.mode === 'json') {
            this.container.find('.mode-btn[data-mode="json"]').addClass('active');
            this.container.find('#burpMode').hide();
            this.container.find('#jsonMode').show();
        } else {
            this.container.find('.mode-btn[data-mode="burp"]').addClass('active');
            this.container.find('#burpMode').show();
            this.container.find('#jsonMode').hide();
        }

        if (tab.response) {
            this.showResult(tab.response);
        } else {
            this.container.find('#replayResult').html(`
                <div class="empty-result">
                    <div class="empty-icon">📨</div>
                    <p>发送请求后在此显示响应结果</p>
                </div>
            `);
            this.container.find('#responseActions').empty();
        }

        this._updateInputHighlight('burp');
        this._updateInputHighlight('json');
    };

    this.saveCurrentTab = function() {
        var self = this;
        var tab = this.tabs.find(function(t) { return t.id === self.activeTabId; });
        if (!tab) return;

        tab.burpText = this._getInputText('#burpInput');
        tab.jsonText = this._getInputText('#jsonInput');

        var isJsonMode = this.container.find('.mode-btn[data-mode="json"]').hasClass('active');
        tab.mode = isJsonMode ? 'json' : 'burp';

        this.saveToStorage();
    };

    this.saveToStorage = function() {
        try {
            var self = this;
            var data = {
                tabs: this.tabs.map(function(t) {
                    return {
                        id: t.id,
                        burpText: t.burpText,
                        jsonText: t.jsonText,
                        mode: t.mode,
                        response: self._truncateResponse(t.response),
                        createdAt: t.createdAt
                    };
                }),
                activeTabId: this.activeTabId
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                var self2 = this;
                var data2 = {
                    tabs: this.tabs.map(function(t) {
                        return {
                            id: t.id,
                            burpText: t.burpText,
                            jsonText: t.jsonText,
                            mode: t.mode,
                            response: null,
                            createdAt: t.createdAt
                        };
                    }),
                    activeTabId: this.activeTabId
                };
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data2));
                } catch (e2) {}
            }
        }
    };

    this._truncateResponse = function(response) {
        if (!response) return null;
        if (!response.response_body || response.response_body.length <= this.MAX_RESPONSE_SIZE) {
            return response;
        }
        var truncated = JSON.parse(JSON.stringify(response));
        truncated.response_body = truncated.response_body.substring(0, this.MAX_RESPONSE_SIZE);
        truncated._truncated = true;
        truncated._originalSize = response.response_body.length;
        return truncated;
    };

    this.loadFromStorage = function() {
        try {
            var raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) {
                this.tabs = [];
                this.activeTabId = null;
                return;
            }
            var data = JSON.parse(raw);
            this.tabs = data.tabs || [];
            this.activeTabId = data.activeTabId || null;

            if (this.tabs.length > this.MAX_TABS) {
                this.tabs = this.tabs.slice(this.tabs.length - this.MAX_TABS);
            }
        } catch (e) {
            this.tabs = [];
            this.activeTabId = null;
        }
    };

    this.sendRequest = function() {
        var self = this;
        this.saveCurrentTab();

        var tab = this.tabs.find(function(t) { return t.id === self.activeTabId; });
        if (!tab) return;

        var isJsonMode = this.container.find('.mode-btn[data-mode="json"]').hasClass('active');
        var isHexMode = this.container.find('.mode-btn[data-mode="hex"]').hasClass('active');
        var url, method, headers, body, bodyEncoding;

        if (isHexMode) {
            var hexData = this._getReqHexData();
            if (hexData === null) {
                this.showError('Hex视图中无数据');
                return;
            }
            var burpText = hexData;
            this._setInputText('#burpInput', burpText);
            var parsed = this._parseBurp(burpText);
            if (!parsed) {
                this.showError('Hex编辑后的数据无法解析为HTTP请求');
                return;
            }
            method = parsed.method;
            url = parsed.url;
            headers = parsed.headers;
            body = parsed.body;
            bodyEncoding = 'plain';
        } else if (isJsonMode) {
            var jsonText = this._getInputText('#jsonInput').trim();
            if (!jsonText) {
                this.showError('请输入JSON格式的请求数据');
                return;
            }
            try {
                var jsonData = JSON.parse(jsonText);
                url = jsonData.url;
                method = jsonData.method;
                headers = jsonData.headers || {};
                body = jsonData.body || '';
                bodyEncoding = jsonData.body_encoding || 'plain';
                if (typeof body === 'object') body = JSON.stringify(body);
            } catch (e) {
                this.showError('JSON格式错误：' + e.message);
                return;
            }
        } else {
            var burpText = this._getInputText('#burpInput').trim();
            if (!burpText) {
                this.showError('请输入Burp格式的请求数据');
                return;
            }
            var parsed = this._parseBurp(burpText);
            if (!parsed) {
                this.showError('Burp格式错误：无法解析请求行');
                return;
            }
            method = parsed.method;
            url = parsed.url;
            headers = parsed.headers;
            body = parsed.body;
            bodyEncoding = 'plain';
        }

        if (!url) {
            this.showError('请输入请求URL');
            return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            this.showError('URL必须以http://或https://开头');
            return;
        }

        this.showLoading();

        var hasFile = tab._fileBase64;
        if (hasFile) {
            body = tab._fileBase64;
            bodyEncoding = 'base64';
            if (!headers['Content-Type'] && tab._fileType) {
                headers['Content-Type'] = tab._fileType;
            }
        }

        $.ajax({
            url: '/api/tools/replay',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                url: url,
                method: method,
                headers: headers,
                body: body,
                body_encoding: bodyEncoding || 'plain'
            }),
            success: function(data) {
                if (data.error) {
                    self.showError(data.error);
                    return;
                }
                tab.response = self._truncateResponse(data);
                self.saveToStorage();
                self.showResult(tab.response);
            },
            error: function(xhr) {
                self.showError('请求失败：' + (xhr.responseJSON ? xhr.responseJSON.message || xhr.responseJSON.error : '未知错误'));
            }
        });
    };

    this.showLoading = function() {
        this.container.find('#replayResult').html(`
            <div class="loading-state">
                <div class="spinner"></div>
                <p>正在发送请求...</p>
            </div>
        `);
        this.container.find('#responseActions').empty();
    };

    this.showResult = function(data) {
        var self = this;
        var statusClass = this.getStatusClass(data.status_code);
        var statusText = data.status_code || 'N/A';
        var respTime = data.response_time || 'N/A';

        var respHeaders = '';
        if (data.response_headers) {
            for (var key in data.response_headers) {
                respHeaders += key + ': ' + data.response_headers[key] + '\n';
            }
        }

        var respBody = data.response_body || '';
        var contentType = data.response_headers && (data.response_headers['Content-Type'] || data.response_headers['content-type']);
        var isJson = contentType && contentType.includes('application/json');
        var isBinary = data.body_encoding === 'base64';
        var isImage = contentType && contentType.match(/^image\//i);
        var isTruncated = data._truncated;
        var originalSize = data._originalSize;

        var actionsHtml = '<span class="status-badge ' + statusClass + '">' + statusText + '</span>';
        actionsHtml += '<span class="resp-time">' + respTime + '</span>';
        actionsHtml += '<button class="btn btn-sm btn-outline" id="toggleRespHex">🔢 Hex</button>';
        if (isBinary && isImage) {
            actionsHtml += '<button class="btn btn-sm btn-outline" id="downloadBinary">💾 保存文件</button>';
        } else {
            actionsHtml += '<button class="btn btn-sm btn-outline" id="copyResponse">📋 复制</button>';
            actionsHtml += '<button class="btn btn-sm btn-outline" id="findInResponse">🔍 搜索</button>';
        }
        if (isJson) {
            actionsHtml += '<button class="btn btn-sm btn-outline" id="formatJson">✨ 格式化</button>';
        }
        if (isBinary && !isImage) {
            actionsHtml += '<button class="btn btn-sm btn-outline" id="downloadBinary">💾 保存文件</button>';
        }
        if (isTruncated) {
            actionsHtml += '<span class="truncated-hint">⚠️ 响应已截断 (' + this._formatSize(originalSize) + '→' + this._formatSize(this.MAX_RESPONSE_SIZE) + ') 滚动到底部加载全文</span>';
        }
        this.container.find('#responseActions').html(actionsHtml);

        var resultHtml = '';
        if (isBinary && isImage && respBody) {
            var mediaType = contentType.split(';')[0].trim() || 'image/png';
            if (respHeaders) {
                resultHtml += '<pre class="replay-resp-content shj-lang-http">' + this.escapeHtml(respHeaders) + '</pre>';
            }
            resultHtml += '<div class="replay-image-preview"><img src="data:' + mediaType + ';base64,' + respBody + '" alt="Preview" /></div>';
        } else if (isBinary && respBody) {
            var binarySize = Math.round(respBody.length * 3 / 4);
            var binaryText = '[Binary data - ' + this._formatSize(binarySize) + ']\n' + this.escapeHtml(respBody.substring(0, 2048)) + (respBody.length > 2048 ? '\n...(truncated)' : '');
            if (respHeaders) {
                resultHtml += '<pre class="replay-resp-content" id="respBodyContent">' + this.escapeHtml(respHeaders) + '\n\n' + binaryText + '</pre>';
            } else {
                resultHtml += '<pre class="replay-resp-content" id="respBodyContent">' + binaryText + '</pre>';
            }
        } else if (respBody) {
            var lang = this._detectRespLang(contentType, respBody);
            if (respHeaders) {
                resultHtml += '<pre class="replay-resp-content shj-lang-' + lang + '" id="respBodyContent">' + this.escapeHtml(respHeaders) + '\n\n' + this.escapeHtml(respBody) + '</pre>';
            } else {
                resultHtml += '<pre class="replay-resp-content shj-lang-' + lang + '" id="respBodyContent">' + this.escapeHtml(respBody) + '</pre>';
            }
        } else if (respHeaders) {
            resultHtml += '<pre class="replay-resp-content shj-lang-http">' + this.escapeHtml(respHeaders) + '</pre>';
        }
        if (isTruncated) {
            resultHtml += '<div class="load-full-hint" id="loadFullResponse">⬇️ 滚动到此处加载全文 (' + this._formatSize(originalSize) + ')</div>';
        }

        this.container.find('#replayResult').html(resultHtml || '<div class="empty-result"><p>无响应内容</p></div>');

        if (window.SpeedHighlight) {
            this.container.find('.replay-resp-content[id="respBodyContent"]').each(function() {
                var cls = this.className || '';
                var m = cls.match(/shj-lang-(\w+)/);
                if (m && m[1] && m[1] !== 'plain') {
                    SpeedHighlight.highlightElement(this, m[1], 'multiline').catch(function() {});
                }
            });
            this.container.find('.replay-resp-content:not([id="respBodyContent"])').each(function() {
                SpeedHighlight.highlightElement(this, 'http', 'multiline').catch(function() {});
            });
        }

        if (isTruncated) {
            var $result = this.container.find('#replayResult');
            $result.off('scroll.replayLoadFull').on('scroll.replayLoadFull', function() {
                var scrollTop = $result.scrollTop();
                var scrollHeight = $result[0].scrollHeight;
                var clientHeight = $result.height();
                if (scrollTop + clientHeight >= scrollHeight - 50) {
                    $result.off('scroll.replayLoadFull');
                    self._loadFullResponse(data);
                }
            });
        }
    };

    this._loadFullResponse = function(data) {
        var self = this;
        var $hint = this.container.find('#loadFullResponse');
        $hint.html('<div class="spinner" style="width:20px;height:20px;margin:8px auto;border-width:2px;"></div><p style="font-size:12px;color:#94a3b8;">加载全文中...</p>');

        var tab = this.tabs.find(function(t) { return t.id === self.activeTabId; });
        if (!tab) return;

        this.saveCurrentTab();
        var isJsonMode = this.container.find('.mode-btn[data-mode="json"]').hasClass('active');
        var url, method, headers, body, bodyEncoding;

        if (isJsonMode) {
            try {
                var jsonData = JSON.parse(tab.jsonText);
                url = jsonData.url;
                method = jsonData.method;
                headers = jsonData.headers || {};
                body = jsonData.body || '';
                bodyEncoding = jsonData.body_encoding || 'plain';
                if (typeof body === 'object') body = JSON.stringify(body);
            } catch (e) { return; }
        } else {
            var parsed = this._parseBurp(tab.burpText);
            if (!parsed) return;
            url = parsed.url;
            method = parsed.method;
            headers = parsed.headers;
            body = parsed.body;
            bodyEncoding = 'plain';
        }

        $.ajax({
            url: '/api/tools/replay',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                url: url,
                method: method,
                headers: headers,
                body: body,
                body_encoding: bodyEncoding || 'plain',
                max_body_size: -1
            }),
            success: function(fullData) {
                if (fullData.error) {
                    $hint.html('<p style="font-size:12px;color:#ef4444;">加载失败: ' + self.escapeHtml(fullData.error) + '</p>');
                    return;
                }
                var fullBody = fullData.response_body || '';
                self.container.find('#respBodyContent').html(self.escapeHtml(fullBody));
                $hint.html('<p style="font-size:12px;color:#10b981;">✅ 全文已加载 (' + self._formatSize(fullBody.length) + ')</p>');
                tab.response = fullData;
                tab.response._fullLoaded = true;
                self.saveToStorage();
                self.container.find('.truncated-hint').remove();
            },
            error: function() {
                $hint.html('<p style="font-size:12px;color:#ef4444;">加载失败，请重试</p>');
            }
        });
    };

    this._showFindBar = function() {
        var self = this;
        if (this.container.find('#findBar').length > 0) {
            this.container.find('#findBar').remove();
            this._clearHighlights();
            return;
        }

        var findBarHtml = '<div class="find-bar" id="findBar">' +
            '<input type="text" id="findInput" placeholder="搜索..." />' +
            '<span class="find-count" id="findCount"></span>' +
            '<button class="find-btn" id="findPrev">↑</button>' +
            '<button class="find-btn" id="findNext">↓</button>' +
            '<button class="find-btn find-close-btn" id="findClose">✕</button>' +
            '</div>';
        this.container.find('.replay-right-header').after(findBarHtml);

        var $findInput = this.container.find('#findInput');
        $findInput.focus();

        this.container.find('#findClose').off('click.replay').on('click.replay', function() {
            self.container.find('#findBar').remove();
            self._clearHighlights();
        });

        this.container.find('#findNext').off('click.replay').on('click.replay', function() {
            self._navigateFind(1);
        });

        this.container.find('#findPrev').off('click.replay').on('click.replay', function() {
            self._navigateFind(-1);
        });

        $findInput.off('input.replay').on('input.replay', function() {
            self._doFind($(this).val());
        });

        $findInput.off('keydown.replay').on('keydown.replay', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                self._navigateFind(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                self.container.find('#findBar').remove();
                self._clearHighlights();
            }
        });
    };

    this._doFind = function(keyword) {
        this._clearHighlights();
        if (!keyword) {
            this.container.find('#findCount').text('');
            return;
        }

        var $bodyContent = this.container.find('#respBodyContent');
        if (!$bodyContent.length) return;

        var text = $bodyContent.text();
        var lowerText = text.toLowerCase();
        var lowerKeyword = keyword.toLowerCase();
        var matches = [];
        var pos = 0;
        while ((pos = lowerText.indexOf(lowerKeyword, pos)) !== -1) {
            matches.push(pos);
            pos += 1;
        }

        this.container.find('#findCount').text(matches.length > 0 ? '1/' + matches.length : '0/0');

        if (matches.length === 0) return;

        this._findMatches = matches;
        this._findCurrentIndex = 0;
        this._findKeyword = keyword;

        var escaped = this.escapeHtml(keyword);
        var re = new RegExp('(' + escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        var html = this.escapeHtml(text).replace(re, '<mark class="find-highlight">$1</mark>');
        $bodyContent.html(html);

        this._scrollToFindMatch(0);
    };

    this._navigateFind = function(direction) {
        if (!this._findMatches || this._findMatches.length === 0) return;
        this._findCurrentIndex += direction;
        if (this._findCurrentIndex >= this._findMatches.length) this._findCurrentIndex = 0;
        if (this._findCurrentIndex < 0) this._findCurrentIndex = this._findMatches.length - 1;
        this._scrollToFindMatch(this._findCurrentIndex);
        this.container.find('#findCount').text((this._findCurrentIndex + 1) + '/' + this._findMatches.length);
    };

    this._scrollToFindMatch = function(index) {
        var $highlights = this.container.find('.find-highlight');
        $highlights.removeClass('find-current');
        if ($highlights.length > index) {
            var $target = $($highlights[index]);
            $target.addClass('find-current');
            var $container = this.container.find('#replayResult');
            var targetOffset = $target.position().top - $container.position().top;
            $container.scrollTop($container.scrollTop() + targetOffset - $container.height() / 3);
        }
    };

    this._clearHighlights = function() {
        var $bodyContent = this.container.find('#respBodyContent');
        if ($bodyContent.length) {
            var text = $bodyContent.text();
            $bodyContent.html(this.escapeHtml(text));
        }
        this._findMatches = null;
        this._findCurrentIndex = 0;
        this._findKeyword = '';
    };

    this._formatSize = function(bytes) {
        return FacaiUtils.formatSize(bytes);
    };

    this.showError = function(message) {
        this.container.find('#replayResult').html(`
            <div class="error-state">
                <div class="error-icon">❌</div>
                <p>${this.escapeHtml(message)}</p>
            </div>
        `);
        this.container.find('#responseActions').empty();
    };

    this._parseBurp = function(burpText) {
        if (!burpText || !burpText.trim()) return null;
        var lines = burpText.split('\n');
        var firstLine = lines[0].trim();
        var match = firstLine.match(/^([A-Z]+)\s+(.+?)\s+HTTP\/[\d.]+$/i);
        if (!match) return null;

        var method = match[1];
        var rawUrl = match[2];
        var headers = {};
        var body = '';
        var emptyLineIndex = -1;

        for (var i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') {
                emptyLineIndex = i;
                break;
            }
            var colonIdx = lines[i].indexOf(':');
            if (colonIdx > 0) {
                var hKey = lines[i].substring(0, colonIdx).trim();
                var hVal = lines[i].substring(colonIdx + 1).trim();
                headers[hKey] = hVal;
            }
        }

        if (emptyLineIndex > 0 && emptyLineIndex < lines.length - 1) {
            body = lines.slice(emptyLineIndex + 1).join('\n');
        }

        var url = rawUrl;
        if (!/^https?:\/\//i.test(url)) {
            var host = '';
            for (var key in headers) {
                if (key.toLowerCase() === 'host') {
                    host = headers[key];
                    break;
                }
            }
            if (host) {
                var scheme = 'https';
                var portMatch = host.match(/:(\d+)$/);
                if (portMatch && portMatch[1] === '80') {
                    scheme = 'http';
                }
                url = scheme + '://' + host + rawUrl;
            }
        }

        return { method: method, url: url, headers: headers, body: body };
    };

    this._burpToJsonStr = function(burpText) {
        var parsed = this._parseBurp(burpText);
        if (!parsed) return '';
        return JSON.stringify({
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            body: parsed.body,
            body_encoding: 'plain'
        }, null, 2);
    };

    this._jsonToBurpStr = function(jsonText) {
        if (!jsonText || !jsonText.trim()) return '';
        try {
            var jsonData = JSON.parse(jsonText);
            var method = jsonData.method || 'GET';
            var url = jsonData.url || '';
            var headers = jsonData.headers || {};
            var body = jsonData.body || '';

            var path = url;
            var host = '';
            var scheme = 'https';

            if (/^https?:\/\//i.test(url)) {
                var urlMatch = url.match(/^(https?):\/\/([^\/\?]+)([\/\?].*)?$/i);
                if (urlMatch) {
                    scheme = urlMatch[1].toLowerCase();
                    host = urlMatch[2];
                    path = urlMatch[3] || '/';
                } else {
                    var urlMatch2 = url.match(/^(https?):\/\/([^\/]+)$/i);
                    if (urlMatch2) {
                        scheme = urlMatch2[1].toLowerCase();
                        host = urlMatch2[2];
                        path = '/';
                    }
                }
            }

            var burp = method + ' ' + path + ' HTTP/1.1\n';
            if (host) {
                burp += 'Host: ' + host + '\n';
            }
            for (var key in headers) {
                if (key.toLowerCase() === 'host') continue;
                burp += key + ': ' + headers[key] + '\n';
            }
            burp += '\n';
            if (body) burp += body;
            return burp;
        } catch (e) {
            return '';
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

    this.showToast = function(message) {
        FacaiUtils.showToast(message);
    };

    this.bindEvents = function() {
        var self = this;

        self.container.off('.replay');

        self.container.on('click.replay', '#addReplayTab', function() {
            self.addTab();
            self.renderTabBar();
            self.applyTab(self.activeTabId);
        });

        self.container.on('click.replay', '.replay-tab', function(e) {
            if ($(e.target).hasClass('tab-close')) return;
            var tabId = $(this).data('id');
            self.switchTab(tabId);
        });

        self.container.on('click.replay', '.tab-close', function(e) {
            e.stopPropagation();
            var tabId = $(this).data('id');
            self.closeTab(tabId);
        });

        self.container.on('click.replay', '.mode-btn', function() {
            var mode = $(this).data('mode');
            if (!mode) return;
            self.container.find('.mode-btn').removeClass('active');
            $(this).addClass('active');

            if (mode === 'burp') {
                self.container.find('#burpMode').show();
                self.container.find('#jsonMode').hide();
                self.container.find('#hexMode').hide();
                var jsonVal = self._getInputText('#jsonInput');
                self._setInputText('#burpInput', self._jsonToBurpStr(jsonVal));
            } else if (mode === 'json') {
                self.container.find('#burpMode').hide();
                self.container.find('#jsonMode').show();
                self.container.find('#hexMode').hide();
                var burpVal = self._getInputText('#burpInput');
                self._setInputText('#jsonInput', self._burpToJsonStr(burpVal));
            } else if (mode === 'hex') {
                self.container.find('#burpMode').hide();
                self.container.find('#jsonMode').hide();
                self.container.find('#hexMode').show();
                self._showReqHexView();
            }
        });

        self.container.on('click.replay', '#sendRequest', function() {
            self.sendRequest();
        });

        self.container.on('keydown.replay', '#jsonInput, #burpInput', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                self.sendRequest();
            }
        });

        self.container.on('input.replay', '#burpInput', function() {
            self._setInputText('#jsonInput', self._burpToJsonStr(self._getInputText('#burpInput')));
        });

        self.container.on('input.replay', '#jsonInput', function() {
            self._setInputText('#burpInput', self._jsonToBurpStr(self._getInputText('#jsonInput')));
        });

        self.container.on('focusout.replay', '#burpInput', function() {
            self._updateInputHighlight('burp');
            self._updateInputHighlight('json');
        });

        self.container.on('focusout.replay', '#jsonInput', function() {
            self._updateInputHighlight('json');
            self._updateInputHighlight('burp');
        });

        self.container.on('click.replay', '#copyResponse', function() {
            var text = self.container.find('.replay-resp-content').text() || self.container.find('#replayResult').text();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function() {
                    self.showToast('复制成功！');
                });
            } else {
                self.fallbackCopy(text);
            }
        });

        self.container.on('click.replay', '#formatJson', function() {
            try {
                var $body = self.container.find('.replay-resp-content');
                var text = $body.text();
                var json = JSON.parse(text);
                $body.text(JSON.stringify(json, null, 2));
            } catch (e) {
                self.showToast('JSON格式错误');
            }
        });

        self.container.on('click.replay', '#findInResponse', function() {
            self._showFindBar();
        });

        self.container.on('click.replay', '#attachFileBtn', function() {
            self.container.find('#fileInput').click();
        });

        self.container.on('change.replay', '#fileInput', function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                var base64 = ev.target.result.split(',')[1];
                var tab = self.tabs.find(function(t) { return t.id === self.activeTabId; });
                if (!tab) return;
                tab._fileBase64 = base64;
                tab._fileName = file.name;
                tab._fileType = file.type;
                self.container.find('#attachFileBtn').text('📎 ' + file.name);
                self.showToast('已附加文件: ' + file.name + ' (' + self._formatSize(file.size) + ')');
            };
            reader.readAsDataURL(file);
            $(this).val('');
        });

        self.container.on('click.replay', '#downloadBinary', function() {
            var tab = self.tabs.find(function(t) { return t.id === self.activeTabId; });
            if (!tab || !tab.response) return;
            var data = tab.response;
            var contentType = data.response_headers && (data.response_headers['Content-Type'] || data.response_headers['content-type']) || 'application/octet-stream';
            var ext = contentType.split('/')[1] || 'bin';
            if (ext.indexOf(';') >= 0) ext = ext.split(';')[0];
            var filename = 'response.' + ext;
            var contentDisposition = data.response_headers && (data.response_headers['Content-Disposition'] || data.response_headers['content-disposition']);
            if (contentDisposition) {
                var fnMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (fnMatch) filename = fnMatch[1].replace(/['"]/g, '');
            }
            var b64 = data.response_body;
            var byteChars = atob(b64);
            var byteNumbers = new Array(byteChars.length);
            for (var i = 0; i < byteChars.length; i++) {
                byteNumbers[i] = byteChars.charCodeAt(i);
            }
            var byteArray = new Uint8Array(byteNumbers);
            var blob = new Blob([byteArray], { type: contentType });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            self.showToast('文件已下载: ' + filename);
        });

        self.container.on('keydown.replay', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                self._showFindBar();
            }
        });

        self.container.on('click.replay', '#toggleRespHex', function() {
            self._toggleRespHexView();
        });
    };

    this.fallbackCopy = function(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            this.showToast('复制成功！');
        } catch (err) {
            this.showToast('复制失败');
        }
        document.body.removeChild(textarea);
    };

    this._getInputText = function(selector) {
        var $el = this.container.find(selector);
        return $el.text() || '';
    };

    this._setInputText = function(selector, text) {
        if (text === undefined || text === null) text = '';
        var $el = this.container.find(selector);
        if (document.activeElement === $el[0]) return;
        if ($el.text() !== text) {
            $el.text(text);
        }
    };

    this._updateInputHighlight = function(type) {
        if (!window.SpeedHighlight) return;

        var inputId = type === 'burp' ? '#burpInput' : '#jsonInput';
        var lang = type === 'burp' ? 'http' : 'json';
        var $el = this.container.find(inputId);
        var text = $el.text();

        if (!text) return;

        SpeedHighlight.highlightText(text, lang, false).then(function(html) {
            $el.html(html);
        }).catch(function() {});
    };

    this._detectRespLang = function(contentType, body) {
        if (!contentType) {
            if (window.SpeedHighlightDetect && body && body.length < 50000) {
                return window.SpeedHighlightDetect.detectLanguage(body);
            }
            return 'plain';
        }
        var ct = contentType.toLowerCase();
        if (ct.indexOf('application/json') >= 0) return 'json';
        if (ct.indexOf('text/html') >= 0) return 'html';
        if (ct.indexOf('text/javascript') >= 0 || ct.indexOf('application/javascript') >= 0) return 'js';
        if (ct.indexOf('text/css') >= 0) return 'css';
        if (ct.indexOf('application/xml') >= 0 || ct.indexOf('text/xml') >= 0) return 'xml';
        if (ct.indexOf('text/yaml') >= 0 || ct.indexOf('application/yaml') >= 0) return 'yaml';
        if (ct.indexOf('text/plain') >= 0) {
            if (window.SpeedHighlightDetect && body && body.length < 50000) {
                return window.SpeedHighlightDetect.detectLanguage(body);
            }
            return 'plain';
        }
        if (window.SpeedHighlightDetect && body && body.length < 50000) {
            return window.SpeedHighlightDetect.detectLanguage(body);
        }
        return 'plain';
    };

    this._showReqHexView = function() {
        if (!window.HexViewer) return;
        var burpText = this._getInputText('#burpInput');
        if (!burpText) return;

        if (!this._reqHexViewer) {
            this._reqHexViewer = new HexViewer();
        }
        this._reqHexViewer.setData(burpText);
        this._reqHexViewer.render(this.container.find('#reqHexViewer'), {
            editable: true,
            onChange: function(idx, newByte, oldByte) {}
        });
    };

    this._getReqHexData = function() {
        if (!this._reqHexViewer) return null;
        return this._reqHexViewer.getData();
    };

    this._toggleRespHexView = function() {
        var self = this;
        var $result = this.container.find('#replayResult');
        var $hexContainer = this.container.find('#respHexContainer');

        if ($hexContainer.length && $hexContainer.is(':visible')) {
            $hexContainer.hide();
            $result.find('.replay-resp-content, .replay-image-preview, .load-full-hint, .empty-result').show();
            this.container.find('#toggleRespHex').text('🔢 Hex');
            return;
        }

        if (!window.HexViewer) return;

        var tab = this.tabs.find(function(t) { return t.id === self.activeTabId; });
        var data = tab && tab.response;
        if (!data) {
            this.showToast('请先发送请求');
            return;
        }

        if (!$hexContainer.length) {
            $result.append('<div id="respHexContainer" style="height:100%;"></div>');
            $hexContainer = this.container.find('#respHexContainer');
        }

        var respText = '';
        if (data.response_headers) {
            for (var key in data.response_headers) {
                respText += key + ': ' + data.response_headers[key] + '\n';
            }
            respText += '\n';
        }
        if (data.body_encoding === 'base64' && data.response_body) {
            try {
                var raw = atob(data.response_body);
                respText += raw;
            } catch (e) {
                respText += data.response_body;
            }
        } else {
            respText += data.response_body || '';
        }

        if (!this._respHexViewer) {
            this._respHexViewer = new HexViewer();
        }

        this._respHexViewer.setData(respText);
        this._respHexViewer.render($hexContainer, { editable: false });

        $result.find('.replay-resp-content, .replay-image-preview, .load-full-hint, .empty-result').hide();
        $hexContainer.show();
        this.container.find('#toggleRespHex').text('📝 文本');
    };
}
