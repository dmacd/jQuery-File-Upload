#!/usr/bin/env node
/*
 * jQuery File Upload Plugin Node.js Example 1.0.4
 * https://github.com/blueimp/jQuery-File-Upload
 *
 * Copyright 2012, Sebastian Tschan
 * https://blueimp.net
 *
 * Extennsibility modifications by Daniel MacDonald
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 */

/*jslint nomen: true, regexp: true, unparam: true, stupid: true */
/*global require, __dirname, unescape, console */



    'use strict';
    var path = require('path'),
        fs = require('fs'),
        // Since Node 0.8, .existsSync() moved from path to fs:
        _existsSync = fs.existsSync || path.existsSync,

        nodeStatic = require('node-static'),
        imageMagick = require('imagemagick'),
        formidable = require('formidable'),

        options = {
            tmpDir: __dirname + '/tmp',
            publicDir: __dirname + '/public',
            uploadDir: __dirname + '/public/files',
            uploadUrl: '/files/',
            maxPostSize: 11000000000, // 11 GB
            minFileSize: 1,
            maxFileSize: 10000000000, // 10 GB
            acceptFileTypes: /.+/i,
            // Files not matched by this regular expression force a download dialog,
            // to prevent executing any scripts in the context of the service domain:
            safeFileTypes: /\.(gif|jpe?g|png)$/i,
            imageTypes: /\.(gif|jpe?g|png)$/i,
            imageVersions: {
                'thumbnail': {
                    width: 80,
                    height: 80
                }
            },
            accessControl: {
                allowOrigin: '*',
                allowMethods: 'OPTIONS, HEAD, GET, POST, PUT, DELETE'
            },
            /* Uncomment and edit this section to provide the service via HTTPS:
            ssl: {
                key: fs.readFileSync('/Applications/XAMPP/etc/ssl.key/server.key'),
                cert: fs.readFileSync('/Applications/XAMPP/etc/ssl.crt/server.crt')
            },
            */
            nodeStatic: {
                cache: 3600 // seconds to cache served files
            }
        },
        utf8encode = function (str) {
            return unescape(encodeURIComponent(str));
        },
        fileServer = new nodeStatic.Server(options.publicDir, options.nodeStatic),
        nameCountRegexp = /(?:(?: \(([\d]+)\))?(\.[^.]+))?$/,
        nameCountFunc = function (s, index, ext) {
            return ' (' + ((parseInt(index, 10) || 0) + 1) + ')' + (ext || '');
        },
        FileInfo = function (file) {
            this.name = file.name;
            this.size = file.size;
            this.type = file.type;
            this.delete_type = 'DELETE';
        },
        UploadHandler = function (req, res, callback) {
            this.req = req;
            this.res = res;
            this.callback = callback;
        },
        serve = function (req, res, response_callback) {
            res.setHeader(
                'Access-Control-Allow-Origin',
                options.accessControl.allowOrigin
            );
            res.setHeader(
                'Access-Control-Allow-Methods',
                options.accessControl.allowMethods
            );
            var handleResult = function (result, redirect) {
                    if (redirect) {
                        res.writeHead(302, {
                            'Location': redirect.replace(
                                /%s/,
                                encodeURIComponent(JSON.stringify(result))
                            )
                        });
                        res.end();
                    } else {
                        /*
                           call success handler here to commit files to DB if they exist in the upload directory
                           the DB needs to know which document it is attaching to:
                           - could have the client prepend the id --> but then have to check permissions on it
                           - could have the client send it in the query params --> still have to check permissions...should be better as it wont expose to '/'s in the filenames
                           - TODO: a couch-attacher module which
                        */
                        response_callback(req, res, result, function()
                        {
                            res.writeHead(200, {
                                'Content-Type': req.headers.accept
                                    .indexOf('application/json') !== -1 ?
                                            'application/json' : 'text/plain'
                            });
                            res.end(JSON.stringify(result));
                        });

                    }
                },
                setNoCacheHeaders = function () {
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                    res.setHeader('Content-Disposition', 'inline; filename="files.json"');
                },
                handler = new UploadHandler(req, res, handleResult);
            switch (req.method) {
            case 'OPTIONS':
                res.end();
                break;
            case 'HEAD':
            case 'GET':
                if (req.url === '/') {
                    setNoCacheHeaders();
                    if (req.method === 'GET') {
                        handler.get();
                    } else {
                        res.end();
                    }
                } else {
                    fileServer.serve(req, res);
                }
                break;
            case 'POST':
                setNoCacheHeaders();
                handler.post();
                break;
            case 'DELETE':
                handler.destroy();
                break;
            default:
                res.statusCode = 405;
                res.end();
            }
        };

    fileServer.respond = function (pathname, status, _headers, files, stat, req, res, finish) {
        if (!options.safeFileTypes.test(files[0])) {
            // Force a download dialog for unsafe file extensions:
            res.setHeader(
                'Content-Disposition',
                'attachment; filename="' + utf8encode(path.basename(files[0])) + '"'
            );
        } else {
            // Prevent Internet Explorer from MIME-sniffing the content-type:
            res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        nodeStatic.Server.prototype.respond
            .call(this, pathname, status, _headers, files, stat, req, res, finish);
    };
    FileInfo.prototype.validate = function () {
        if (options.minFileSize && options.minFileSize > this.size) {
            this.error = 'File is too small';
        } else if (options.maxFileSize && options.maxFileSize < this.size) {
            this.error = 'File is too big';
        } else if (!options.acceptFileTypes.test(this.name)) {
            this.error = 'Filetype not allowed';
        }
        return !this.error;
    };
    FileInfo.prototype.safeName = function () {
        // Prevent directory traversal and creating hidden system files:
        this.name = path.basename(this.name).replace(/^\.+/, '');
        // Prevent overwriting existing files:
        while (_existsSync(options.uploadDir + '/' + this.name)) {
            this.name = this.name.replace(nameCountRegexp, nameCountFunc);
        }
    };
    FileInfo.prototype.initUrls = function (req) {
        if (!this.error) {
            var that = this,
                baseUrl = (options.ssl ? 'https:' : 'http:') +
                    '//' + req.headers.host + options.uploadUrl;
            this.url = this.delete_url = baseUrl + encodeURIComponent(this.name);
            Object.keys(options.imageVersions).forEach(function (version) {
                if (_existsSync(
                        options.uploadDir + '/' + version + '/' + that.name
                    )) {
                    that[version + '_url'] = baseUrl + version + '/' +
                        encodeURIComponent(that.name);
                }
            });
        }
    };
    UploadHandler.prototype.get = function () {
        var handler = this,
            files = [];
        fs.readdir(options.uploadDir, function (err, list) {
            list.forEach(function (name) {
                var stats = fs.statSync(options.uploadDir + '/' + name),
                    fileInfo;
                if (stats.isFile()) {
                    fileInfo = new FileInfo({
                        name: name,
                        size: stats.size
                    });
                    fileInfo.initUrls(handler.req);
                    files.push(fileInfo);
                }
            });
            handler.callback(files);
        });
    };
    UploadHandler.prototype.post = function () {
        var handler = this,
            form = new formidable.IncomingForm(),
            tmpFiles = [],
            files = [],
            map = {},
            counter = 1,
            redirect,
            finish = function (err, stdout, stderr/*djm: add some error reporting*/) {
                console.log("UploadHandler.finish: " + JSON.stringify({ counter: counter, err: err, stdout: stdout, stderr: stderr }));
                counter -= 1;
                if (!counter) {
                    files.forEach(function (fileInfo) {
                        fileInfo.initUrls(handler.req);
                    });
                    handler.callback(files, redirect);
                }
            };
        /* DJM */ console.log('UploadHandler.post:' + JSON.stringify(form));
        form.uploadDir = options.tmpDir;
        form.on('fileBegin', function (name, file) {

            /* DJM */ console.log('UploadHandler.post:form.fileBegin...');

            tmpFiles.push(file.path);
            var fileInfo = new FileInfo(file, handler.req, true);
            fileInfo.safeName();
            map[path.basename(file.path)] = fileInfo;
            files.push(fileInfo);

            /* DJM */ console.log('UploadHandler.post:form.fileBegin' + JSON.stringify(file));
        }).on('field', function (name, value) {
                /* DJM */ console.log('UploadHandler.post:form.field...');

                if (name === 'redirect') {
                redirect = value;
            }
        }).on('file', function (name, file) {
                /* DJM */ console.log('UploadHandler.post:form.file...');
            var fileInfo = map[path.basename(file.path)];
            fileInfo.size = file.size;
            if (!fileInfo.validate()) {
                fs.unlink(file.path);
                return;
            }
            fs.renameSync(file.path, options.uploadDir + '/' + fileInfo.name);
            if (options.imageTypes.test(fileInfo.name)) {
                Object.keys(options.imageVersions).forEach(function (version) {
                    counter += 1;
                    var opts = options.imageVersions[version];
                    imageMagick.resize({
                        width: opts.width,
                        height: opts.height,
                        srcPath: options.uploadDir + '/' + fileInfo.name,
                        dstPath: options.uploadDir + '/' + version + '/' +
                            fileInfo.name
                    }, finish);
                });
            }
        }).on('aborted', function () {
                /* DJM */ console.log('UploadHandler.post:form.aborted...');
            tmpFiles.forEach(function (file) {
                fs.unlink(file);
            });
        }).on('error', function (e) {
                /* DJM */ console.log('UploadHandler.post:form.error...');
            console.log(e);
        }).on('progress', function (bytesReceived, bytesExpected) {
                /* DJM */ console.log('UploadHandler.post:form.progress...');
            if (bytesReceived > options.maxPostSize) {
                handler.req.connection.destroy();
            }
        }).on('end', finish).parse(handler.req);
    };
    UploadHandler.prototype.destroy = function () {
        var handler = this,
            fileName;
        if (handler.req.url.slice(0, options.uploadUrl.length) === options.uploadUrl) {
            fileName = path.basename(decodeURIComponent(handler.req.url));
            fs.unlink(options.uploadDir + '/' + fileName, function (ex) {
                Object.keys(options.imageVersions).forEach(function (version) {
                    fs.unlink(options.uploadDir + '/' + version + '/' + fileName);
                });
                handler.callback(!ex);
            });
        } else {
            handler.callback(false);
        }
    };


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Exported interface

exports.options = options;

/**
 * @description The serving portion of the upload handler
 * @param {req} req    port number to listen on
 * @param {res} res    port number to listen on*
 * @param {function} response_callback(req, res, results, finish) callback called just before issuing response to client.
 *              The finish parameter sends the response, which is just to stringify the contents of result.
 *              Results contains a list of fileInfo objects in the case of GET and POST requests.
 */
exports.serve = serve;



exports.listen  = function (port)
    {

        if (options.ssl) {
            require('https').createServer(options.ssl, serve).listen(port);
        } else {
            require('http').createServer(serve).listen(port);
        }
    };
//};
