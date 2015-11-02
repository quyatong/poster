var fs = require('fs');
var path = require('path');
var utils = require('./utils');
var BOUNDRARY = utils.getBoundary();
var MULTIPART_END = '\r\n--' + BOUNDRARY + '--\r\n';

/**
 * 流处理
 *     
 * @param  {ReadStream}     readStream  读流
 * @param  {Function}       callback    回调
 */
function streamHandler (readStream, callback) {

    var chunks = [];
    var size = 0;

    return readStream
    .on('data', function (chunk) {
        chunks.push(chunk);
        size += chunk.length;
    })
    .on('end', function () {

        // 获取全部内容 根据朴灵的方案
        var data = null;
        switch (chunks.length) {
            case 0:
                data = new Buffer(0);
                break;
            case 1:
                data = chunks[0];
                break;
            default:
                data = new Buffer(size);
                for (var i = 0, pos = 0, l = chunks.length; i < l; i++) {
                    var chunk = chunks[i];
                    chunk.copy(data, pos);
                    pos += chunk.length;
                }
                break;
        }

        callback(data);
    });
}

function uploadPart (uploadUrl, uploadOptions, fileSize, fileName, fileData, callback, start) {
    start = start || 0;
    var partLength = 1 * 1024 * 1024;
    uploadOptions.fields.start = start;

    var form = utils.getMultipartForm(uploadOptions.fields, uploadOptions.fileId, fileName, uploadOptions.fileContentType);

    var fileSize = fileData.slice(start, start + partLength).length;

    // 内容长度
    var contentLength = form.length + fileSize + MULTIPART_END.length;

    // http | https
    var uploadProtocol = utils.getProtocol(uploadUrl);

    // 上传请求头部
    var headers = {
        'Content-Length': contentLength,
        'Content-Type': 'multipart/form-data; boundary=' + BOUNDRARY
    };

    // 上传请求头部添加用户自定义头部
    if (uploadOptions.uploadHeaders) {
        for (var attr in uploadOptions.uploadHeaders) { 
            headers[attr] = uploadOptions.uploadHeaders[attr]; 
        }
    }

    // 获取请求参数
    var options = utils.getRequestOptions('POST', uploadUrl, headers, uploadOptions.uploadAgent);

    var req = uploadProtocol.request(options, function (res) {
        streamHandler(res, function (response) {
            response = response.toString('utf-8');
            var data = JSON.parse(response);
            
            if (data.error == 'uploding') {
                uploadPart(uploadUrl, uploadOptions, fileSize, fileName, fileData, callback, data['next_start']);
            }
            else {
                callback(null, response);
            }
        });
    });

    req.on('socket', function() {
        req.socket.on('connect', function() {
            req.write(form);
            req.write(fileData.slice(start, start + partLength));
            req.write(MULTIPART_END);
            req.end();
        });
    });

    req.on('error', function(err) {
        return callback(err);
    });
}

/**
 * 上传
 * 
 * @param  {string}   uploadUrl     上传的url
 * @param  {[type]}   parsedUri     [description]
 * @param  {[type]}   uploadOptions [description]
 * @param  {[type]}   fileSize      [description]
 * @param  {[type]}   fileName      [description]
 * @param  {Function} callback      [description]
 * @return {[type]}                 [description]
 */
function upload (uploadUrl, parsedUri, uploadOptions, fileSize, fileName, callback) {
    var fileStream = fs.createReadStream(parsedUri.path);

    // 读取文件
    streamHandler(fileStream, function (data) {
        uploadPart(uploadUrl, uploadOptions, fileSize, fileName, data, function (error, data) {
            callback(error, data);
        });
    });
}

module.exports = {
    post: function(uri, options, callback) {

        if (!uri) {
            return callback('Invalid url or file path argument');
        }

        if (!options) {
            return callback('Invalid options argument');
        }

        if (!options.uploadUrl) {
            return callback('Invalid upload url argument');
        }

        var uploadUrl = utils.parseUri(options.uploadUrl);

        if (!uploadUrl.isValidUrl) {
            return callback('Invalid upload url argument');
        }

        var uploadOptions = {
            method: 'POST',
            maxFileSize: 0,
            fileId: 'Filedata',
            maxRedirects: 5,
            fileContentType: 'application/octet-stream'
        };

        // set default upload options
        for (var attr in options) { 
            uploadOptions[attr] = options[attr]; 
        }
        
        // one agent to rule them all?
        if (options.agent) {
            options.downloadAgent = options.agent;
            options.uploadAgent = options.agent;
        }

        // one headers to rule them all?
        if (options.headers) {
            options.downloadHeaders = options.headers;
            options.uploadHeaders = options.headers;
        }

        // lets do this
        try {
            var parsedUri = utils.parseUri(uri);

            fs.exists(uri, function(exists) {

                if (!exists) {
                    return callback('File does not exist on the file system.');
                }
                
                fs.stat(uri, function(err, stats) {
                    if (err) {
                        return callback(err);
                    }

                    if (!utils.validateFileSize(uploadOptions.maxFileSize, stats.size)) {
                        return callback('File is too large, maxFileSize: ' + uploadOptions.maxFileSize + ', size: ' + stats.size);
                    }

                    var fileName = uploadOptions.fileName ? uploadOptions.fileName : path.basename(uri);
                    upload(uploadUrl, parsedUri, uploadOptions, stats.size, fileName, callback);
                });
            });
        }
        catch (e) {
            callback(e);
        }
    }
};
