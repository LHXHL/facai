var PageUp = {
    /**
     * 生成翻页HTML
     * @param {Object} options 配置选项
     * @param {number} options.currentPage 当前页码
     * @param {number} options.totalPages 总页数
     * @param {function} options.onPageChange 页码变更回调函数
     * @param {number} options.visiblePages 可见页码数量（默认10）
     * @param {jQuery} options.container 可选，分页容器的jQuery对象，用于事件绑定
     * @returns {string} 翻页HTML
     */
    generatePagination: function(options, container) {
        var defaults = {
            currentPage: 1,
            totalPages: 1,
            onPageChange: function() {},
            visiblePages: 10
        };
        
        var config = Object.assign({}, defaults, options);
        var { currentPage, totalPages, onPageChange, visiblePages } = config;
        
        if (totalPages <= 1) {
            return '';
        }
        
        var html = '<div class="pagination">';
        
        // 上一页
        var prevDisabled = currentPage === 1 ? 'disabled' : '';
        html += `<button class="pagination-btn prev ${prevDisabled}" data-page="${currentPage - 1}">上一页</button>`;
        
        // 页码导航
        var startPage = Math.max(1, currentPage - Math.floor(visiblePages / 2));
        var endPage = Math.min(totalPages, startPage + visiblePages - 1);
        
        // 调整起始页码，确保显示足够的页码
        if (endPage - startPage + 1 < visiblePages) {
            startPage = Math.max(1, endPage - visiblePages + 1);
        }
        
        // 第一页
        if (startPage > 1) {
            html += `<button class="pagination-btn page" data-page="1">1</button>`;
            if (startPage > 2) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
        }
        
        // 中间页码
        for (var i = startPage; i <= endPage; i++) {
            var activeClass = i === currentPage ? 'active' : '';
            html += `<button class="pagination-btn page ${activeClass}" data-page="${i}">${i}</button>`;
        }
        
        // 最后一页
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
            html += `<button class="pagination-btn page" data-page="${totalPages}">${totalPages}</button>`;
        }
        
        // 下一页
        var nextDisabled = currentPage === totalPages ? 'disabled' : '';
        html += `<button class="pagination-btn next ${nextDisabled}" data-page="${currentPage + 1}">下一页</button>`;
        
        // 总页数和跳转
        html += `
            <div class="pagination-info">
                <span>共 ${totalPages} 页</span>
                <div class="pagination-jump">
                    <input type="number" class="pagination-input" min="1" max="${totalPages}" value="${currentPage}">
                    <button class="pagination-jump-btn">跳转</button>
                </div>
            </div>
        `;
        
        html += '</div>';
        
        // 使用闭包保存回调引用
        var pageChangeCallback = onPageChange;
        var totalPagesRef = totalPages;
        
        // 使用 setTimeout 确保 DOM 已经渲染完成后再绑定事件
        setTimeout(function() {
            // 直接在传入的 container 上绑定事件，使用事件委托
            // 不再通过复杂的查找链，直接用 container 本身作为委托根
            if (container && container instanceof jQuery && container.length) {
                container.off('.pageUp');

                container.on('click.pageUp', '.pagination-btn', function(e) {
                    e.preventDefault();
                    var $btn = $(this);
                    var page = parseInt($btn.data('page'));
                    if (!isNaN(page) && page >= 1 && page <= totalPagesRef) {
                        pageChangeCallback(page);
                    }
                });

                container.on('click.pageUp', '.pagination-jump-btn', function(e) {
                    e.preventDefault();
                    var page = parseInt(container.find('.pagination-input').val());
                    if (!isNaN(page) && page >= 1 && page <= totalPagesRef) {
                        pageChangeCallback(page);
                    }
                });

                container.on('keypress.pageUp', '.pagination-input', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        var page = parseInt($(this).val());
                        if (!isNaN(page) && page >= 1 && page <= totalPagesRef) {
                            pageChangeCallback(page);
                        }
                    }
                });
            }
        }, 0);
        
        return html;
    }
};