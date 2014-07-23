var http = require('http');

function buffer_concat(buffers,nread){
    var buffer = null;
    switch(buffers.length) {
        case 0: buffer = new Buffer(0);
            break;
        case 1: buffer = buffers[0];
            break;
        default:
            buffer = new Buffer(nread);
            for (var i = 0, pos = 0, l = buffers.length; i < l; i++) {
                var chunk = buffers[i];
                chunk.copy(buffer, pos);
                pos += chunk.length;
            }
        break;
    }
    return buffer.toString()
}

function errorHandler(err, message) {
    if (err) {
        if (err.socket && (err.statusCode < 200 || err.statusCode > 299)) {
            var data = '';
            var buffers = [];
            var nread = 0;
            err.on('data', function (chunk) {
                buffers.push(chunk);
                nread += chunk.length;
            });
            err.on('end', function () {
                data = buffer_concat(buffers, nread);
                console.log("Host %s responded to %s request on endpoint %s with an error: \n %s".red,
                    err.socket._httpMessage._headers.host, err.socket._httpMessage.method, err.socket._httpMessage.path, data);
            });
        }
        if (err.message) {
            console.log(err.message.red);
        }
        if (message) {
            console.log(message.red);
        }
    }
}

function httpOptions(httpProxy, host, port, auth, path) {
    return httpOptions(httpProxy, host, port, auth, path, 'GET', {});
}

function httpOptions(httpProxy, host, port, auth, path, method, headers) {
    if(httpProxy) {
        var httpProxySplit = httpProxy.split(":");
        var fullPath = 'http://' + host + ':' + port + path
        return { host: httpProxySplit[0], port: httpProxySplit[1], path: fullPath, auth: auth, method: method, headers: headers };
    } else {
        return { host: host, port: port, path: path, auth: auth };
    }
}

function sourceGetHttpOptions(opts, path) {
    return httpOptions(opts.httpProxy, opts.sourceHost, opts.sourcePort, opts.sourceAuth, path);
}

function sourcePostHttpOptions(opts, path, headers) {
    return httpOptions(opts.httpProxy, opts.sourceHost, opts.sourcePort, opts.SourceAuth, path, 'POST', headers);
}

function targetPutHttpOptions(opts, path, headers) {
    return httpOptions(opts.httpProxy, opts.targetHost, opts.targetPort, opts.targetAuth, path, 'PUT', headers);
}

function targetPostHttpOptions(opts, path, headers) {
    return httpOptions(opts.httpProxy, opts.targetHost, opts.targetPort, opts.targetAuth, path, 'POST', headers);
}

/**
 * Resets all stored states of this driver and allows to start over from the beginning without restarting.
 */
exports.reset = function(opts) {
    http.globalAgent.maxSockets = opts.maxSockets;
    exports.scrollId = null;
};

/**
 * Fetches general statistical in informational data from the target database.
 * @param opts
 * @param callback Callback function without a parameter. The stats result will be attached to the opts object.
 */
exports.getTargetStats = function(opts, callback) {
    var tmpOpts = {
        sourceHost: opts.targetHost,
        sourcePort: opts.targetPort,
        sourceAuth: opts.targetAuth,
        httpProxy: opts.httpProxy
    };
    exports.getSourceStats(tmpOpts, function() {
        opts.targetStats = tmpOpts.sourceStats;
        callback();
    });
};

/**
 * Fetches general statistical in informational data from the source database.
 * @param opts
 * @param callback Callback function without a parameter. The stats result will be attached to the opts object.
 */
exports.getSourceStats = function(opts, callback) {
    if (opts.logEnabled) {
        console.log('HTTP Proxy: ' + opts.httpProxy);
        console.log('Reading source statistics from ElasticSearch');
    }

    opts.sourceStats = {
        version: false,
        cluster_status: false,
        docs: false,
        aliases: false
    };
    function done() {
        for (var prop in opts.sourceStats) {
            if (!opts.sourceStats[prop]) {
                return;
            }
        }
        opts.sourceStats['retries'] = 0;
        callback();
    }

    var serverStatusOptions = sourceGetHttpOptions(opts, '/');
    var serverStatusReq = http.request(serverStatusOptions, function (res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function (chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function () {
            data = buffer_concat(buffers,nread);
            data = JSON.parse(data);
            opts.sourceStats.version = data.version.number;
            done();
        });
    });
    serverStatusReq.on('error', errorHandler);
    serverStatusReq.end();

    var clusterHealthOptions = sourceGetHttpOptions(opts, '/_cluster/health');
    var clusterHealthReq = http.request(clusterHealthOptions, function (res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function (chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function () {
            data = buffer_concat(buffers, nread);
            data = JSON.parse(data);
            opts.sourceStats.cluster_status = data.status;
            done();
        });
    });
    clusterHealthReq.on('error', errorHandler);
    clusterHealthReq.end();

    var clusterStateOptions = sourceGetHttpOptions(opts, '/_cluster/state');
    var clusterStateReq = http.request(clusterStateOptions, function (res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function (chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function () {
            data = buffer_concat(buffers, nread);
            data = JSON.parse(data);
            var aliases = {};
            for (var index in data.metadata.indices) {
                if (data.metadata.indices[index].aliases.length) {
                    data.metadata.indices[index].aliases.forEach(function(alias) {
                        aliases[alias] = index;
                    });
                }
            }
            opts.sourceStats.aliases = aliases;
            done();
        });
    });
    clusterStateReq.on('error', errorHandler);
    clusterStateReq.end();

    var statusOptions = sourceGetHttpOptions(opts, '/_status');
    var statusReq = http.request(statusOptions, function (res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function (chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function () {
            data = buffer_concat(buffers, nread);
            data = JSON.parse(data);
            var indices = {};
            var total = 0;
            for (var index in data.indices) {
                indices[index] = data.indices[index].docs.num_docs;
                total += indices[index];
            }
            opts.sourceStats.docs = {
                indices: indices,
                total: total
            };
            done();
        });
    });
    statusReq.on('error', errorHandler);
    statusReq.end();
};

/**
 * Returns both settings and mappings depending on which scope is set in opts.
 * The resulting object is as close to the format that is sent to ES as possible.
 * For the all scope the returned object holds the proper requests stored under the name of each index.
 * @param opts
 * @param callback Callback function that receives the meta data object as first parameter
 */
exports.getMeta = function(opts, callback) {
    if (opts.logEnabled) {
        console.log('Reading mapping from ElasticSearch');
    }
    var source = '/';
    if (opts.sourceIndex) {
        source += opts.sourceIndex + '/';
    }
    if (opts.sourceType) {
        source += opts.sourceType + '/';
    }

    var options = sourceGetHttpOptions(opts, source + '_mapping');
    var req = http.request(options, function(res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function(chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function() {
            data = buffer_concat(buffers,nread);
            data = JSON.parse(data);
            if (opts.sourceType) {
                getSettings(opts, data, callback);
            } else if (opts.sourceIndex) {
                getSettings(opts, { mappings: data[opts.sourceIndex] }, callback);
            } else {
                var metadata = {};
                for (var index in data) {
                    metadata[index] = {
                        mappings: data[index].mappings ? data[index].mappings : data[index]
                    };
                }
                getSettings(opts, metadata, callback);
            }
        });
    });
    req.on('error', errorHandler);
    req.end();
};

/**
 * Does the settings request after the mapping has been fetched. Settings are not fetched for a type request,
 * as the index that is created when a type does not exists is only there to ensure that data can be copied.
 * To ensure the full copy including mappings, at least an index export should be done.
 *
 * @param opts
 * @param metadata
 * @param callback Callback function that receives the meta data object as first parameter
 */
function getSettings(opts, metadata, callback) {
    var source = '/';
    if (opts.sourceIndex) {
        source += opts.sourceIndex + '/';
    }
    if (opts.sourceType) {
        callback(metadata);
        return;
    }
    // Get settings for either 'index' or 'all' scope
    var options = sourceGetHttpOptions(opts, source + '_settings');
    var req = http.request(options, function (res) {
        var data = '';
        var buffers = [];
        var nread = 0;
        res.on('data', function (chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        res.on('end', function () {
            data = buffer_concat(buffers,nread);
            data = JSON.parse(data);
            if (opts.sourceIndex) {
                metadata.settings = data[opts.sourceIndex].settings;
            } else {
                for (var index in data) {
                    metadata[index].settings = data[index].settings;
                }
            }
            callback(metadata);
        });
    })
    req.on('error', errorHandler);
    req.end();
}

/**
 * Stores the meta data according to the scope that is set through the opts.
 *
 * @param opts
 * @param metadata
 * @param callback Callback method that will called once the meta data has been stored. No significant data is passed via arguments.
 */
exports.storeMeta = function(opts, metadata, callback) {
    if (opts.sourceType) {
        storeTypeMeta(opts, metadata, callback);
    } else if (opts.sourceIndex) {
        storeIndexMeta(opts, metadata, callback);
    } else {
        storeAllMeta(opts, metadata, callback);
    }
};

/**
 * Does the actual store operation for a type metadata. When storing types, only mapping data is stored.
 * This is different then the index or all scope, as it uses the put mapping request.
 *
 * @param opts
 * @param metadata
 * @param callback Callback method that will called once the meta data has been stored. No significant data is passed via arguments.
 */
function storeTypeMeta(opts, metadata, callback) {
    if (opts.logEnabled) {
        console.log('Creating type mapping in target ElasticSearch instance');
    }

    var createIndexOptions = targetPutHttpOptions(opts, '/' + opts.targetIndex, {
        "Content-Length": 0
    });
    var createIndexReq = http.request(createIndexOptions, function() {
        var path,
            buffer = new Buffer(JSON.stringify(metadata), 'utf8');

        if (opts.targetStats.version.substring(0,4) == '0.9.') {
            path = '/' + opts.targetIndex + '/' + opts.targetType + '/_mapping';
        } else {
            path = '/' + opts.targetIndex + '/_mapping/' + opts.targetType + '/';
        }
        var typeMapOptions = targetPutHttpOptions(opts, path, {
            "Content-Length": buffer.length
        });
        var typeMapReq = http.request(typeMapOptions, function(err) {
            errorHandler(err);
            callback();
        });
        typeMapReq.on('error', errorHandler);
        typeMapReq.end(buffer);
    });
    createIndexReq.on('error', errorHandler);
    createIndexReq.end();
}

/**
 * Stores the index mappings and settings data via a create index call.
 *
 * @param opts
 * @param metadata
 * @param callback Callback method that will called once the meta data has been stored. No significant data is passed via arguments.
 */
function storeIndexMeta(opts, metadata, callback) {
    if (opts.logEnabled) {
        console.log('Creating index mapping in target ElasticSearch instance');
    }

    var buffer = new Buffer(JSON.stringify(metadata), 'utf8');
    
    var createIndexOptions = targetPutHttpOptions(opts, '/' + opts.targetIndex, {
        "Content-Length": buffer.length
    });
    var createIndexReq = http.request(createIndexOptions, function (err) {
        errorHandler(err);
        callback();
    });
    createIndexReq.on('error', errorHandler);
    createIndexReq.end(buffer);
}

/**
 * Stores the mappings and settings of all passed in indices via several create index calls.
 *
 * @param opts
 * @param metadata The meta data object, how it was retrieved from the #getMeta() function.
 * @param callback Callback method that will called once the meta data has been stored. No significant data is passed via arguments.
 */
function storeAllMeta(opts, metadata, callback) {
    if (opts.logEnabled) {
        console.log('Creating entire mapping in target ElasticSearch instance');
    }
    var numIndices = 0;
    var indicesDone = 0;

    function done(response) {
        indicesDone++;
        if (numIndices == indicesDone) {
            callback();
        }
        response.resume();
    }
    for (var index in metadata) {
        numIndices++;
        var buffer = new Buffer(JSON.stringify(metadata[index]), 'utf8')

        var createIndexOptions = targetPutHttpOptions(opts, '/' + index, {
          "Content-Length": buffer.length
        });
        var createIndexReq = http.request(createIndexOptions, done);
        createIndexReq.on('error', errorHandler);
        createIndexReq.end(buffer);
    }
}

/**
 * Fetches data from ElasticSearch via a scroll/scan request.
 *
 * @param opts
 * @param callback Callback which is called when data has been received with the first argument as an array of hits,
 *        and the second the number of total hits.
 * @param retries Should not be set from the calling method, as this is increase through recursion whenever a call fails
 */
exports.getData = function(opts, callback, retries) {
    if (!retries) {
        retries = 0;
    } else {
        if (retries == opts.errorsAllowed) {
            console.log('Maximum number of retries for fetching data reached. Aborting!');
            process.exit(1);
        }
        opts.sourceStats.retries++;
        retries++;
    }

    var query = {
        fields : [
            '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
        ],
        size : opts.sourceSize,
        query : opts.sourceQuery
    };
    if (opts.sourceIndex) {
        query = {
            fields : [
                '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
            ],
            size : opts.sourceSize,
            query : {
                indices : {
                    indices : [
                        opts.sourceIndex
                    ],
                    query : opts.sourceQuery,
                    no_match_query : 'none'
                }
            }
        };
    }
    if (opts.sourceType) {
        query = {
            fields : [
                '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
            ],
            size : opts.sourceSize,
            query : {
                indices : {
                    indices : [
                        opts.sourceIndex
                    ],
                    query : opts.sourceQuery,
                    no_match_query : 'none'
                }
            },
            filter : {
                type : {
                    value : opts.sourceType
                }
            }
        };
    }

    function handleResult(result) {
        if (result.statusCode < 200 || result.statusCode > 299) {
            setTimeout(function () {
                exports.getData(opts, callback, retries);
            }, 1000);
        }
        var data = '';
        var buffers = [];
        var nread = 0;
        result.on('data', function(chunk) {
            buffers.push(chunk);
            nread += chunk.length;
        });
        result.on('end', function() {
            try {
                data = buffer_concat(buffers,nread);
                data = JSON.parse(data);
            } catch (e) {}
            exports.scrollId = data._scroll_id;
            callback(data.hits.hits, data.hits.total);
        });
    }

    if (exports.scrollId !== null) {
        var buffer = new Buffer(exports.scrollId, 'utf8');

        var scrollOptions = sourcePostHttpOptions(opts, '/_search/scroll?scroll=60m', {
            "Content-Length": buffer.length
        });
        var scrollReq = http.request(scrollOptions, handleResult);
        scrollReq.on('error', function(err) {
            errorHandler(err);
            setTimeout(function() {
                exports.getData(opts, callback, retries);
            }, 1000);
        });
        scrollReq.end(buffer);
    } else {
        var buffer = new Buffer(JSON.stringify(query), 'utf8');
        var firstOptions = sourcePostHttpOptions(opts, '/_search?search_type=scan&scroll=60m', {
            "Content-Length": buffer.length
        });
        var firstReq = http.request(firstOptions, handleResult);
        firstReq.on('error', function (err) {
            errorHandler(err);
            setTimeout(function () {
                exports.getData(opts, callback, retries);
            }, 1000);
        });
        firstReq.end(buffer);
    }
};

/**
 * Stores data using a bulk request.
 *
 * @param opts
 * @param data The data to transmit in ready to use bulk format.
 * @param callback Callback function that is calld without any arguments when the data has been stored.
 * @param retries Should not be set from the calling method, as this is increase through recursion whenever a call fails
 */
exports.storeData = function(opts, data, callback, retries) {
    if (!retries) {
        retries = 0;
    } else {
        if (retries == opts.errorsAllowed) {
            console.log('Maximum number of retries for writing data reached. Aborting!');
            process.exit(1);
        }
        opts.targetStats.retries++;
        retries++;
    }

    var buffer = new Buffer(data, 'utf8');

    var putOptions= targetPostHttpOptions(opts, '/_bulk', {
        "Content-Length": buffer.length
    });
    var putReq = http.request(putOptions, function(res) {
        //Data must be fetched, otherwise socket won't be set to free
        var str = '';
        res.on('data', function (chunk) { str += chunk; });
        res.on('end',function() {
            var esRes = JSON.parse(str)
            if(esRes.errors){
                for (var i in esRes.items){
                    var item = esRes.items[i]
                    if(item.index.status/100  != 2){
                        errorHandler({"message":JSON.stringify(item)})
                        break;
                    }
                }
                setTimeout(function () {
                    exports.storeData(opts, data, callback, retries);
                }, 1000);
            }else{
                callback()
            }
        });
    });
    putReq.on('error', function (err) {
        errorHandler(err);
        setTimeout(function () {
            exports.storeData(opts, data, callback, retries);
        }, 1000);
    });
    putReq.end(buffer);
};
