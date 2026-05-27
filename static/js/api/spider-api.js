/**
* 爬虫模块 API 调用层
*/
(function() {
    'use strict';

    var SpiderApi = {
        /**
         * 获取指定站点的总览数据
         * @param {string} site - 站点地址
         * @param {string[]} domains - 域名列表
         * @param {boolean} forceRefresh - 是否强制刷新
         * @returns {Promise}
         */
        getSitesOverview: function(site, domains, forceRefresh) {
            var url = '/api/spider/sites/overview?site=' + encodeURIComponent(site);
            if (forceRefresh) url += '&refresh=1';
            return $.ajax({
                url: url,
                type: 'GET',
                data: { domains: JSON.stringify(domains || []) }
            });
        },

        /**
         * 获取所有站点的总览数据
         * @param {string[]} domains - 域名列表
         * @returns {Promise}
         */
        getAllSitesOverview: function(domains) {
            return $.ajax({
                url: '/api/spider/sites/overview',
                type: 'GET',
                data: { domains: JSON.stringify(domains || []) }
            });
        },

        /**
         * 获取站点面板分页数据
         * @param {string} site - 站点地址
         * @param {string} type - 面板类型 (urls/apis/scripts)
         * @param {number} page - 页码
         * @param {number} pageSize - 每页数量
         * @param {string} keyword - 搜索关键词
         * @param {string} sortField - 排序字段
         * @param {string} sortOrder - 排序顺序 ('asc' 或 'desc')
         * @param {number} processStatus - 处理状态过滤（0=待处理，1=已处理，null=全部）
         * @param {boolean} forceRefresh - 是否强制从数据库刷新缓存
         * @returns {Promise}
         */
        getSitesPage: function(site, type, page, pageSize, keyword, sortField, sortOrder, processStatus, forceRefresh) {
            var params = {
                site: site,
                type: type,
                page: page || 1,
                page_size: pageSize || 50
            };
            if (keyword) {
                params.keyword = keyword;
            }
            if (sortField) {
                params.sort_field = sortField;
                params.sort_order = sortOrder || 'asc';
            }
            if (processStatus !== undefined && processStatus !== null) {
                params.process_status = processStatus;
            }
            if (forceRefresh) {
                params.refresh = '1';
            }
            return $.ajax({
                url: '/api/spider/sites/page',
                type: 'GET',
                data: params
            });
        },

        /**
         * 获取 HTTP 请求详情
         * @param {string} id - 请求ID
         * @returns {Promise}
         */
        getHttpDetail: function(id) {
            return $.ajax({
                url: '/api/assets/http/' + id,
                type: 'GET'
            });
        }
    };

    // 导出到全局
    window.SpiderApi = SpiderApi;

})();
