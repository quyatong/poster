var fs = require('fs');
var path = require('path');
var utils = require('utils');
var mimetypes = require('./mimetypes');
var BOUNDRARY = utils.getBoundary();
var MULTIPART_END = '\r\n--' + BOUNDRARY + '--\r\n';

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

    var form = utils.getMultipartForm(uploadOptions.fields, uploadOptions.fileId, fileName, uploadOptions.fileContentType);
    
    // 内容长度
    var contentLength = form.length + fileSize + MULTIPART_END.length;
    var resData = '';

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

    var req = uploadProtocol.request(options, function(res) {
        if ((res.statusCode < 200) || (res.statusCode >= 300)) {
            return callback('Invalid response from upload server. statusCode: ' + res.statusCode);
        }
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            resData += chunk;
        });
        res.on('end', function() {
            callback(null, resData);
        });
    });

    /** We do not want to buffer any data since we could buffer a ton of data before the connection
    * is made (or not), lets wait to be connected to the remote server before sending any data */
    req.on('socket', function() {
        req.socket.on('connect', function() {
            req.write(form);
            
            if (!parsedUri.isValidUrl) {
                var fileStream = fs.createReadStream(parsedUri.path);

                fileStream.on('data', function (data) {
                    req.write(data);
                });
                
                fileStream.on('end', function() {
                    req.write(MULTIPART_END);
                    req.end();
                });
                
                fileStream.on('error', function(err) {
                    req.destroy(err);
                });
            }
            else {
                var downloadProtocol = utils.getProtocol(parsedUri);
                var downloadOptions = utils.getRequestOptions('GET', parsedUri, uploadOptions.downloadHeaders, uploadOptions.downloadAgent);
                var downloadReq = downloadProtocol.request(downloadOptions, function(res) {
                    if ((res.statusCode < 200) || (res.statusCode >= 300)) {
                        downloadReq.destroy('Invalid response from remote file server. statusCode: ' + res.statusCode);
                    }
                    res.on('data', function (data) {
                        req.write(data);
                    });
                    res.on('end', function() {
                        req.write(MULTIPART_END);
                        req.end();
                    });
                });
                downloadReq.on('error', function(err) {
                    req.destroy(err);
                });
                downloadReq.end();
            }
        });
    });

    req.on('error', function(err) {
        return callback(err);
    });
}

/**
 * [head description]
 * 
 * @param  {[type]}   url           [description]
 * @param  {[type]}   uploadOptions [description]
 * @param  {[type]}   redirectCount [description]
 * @param  {Function} callback      [description]
 * @return {[type]}                 [description]
 */
function head (url, uploadOptions, redirectCount, callback) {

    var options = utils.getRequestOptions('HEAD', url, uploadOptions.downloadHeaders, uploadOptions.downloadAgent);

    var downloadProtocol = utils.getProtocol(url);

    var req = downloadProtocol.request(options, function(res) {

        try {
            if ((res.statusCode == 301) || (res.statusCode == 302)) {
                if (redirectCount >= uploadOptions.maxRedirects) {
                    return callback('Redirect count reached. Aborting upload.');
                }

                var location = res.headers.location;
                if (location) {
                    redirectCount++;
                    var redirectUrl = utils.parseUri(location);
                    return head(redirectUrl, uploadOptions, redirectCount, callback);
                }
            }

            if ((res.statusCode < 200) || (res.statusCode >= 300)) {
                return callback('Invalid response from remote file server. statusCode: ' + res.statusCode);
            }

            var contentLength = parseInt(res.headers['content-length'], 10);

            if (isNaN(contentLength)) {
                return callback('Remote web server returned an invalid content length');
            }

            if (!utils.validateFileSize(uploadOptions.maxFileSize, contentLength)) {
                return callback('File is too large. maxFileSize: ' + uploadOptions.maxFileSize + ', content-length: ' + contentLength);
            }

            // can we bail out early?
            if (uploadOptions.downloadFileName) {
                return callback(null, url, contentLength, uploadOptions.downloadFileName);
            }

            // no download specified, attempt to parse one out
            var file, ext, mimeExt;

            var contentType = res.headers['content-type'].split(';')[0];

            // attempt to get the filename from the url
            file = utils.sanitizeFileName(path.basename(url.pathname));

            if (file) {
                ext = path.extname(file);
                file = file.replace(ext, '');
                ext = ext.replace('.', '');
                
                if (ext) {
                
                    mimeExt = mimetypes.extension(contentType);

                    if (mimeExt) {
                        if (ext.toLowerCase() !== '.' + mimeExt.toLowerCase()) {
                            ext = mimeExt;
                        }
                    }
                }
            }

            // default file name if we couldn't parse one
            if (!file) { 
                file = 'poster'; 
            }

            // default file extension if we cannot find one (unlikely)
            if (!ext) {
                ext = 'unk';

                if (contentType) {
                    mimeExt = mimetypes.extension(contentType);
                
                    if (mimeExt) {
                        ext = mimeExt;
                    }
                }
            }

            return callback(null, url, contentLength, file + '.' + ext);
        }
        catch (e) {
            callback(e);
        }
    });
    req.on('error', function(e) {
        callback(e);
    });
    req.end();
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

            if (parsedUri.isValidUrl) {
            
                head(parsedUri, uploadOptions, 0, function(err, fileUrl, fileSize, fileName) {
                    
                    if (err) {
                        return callback(err);
                    }
                    
                    upload(uploadUrl, fileUrl, uploadOptions, fileSize, fileName, callback);
                });
            }
            else {
            
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
        }
        catch (e) {
            callback(e);
        }
    }
};

