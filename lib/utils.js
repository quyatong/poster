var http = require('http');
var https = require('https');
var url = require('url');
var BOUNDARY = '----Y0uR3tH3m4nN0wd0g';

module.exports = {

    /**
     * 获取Boundary
     * 
     * @return {string} Boundary
     */
    getBoundary: function () {
        return BOUNDARY;
    },

    /**
     * 根据协议获取使用模块
     * 
     * @param  {string} url url
     * @return {Object}     https | http
     */
    getProtocol: function (url) {
        return (url.protocol === 'https:') ? https : http;
    },

    /**
     * 获取请求参数
     * 
     * @param  {string} method  POST | GET
     * @param  {string} url     url
     * @param  {Object} headers 请求头
     * @param  {string} agent   ua
     * @return {Object}         请求参数
     */
    getRequestOptions: function (method, url, headers, agent) {
        var options = {
            method: method,
            host: url.host,
            path: url.path,
            port: url.port,
            headers: headers
        };
        
        //自定义配置ua
        if (agent) {
            options.agent = agent;
        }

        return options;
    },
        

    /**
     * uri转换成对象
     * 
     * @param  {string} uri uri
     * @return {Object}     uri资源对象
     */
    parseUri: function (uri) {
        
        var uriRes = {
            host: null, 
            path: uri, 
            isValidUrl: false, 
            protocol: null 
        };
        
        var parsedUri = url.parse(uri);
        
        if ((parsedUri.protocol === 'http:') || (parsedUri.protocol === 'https:')) {
            uriRes.isValidUrl = true;
            uriRes.protocol = parsedUri.protocol;
            uriRes.path = parsedUri.path;
            uriRes.host = parsedUri.hostname;
            uriRes.port = parsedUri.port;
            uriRes.pathname = parsedUri.pathname;
        }

        return uriRes;
    },

    /**
     * 获取多媒体内容
     *          
     * @param  {Object} fields          域
     * @param  {string} fileFieldName   文件域名称
     * @param  {string} fileName        文件名称
     * @param  {string} fileContentType 文件类型
     * @return {Buffer}                 字符串buffer
     */
    getMultipartForm: function (fields, fileFieldName, fileName, fileContentType) {
        var form = '';
        
        if (fields) {

            for (var field in fields) {
                form += '--' + BOUNDARY + '\r\n';
                form += 'Content-Disposition: form-data; name="' + field + '"\r\n\r\n';
                form += fields[field] + '\r\n';
            }
        }

        form += '--' + BOUNDARY + '\r\n';
        form += 'Content-Disposition: form-data; name="' + fileFieldName + '"; filename="' + fileName + '"\r\n';
        form += 'Content-Type: ' + fileContentType + '\r\n\r\n';

        return new Buffer(form);
    },

    /**
     * 验证文件大小
     * 
     * @param  {number} maxFileSize 最大文件大小
     * @param  {number} fileSize    当前文件大小
     * @return {bool}               文件大小是否适合
     */
    validateFileSize: function (maxFileSize, fileSize) {
        if (maxFileSize > 0) {
            if (fileSize > maxFileSize) {
                return false;
            }
        }
        return true;
    },

    /**
     * 审查文件名称
     * 
     * @param  {string} fileName 文件名称
     * @return {string}          文件名称
     */
    sanitizeFileName: function (fileName) {
        var re = new RegExp('[\\/:"*?<>|]+', 'mg');
        var sanitized = fileName.replace(re, '');

        return (sanitized.length > 0) ? sanitized : null;
    }
};