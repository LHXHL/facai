/**
 * 爆破工具模块
 * 支持单请求和多请求模式，支持字典爆破和交叉爆破
 */

function FuzzModule() {
    'use strict';
    var self = this;
    var _mode = 'single';  // single / multi
    var _fuzzMode = 'single';  // single / cross
    var _results = [];
    var _isRunning = false;
    var _progressTimer = null;

    // ========== 渲染 ==========

    this.render = function(data, container) {
        _isRunning = false;
        clearInterval(_progressTimer);
        _results = [];

        container.html(self._buildLayout());
        this._setDefaultHeaders();
        this._bindEvents(container);
        this._loadResultFile(container);
    };

    // 设置默认Headers
    this._setDefaultHeaders = function() {
        var defaultHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "close",
            "Upgrade-Insecure-Requests": "1"
        };
        $('#fuzzHeaders').val(JSON.stringify(defaultHeaders, null, 2));
    };

    this._buildLayout = function() {
        return `
<div class="fuzz-container">
    <!-- 模式选择 -->
    <div class="fuzz-header">
        <h2>爆破工具</h2>
        <div class="fuzz-mode-tabs">
            <button class="mode-tab active" data-mode="single">单请求模式</button>
            <button class="mode-tab" data-mode="multi">多请求模式</button>
        </div>
    </div>

    <!-- 请求配置区 -->
    <div class="fuzz-config-section">
        <div class="fuzz-config-left">
            <!-- 请求格式选择 -->
            <div class="fuzz-format-selector">
                <label>请求格式:</label>
                <select id="fuzzRequestFormat">
                    <option value="manual">手动输入</option>
                    <option value="json">JSON格式</option>
                    <option value="burp">Burp Suite格式</option>
                </select>
            </div>

            <!-- 手动输入区 -->
            <div id="fuzzManualInput">
                <div class="form-row">
                    <div class="form-group" style="width:100px;">
                        <label>Method</label>
                        <select id="fuzzMethod">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>URL (使用 {{str1}} 和 {{str2}} 作为占位符)</label>
                        <input type="text" id="fuzzUrl" placeholder="https://example.com/{{str1}}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Headers (JSON格式)</label>
                    <textarea id="fuzzHeaders" rows="6" placeholder="点击刷新后自动填充默认值"></textarea>
                </div>
                <div class="form-group">
                    <label>Body</label>
                    <textarea id="fuzzBody" rows="4" placeholder="请求体，使用 {{str1}} 和 {{str2 }} 作为占位符"></textarea>
                </div>
            </div>

            <!-- JSON格式输入 -->
            <div id="fuzzJsonInput" style="display:none;">
                <div class="form-group">
                    <label>JSON请求 (使用 {{str1}} 和 {{str2}} 作为占位符)</label>
                    <textarea id="fuzzJsonContent" rows="10" placeholder='{
  "url": "https://example.com/api/{{str1}}",
  "method": "POST",
  "headers": {"Content-Type": "application/json"},
  "body": "{\"username\": \"admin\", \"password\": \"{{str1}}\"}"
}'></textarea>
                </div>
            </div>

            <!-- Burp格式输入 -->
            <div id="fuzzBurpInput" style="display:none;">
                <div class="form-group">
                    <label>Burp Suite请求 (使用 {{str1}} 和 {{str2}} 作为占位符)</label>
                    <textarea id="fuzzBurpContent" rows="10" placeholder="POST /api/login HTTP/1.1
Host: example.com
Content-Type: application/json

{"username": "admin", "password": "{{str1}}"}'></textarea>
                </div>
            </div>

            <!-- 多请求模式 - 说明 -->
            <div id="fuzzMultiRequests" style="display:none;">
                <div class="fuzz-multi-info">
                    <div class="info-box">
                        <span class="icon">ℹ️</span>
                        <span>将对 website 表中所有URL进行路径/文件爆破</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="fuzz-config-right">
            <!-- 爆破配置 -->
            <div class="fuzz-options">
                <h4>爆破配置</h4>

                <!-- 爆破模式 -->
                <div class="form-group">
                    <label>爆破模式:</label>
                    <select id="fuzz爆破Mode">
                        <option value="single">单参数爆破</option>
                        <option value="cross">交叉爆破</option>
                    </select>
                </div>

                <!-- 字典1 -->
                <div class="form-group">
                    <label>字典</label>
                    <textarea id="fuzzDict1" rows="8" placeholder="每行一个payload"></textarea>
                    <div class="dict-actions">
                        <button class="btn btn-xs" id="fuzzLoadDict1">加载TXT</button>
                        <button class="btn btn-xs" id="fuzzClearDict1">清空</button>
                    </div>
                </div>

                <!-- 字典2 (交叉爆破时显示) -->
                <div class="form-group" id="fuzzDict2Group" style="display:none;">
                    <label>字典2</label>
                    <textarea id="fuzzDict2" rows="8" placeholder="每行一个payload（交叉爆破时使用）"></textarea>
                    <div class="dict-actions">
                        <button class="btn btn-xs" id="fuzzLoadDict2">加载TXT</button>
                        <button class="btn btn-xs" id="fuzzClearDict2">清空</button>
                    </div>
                </div>

                <!-- 高级选项 -->
                <div class="fuzz-advanced">
                    <h5>高级选项</h5>
                    <div class="form-row">
                        <div class="form-group">
                            <label>线程数</label>
                            <input type="number" id="fuzzThreads" value="5" min="1" max="20">
                        </div>
                        <div class="form-group">
                            <label>超时(秒)</label>
                            <input type="number" id="fuzzTimeout" value="10" min="1" max="60">
                        </div>
                    </div>

                    <!-- 匹配条件 -->
                    <div class="fuzz-match">
                        <label>匹配条件 (符合以下任一条件则记录结果):</label>
                        <input type="text" id="fuzzMatchStatus" placeholder="状态码，如: 200,302 或 200-299">
                        <input type="text" id="fuzzMatchLength" placeholder="响应长度，如: <1000, >100, 100-200">
                        <input type="text" id="fuzzMatchRegex" placeholder="响应体正则匹配">
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 控制按钮 -->
    <div class="fuzz-actions">
        <button class="btn btn-success" id="fuzzStart">
            <span>&#9654;</span> 开始爆破
        </button>
        <button class="btn btn-warning" id="fuzzPause" disabled>
            <span>&#10074;&#10074;</span> 暂停
        </button>
        <button class="btn btn-danger" id="fuzzStop" disabled>
            <span>&#9632;</span> 停止
        </button>
        <button class="btn btn-default" id="fuzzClearResults">
            <span>&#128465;</span> 清空结果
        </button>
    </div>

    <!-- 进度显示 -->
    <div class="fuzz-progress" id="fuzzProgressSection">
        <div class="progress-info">
            <span id="fuzzProgressText">准备就绪</span>
            <span id="fuzzProgressPercent">0%</span>
        </div>
        <div class="progress-bar">
            <div class="progress-bar-fill" id="fuzzProgressFill"></div>
        </div>
        <div class="progress-stats">
            <span>总计: <strong id="fuzzTotal">0</strong></span>
            <span>完成: <strong id="fuzzCompleted">0</strong></span>
            <span>匹配: <strong id="fuzzMatched" style="color:#52c41a;">0</strong></span>
            <span>失败: <strong id="fuzzFailed">0</strong></span>
        </div>
    </div>

    <!-- 结果显示 -->
    <div class="fuzz-results-section">
        <div class="fuzz-results-header">
            <h3>爆破结果 <span class="badge" id="fuzzResultCount">0</span></h3>
            <div class="fuzz-results-actions">
                <button class="btn btn-xs" id="fuzzRefreshResults">刷新</button>
                <button class="btn btn-xs" id="fuzzClearFile">清空文件</button>
                <button class="btn btn-xs" id="fuzzExportResults">导出</button>
            </div>
        </div>
        <div class="fuzz-results-file" id="fuzzResultsFile">
            <div class="fuzz-txt-viewer" id="fuzzTxtViewer">
                <pre id="fuzzTxtContent">暂无结果</pre>
            </div>
        </div>
    </div>

    <!-- 结果详情弹窗 -->
    <div class="detail-overlay" id="fuzzResultOverlay">
        <div class="detail-dialog">
            <div class="detail-dialog-header">
                <h3>请求详情</h3>
                <span class="detail-dialog-close" id="fuzzResultClose">&#10005;</span>
            </div>
            <div class="detail-dialog-body" id="fuzzResultDetail">
            </div>
        </div>
    </div>
</div>

<!-- 隐藏的文件输入 -->
<input type="file" id="fuzzDict1File" accept=".txt" style="display:none;">
<input type="file" id="fuzzDict2File" accept=".txt" style="display:none;">
`;
    };

    // ========== 事件绑定 ==========

    this._bindEvents = function(container) {
        var $c = container;

        // 模式切换
        $c.on('click', '.mode-tab', function() {
            var mode = $(this).data('mode');
            $('.mode-tab').removeClass('active');
            $(this).addClass('active');
            _mode = mode;

            if (mode === 'single') {
                $('#fuzzManualInput, #fuzzJsonInput, #fuzzBurpInput').hide();
                $('#fuzzMultiRequests').hide();
                $('#fuzzManualInput').show();
            } else {
                $('#fuzzManualInput, #fuzzJsonInput, #fuzzBurpInput').hide();
                $('#fuzzMultiRequests').show();
            }
        });

        // 请求格式切换
        $c.on('change', '#fuzzRequestFormat', function() {
            var format = $(this).val();
            $('#fuzzManualInput, #fuzzJsonInput, #fuzzBurpInput').hide();
            if (format === 'manual') {
                $('#fuzzManualInput').show();
            } else if (format === 'json') {
                $('#fuzzJsonInput').show();
            } else if (format === 'burp') {
                $('#fuzzBurpInput').show();
            }
        });

        // 爆破模式切换
        $c.on('change', '#fuzz爆破Mode', function() {
            _fuzzMode = $(this).val();
            if (_fuzzMode === 'cross') {
                $('#fuzzDict2Group').show();
            } else {
                $('#fuzzDict2Group').hide();
            }
        });

        // 字典操作
        $c.on('click', '#fuzzLoadDict1', function() {
            $('#fuzzDict1File').click();
        });
        $c.on('click', '#fuzzLoadDict2', function() {
            $('#fuzzDict2File').click();
        });
        $c.on('click', '#fuzzClearDict1', function() {
            $('#fuzzDict1').val('');
        });
        $c.on('click', '#fuzzClearDict2', function() {
            $('#fuzzDict2').val('');
        });

        // 文件加载
        $c.on('change', '#fuzzDict1File', function(e) {
            self._loadDictFile(e.target.files[0], 'dict1');
        });
        $c.on('change', '#fuzzDict2File', function(e) {
            self._loadDictFile(e.target.files[0], 'dict2');
        });

        // 开始爆破
        $c.on('click', '#fuzzStart', function() {
            self._startFuzz($c);
        });

        // 暂停/继续
        $c.on('click', '#fuzzPause', function() {
            if (_isRunning) {
                if ($(this).text().indexOf('继续') !== -1) {
                    self._resumeFuzz();
                    $(this).html('<span>&#10074;&#10074;</span> 暂停');
                } else {
                    self._pauseFuzz();
                    $(this).html('<span>&#9654;</span> 继续');
                }
            }
        });

        // 停止
        $c.on('click', '#fuzzStop', function() {
            self._stopFuzz($c);
        });

        // 清空结果
        $c.on('click', '#fuzzClearResults', function() {
            _results = [];
            self._renderResults($c);
            self._updateProgress($c, {total: 0, completed: 0, success: 0, failed: 0});
        });

        // 刷新结果文件
        $c.on('click', '#fuzzRefreshResults', function() {
            self._loadResultFile($c);
        });

        // 清空结果文件
        $c.on('click', '#fuzzClearFile', function() {
            if (confirm('确定要清空结果文件吗？')) {
                $.ajax({
                    url: '/api/fuzz/results/clear',
                    type: 'POST',
                    success: function(res) {
                        if (res.success) {
                            self._loadResultFile($c);
                            self._log($c, '[清空] 结果文件已清空');
                        }
                    }
                });
            }
        });

        // 导出结果
        $c.on('click', '#fuzzExportResults', function() {
            self._exportResults();
        });

        // 关闭详情弹窗
        $c.on('click', '#fuzzResultClose, #fuzzResultOverlay', function(e) {
            if (e.target === this) {
                $('#fuzzResultOverlay').removeClass('show');
            }
        });

        // 查看结果详情
        $c.on('click', '.fuzz-result-row', function() {
            var idx = $(this).data('idx');
            if (_results[idx]) {
                self._showResultDetail($c, _results[idx]);
            }
        });
    };

    // ========== 加载结果文件 ==========

    this._loadResultFile = function(container) {
        var $c = container;
        $.ajax({
            url: '/api/fuzz/results/file',
            type: 'GET',
            success: function(res) {
                if (res.success) {
                    var content = res.data.content;
                    _results = [];
                    if (content) {
                        var lines = content.split('\n');
                        lines.forEach(function(line) {
                            line = line.trim();
                            if (line) {
                                try {
                                    _results.push(JSON.parse(line));
                                } catch (e) {}
                            }
                        });
                    }
                    self._renderResults($c);
                }
            }
        });
    };

    // ========== 加载字典文件 ==========

    this._loadDictFile = function(file, dictType) {
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(e) {
            var content = e.target.result;
            if (dictType === 'dict1') {
                $('#fuzzDict1').val(content);
            } else {
                $('#fuzzDict2').val(content);
            }
        };
        reader.readAsText(file);
    };

    // ========== 解析请求 ==========

    this._parseRequest = function(container) {
        var format = $('#fuzzRequestFormat').val();

        if (format === 'manual') {
            var url = $('#fuzzUrl').val().trim();
            if (!url) {
                alert('请输入URL');
                return null;
            }
            var headersStr = $('#fuzzHeaders').val().trim();
            var headers = {};
            try {
                if (headersStr) headers = JSON.parse(headersStr);
            } catch (e) {
                headers = {};
            }
            return {
                url: url,
                method: $('#fuzzMethod').val(),
                headers: headers,
                body: $('#fuzzBody').val()
            };
        } else if (format === 'json') {
            var jsonStr = $('#fuzzJsonContent').val().trim();
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                alert('JSON格式错误: ' + e.message);
                return null;
            }
        } else if (format === 'burp') {
            return self._parseBurpFormat($('#fuzzBurpContent').val());
        }
        return null;
    };

    this._parseBurpFormat = function(burpText) {
        var lines = burpText.split('\n');
        if (lines.length < 1) return null;

        // 解析请求行
        var requestLine = lines[0].trim();
        var parts = requestLine.split(' ');
        if (parts.length < 3) return null;

        var method = parts[0];
        var path = parts[1];

        // 查找headers和body的分隔
        var headerEnd = 1;
        for (var i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') {
                headerEnd = i;
                break;
            }
        }

        // 解析headers
        var headers = {};
        for (var i = 1; i < headerEnd; i++) {
            var colonIdx = lines[i].indexOf(':');
            if (colonIdx > 0) {
                var key = lines[i].substring(0, colonIdx).trim();
                var value = lines[i].substring(colonIdx + 1).trim();
                headers[key] = value;
            }
        }

        // 解析body
        var body = '';
        if (headerEnd < lines.length) {
            body = lines.slice(headerEnd + 1).join('\n');
        }

        // 构建URL
        var host = headers['Host'] || 'localhost';
        var protocol = headers['Host'] && headers['Host'].indexOf(':443') !== -1 ? 'https' : 'http';
        var url = protocol + '://' + host + path;

        return {
            url: url,
            method: method,
            headers: headers,
            body: body
        };
    };

    // ========== 爆破操作 ==========

    this._startFuzz = function(container) {
        var $c = container;

        // 获取字典
        var dict1Str = $('#fuzzDict1').val();
        var dict2Str = $('#fuzzDict2').val();

        if (!dict1Str.trim()) {
            alert('请输入字典1');
            return;
        }

        var dict1 = dict1Str.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        var dict2 = dict2Str ? dict2Str.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s; }) : [];

        if (!dict1.length) {
            alert('字典1为空');
            return;
        }

        // 获取请求配置
        var request_data = null;
        if (_mode === 'single') {
            request_data = self._parseRequest($c);
            if (!request_data) return;
        }

        // 获取配置
        var threads = parseInt($('#fuzzThreads').val()) || 10;
        var timeout = parseInt($('#fuzzTimeout').val()) || 10;
        var matchStatus = $('#fuzzMatchStatus').val().trim();
        var matchLength = $('#fuzzMatchLength').val().trim();
        var matchRegex = $('#fuzzMatchRegex').val().trim();

        // 解析匹配条件
        var matchStatusList = null;
        if (matchStatus) {
            if (matchStatus.indexOf('-') !== -1) {
                var rangeParts = matchStatus.split('-');
                matchStatusList = [];
                for (var i = parseInt(rangeParts[0]); i <= parseInt(rangeParts[1]); i++) {
                    matchStatusList.push(i);
                }
            } else if (matchStatus.indexOf(',') !== -1) {
                matchStatusList = matchStatus.split(',').map(function(s) { return parseInt(s.trim()); });
            } else {
                matchStatusList = [parseInt(matchStatus)];
            }
        }

        // 更新UI
        _isRunning = true;
        _results = [];
        $c.find('#fuzzStart').prop('disabled', true);
        $c.find('#fuzzPause').prop('disabled', false);
        $c.find('#fuzzStop').prop('disabled', false);
        self._log($c, '[开始] 爆破任务启动...');

        // 发送请求
        $.ajax({
            url: '/api/fuzz/start',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                mode: _mode,
                fuzz_mode: _fuzzMode,
                request: request_data,
                dict1: dict1,
                dict2: dict2.length ? dict2 : null,
                threads: threads,
                timeout: timeout,
                match_status: matchStatusList,
                match_length: matchLength || null,
                match_regex: matchRegex || null
            }),
            success: function(res) {
                if (res.success) {
                    self._log($c, '[启动] ' + res.message);
                    // 开始轮询进度
                    self._startProgressPolling($c);
                } else {
                    self._log($c, '[错误] ' + res.message, 'error');
                    _isRunning = false;
                    self._updateButtons($c);
                }
            },
            error: function(xhr) {
                self._log($c, '[错误] 启动失败: ' + xhr.statusText, 'error');
                _isRunning = false;
                self._updateButtons($c);
            }
        });
    };

    this._pauseFuzz = function() {
        $.ajax({
            url: '/api/fuzz/pause',
            type: 'POST',
            success: function() {
                self._log($c, '[暂停] 爆破任务已暂停');
            }
        });
    };

    this._resumeFuzz = function() {
        $.ajax({
            url: '/api/fuzz/resume',
            type: 'POST',
            success: function() {
                self._log($c, '[继续] 爆破任务继续执行');
            }
        });
    };

    this._stopFuzz = function(container) {
        var $c = container;
        $.ajax({
            url: '/api/fuzz/stop',
            type: 'POST',
            success: function() {
                _isRunning = false;
                clearInterval(_progressTimer);
                self._updateButtons($c);
                self._log($c, '[停止] 爆破任务已停止');
            }
        });
    };

    // ========== 进度轮询 ==========

    this._startProgressPolling = function(container) {
        var $c = container;

        _progressTimer = setInterval(function() {
            if (!_isRunning) {
                clearInterval(_progressTimer);
                return;
            }

            $.ajax({
                url: '/api/fuzz/progress',
                type: 'GET',
                success: function(res) {
                    if (res.success) {
                        var progress = res.data;
                        self._updateProgress($c, progress);

                        // 检查是否完成
                        if (progress.completed >= progress.total && progress.total > 0) {
                            clearInterval(_progressTimer);
                            _isRunning = false;
                            self._updateButtons($c);
                            self._log($c, '[完成] 爆破任务已完成');
                        }
                    }
                }
            });

            // 获取最新结果
            $.ajax({
                url: '/api/fuzz/results',
                type: 'GET',
                success: function(res) {
                    if (res.success && res.data) {
                        _results = res.data.results || [];
                        self._renderResults($c);
                    }
                }
            });
        }, 1000);
    };

    this._updateProgress = function(container, progress) {
        var $c = container;
        var percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

        $c.find('#fuzzProgressPercent').text(percent + '%');
        $c.find('#fuzzProgressFill').css('width', percent + '%');
        $c.find('#fuzzProgressText').text(progress.current || '处理中...');
        $c.find('#fuzzTotal').text(progress.total);
        $c.find('#fuzzCompleted').text(progress.completed);
        $c.find('#fuzzMatched').text(progress.success);
        $c.find('#fuzzFailed').text(progress.failed);
    };

    this._updateButtons = function(container) {
        var $c = container;
        $c.find('#fuzzStart').prop('disabled', _isRunning);
        $c.find('#fuzzPause').prop('disabled', !_isRunning);
        $c.find('#fuzzStop').prop('disabled', !_isRunning);
        if (!_isRunning) {
            $c.find('#fuzzPause').html('<span>&#10074;&#10074;</span> 暂停');
        }
    };

    // ========== 结果渲染 ==========

    this._renderResults = function(container) {
        var $c = container;

        $c.find('#fuzzResultCount').text(_results.length);

        if (!_results.length) {
            $c.find('#fuzzTxtContent').text('暂无结果');
            return;
        }

        // 生成文本内容
        var lines = ['# 爆破结果 (共 ' + _results.length + ' 条)'];
        lines.push('# 时间: ' + new Date().toLocaleString());
        lines.push('# 格式: [状态码] [长度] [耗时] Payload | URL');
        lines.push('');

        _results.forEach(function(result) {
            var status = result.error ? 'ERR' : (result.status_code || '-');
            var length = result.length || 0;
            var elapsed = result.elapsed || 0;
            var payload = result.payload || '';
            if (result.payload2) payload += ',' + result.payload2;
            var url = result.url || '';
            lines.push('[' + status + '] [' + length + '] [' + elapsed + 'ms] ' + payload + ' | ' + url);
        });

        $c.find('#fuzzTxtContent').text(lines.join('\n'));
    };

    this._filterResults = function(container) {
        self._renderResults(container);
    };

    this._showResultDetail = function(container, result) {
        var $c = container;
        var $detail = $c.find('#fuzzResultDetail');

        var html = '<div class="fuzz-detail-info">';

        // 基本信息
        html += '<div class="detail-section"><h4>基本信息</h4>';
        html += '<div class="detail-row"><span class="label">URL:</span><span class="value"><a href="' + self._escapeHtml(result.url) + '" target="_blank">' + self._escapeHtml(result.url) + '</a></span></div>';
        html += '<div class="detail-row"><span class="label">Method:</span><span class="value">' + (result.method || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Status:</span><span class="value">' + (result.status_code || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Length:</span><span class="value">' + (result.length || 0) + '</span></div>';
        html += '<div class="detail-row"><span class="label">Elapsed:</span><span class="value">' + (result.elapsed || 0) + 'ms</span></div>';
        html += '<div class="detail-row"><span class="label">Payload:</span><span class="value">' + self._escapeHtml(result.payload || '') + (result.payload2 ? ', ' + self._escapeHtml(result.payload2) : '') + '</span></div>';
        if (result.error) {
            html += '<div class="detail-row"><span class="label">Error:</span><span class="value" style="color:red;">' + self._escapeHtml(result.error) + '</span></div>';
        }
        html += '</div>';

        // 响应头
        if (result.response_headers && Object.keys(result.response_headers).length) {
            html += '<div class="detail-section"><h4>响应头</h4>';
            html += '<pre class="detail-json">' + self._escapeHtml(JSON.stringify(result.response_headers, null, 2)) + '</pre>';
            html += '</div>';
        }

        // 响应体
        if (result.response_body) {
            html += '<div class="detail-section"><h4>响应体 (前5KB)</h4>';
            html += '<pre class="detail-json">' + self._escapeHtml(result.response_body) + '</pre>';
            html += '</div>';
        }

        html += '</div>';
        $detail.html(html);
        $c.find('#fuzzResultOverlay').addClass('show');
    };

    // ========== 导出结果 ==========

    this._exportResults = function() {
        if (!_results.length) {
            alert('没有可导出的结果');
            return;
        }

        var csv = 'Status,Code,Length,Elapsed,Payload,Payload2,URL\n';
        _results.forEach(function(r) {
            csv += '"' + (r.error ? 'Error' : r.status_code) + '",';
            csv += (r.status_code || '') + ',';
            csv += (r.length || 0) + ',';
            csv += (r.elapsed || 0) + ',';
            csv += '"' + (r.payload || '').replace(/"/g, '""') + '",';
            csv += '"' + (r.payload2 || '').replace(/"/g, '""') + '",';
            csv += '"' + (r.url || '').replace(/"/g, '""') + '"\n';
        });

        var blob = new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'fuzz_results_' + Date.now() + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    // ========== 日志 ==========

    this._log = function(container, msg, level) {
        level = level || 'info';
        console.log('[Fuzz] ' + msg);
    };

    // ========== 工具方法 ==========

    this._escapeHtml = function(str) {
        return FacaiUtils.escapeHtml(str);
    };
}
