// 创建一个新的列表
var _ = require('underscore'),

    Memcached = require('memcached'),

    OK = 'ok',
    ERR = 'err',
    CONN = 'conn',

    NO_AVAILABLE_SERVER = 'no_available_server',

    md5 = require('./md5');

// 为 IP 地址补充 0 方便排序
function add0(str) {
    if (!/(\d{1,3}\.){3}\d{1,3}/.test(str)) {
        return str;
    }

    str = str.split(':');
    var parts = str[0].split('.'),
        port = str[1];
    parts = _.map(parts, function (part, index) {
        part = Number(part);
        if (part < 10) {
            return '00' + part;
        } else if (part < 100) {
            return '0' + part;
        } else {
            return part;
        }
    });
    return parts.join('.') + ':' + port;
}

var HA = function () {

    // [
    //     {
    //         addr: '',
    //         md5: '', // addr 的 MD5 值
    //         errTimes: 0, // 出错次数
    //         status: 'ok', // err
    //         msg: '', // 错误信息
    //         conn: // 实际连接
    //     }
    // ]
    this.servers = [];

    // {
    //     '00': mcObj1,
    //     '01': mcObj2
    // }
    this.serverMap = {};

    this.options = {
            // 失败重试间隔，毫秒
            retry: 100,
            // 失败重试次数
            retries: 0,
            // 超时时间，毫秒
            timeout: 1000,
            // 失败多少次后认为是MC死了
            failures: 0,
            // 重新尝试连接间隔，毫秒
            reconnect: 10000000,
            // 延长连接超时时间
            idle: 30000,
            // 保存多少份数据，默认 2 份
            copies: 2
        };

    var that = this,

        argCount = 0;

    _.each(arguments, function () {
        argCount++;
    });

    // 实现 overload
    _.each(arguments, function (arg, index) {
        var isLast = (index === argCount - 1);

        if (_.isArray(arg)) {
            _.each(arg, function (addr) {
                that.addServer(addr);
            });

        } else if (_.isString(arg)) {
            that.addServer(addr);

        } else if (_.isObject(arg)) {
            if (!isLast) {
                _.each(arg, function (value, key) {
                    that.addServer(key);
                });
            } else {
                _.extand(that.options, arg);
            }
        }
    });

    // 将服务器按照地址进行由小到大排序
    this.sortAddrs();

    // 映射 key 与服务器
    this.allotServers();

    // 初始化服务器连接
    this.initServer();

    return this;
};

HA.prototype.createServer = function (server, options) {
    // 清除定时器
    server.timer = null;

    // 已经正在连接中，不再尝试
    if (server.status === CONN) {
        return;
    }

    // 如果已经存在连接，则先结束现有连接
    if (server.conn) {
        try {
            console.log('server', server.addr, 'has prev conn, try to end it');
            server.conn.end();
            console.log('server', server.addr, 'has ended prev conn');
        } catch(e) {
            console.error('end server', server.addr, 'error', e);
        }
    }

    var that = this,
        addr = server.addr,
        conn = new Memcached(server.addr, options);

    // 监听 mc 的各种事件，并更新状态
    conn.on('issue', function (e) {
        server.status = ERR;
        console.log('issue', e);
    });
    conn.on('reconnected', function (e) {
        server.status = OK;
        console.log('reconnected', e);
    });
    conn.on('remove', function (e) {
        server.status = ERR;
        console.log('remove', e);
    });
    conn.on('failure', function (details) {
        server.status = ERR;
        console.log( "Server " + details.server + "went down due to: " + details.messages.join( '' ) );
    });
    conn.on('reconnecting', function (details) {
        server.status = ERR;
        console.log('reconnecting.......', details);
        console.log('has tried', details.totalReconnectsAttempted);
        console.log('Total downtime caused by server ' + details.server + ' :' + details.totalDownTime + 'ms');
    });

    // 将连接状态置为连接中
    server.status = CONN;
    server.conn = conn;

    // 尝试 get 和 set 测试连接是否成功和有效
    var key = '___init_test_',
        value = Math.random();
    console.log('start test server', server.addr, value);
    conn.set(key, value, 10, function (err) {
        if (!err) {
            conn.get(key, function (err, data) {
                console.log('test get', server.addr, value === data);
                if (!err & value === data) {
                    that.markOK(server);
                } else {
                    that.markError(server);
                    console.error('test get server', server.addr, 'fail', err);
                }
            });
        } else {
            that.markError(server);
            console.error('test set server', server.addr, 'fail', err);
        }
    });
};

HA.prototype.initServer = function () {
    var that = this;
    _.each(this.servers, function (server, index) {
        that.createServer(server, that.options);
    });
};

// 添加服务器
HA.prototype.addServer = function (addr) {
    this.servers.push({
        addr: addr
    });
};

// 服务器按照地址排序
HA.prototype.sortAddrs = function () {
    this.servers.sort(function (a, b) {
        return add0(a.addr) > add0(b.addr);
    });
};

// 服务器按照状态和权重排序
HA.prototype.sortServers = function () {
    console.log('resort server weight');
    _.each(this.serverMap, function (servers, key) {
        servers.sort(function (a, b) {
            var aw = a.weight[key],
                bw = b.weight[key],
                as = a.status,
                bs = b.status;
            if (as !== OK) {
                aw = 0;
            }
            if (bs !== OK) {
                bw = 0;
            }
            return aw < bw;
        });
    });
};

// 为不同的 key 值分配不同的主备服务器
HA.prototype.allotServers = function () {
    this.servers.forEach(function (server) {
        server.md5 = md5(server.addr);
    });
    var that = this,
        c = '0123456789abcdef'.split(''),
        serverCount = this.servers.length;
    // 第一遍
    for (var i = 0; i < this.options.copies; i++) {
        var j = i,
            // 权重
            weight = 100 - j;
        c.forEach(function (c1) {
            c.forEach(function (c2) {
                var key = c1 + c2;
                if (!that.serverMap[key]) {
                    that.serverMap[key] = [];
                }
                var server = that.servers[j];
                if (!server.weight) {
                    server.weight = {};
                }
                // 设置相对应的权重
                server.weight[key] = weight;
                that.serverMap[key].push(server);
                j++;
                if (j === serverCount) {
                    j = 0;
                }
            });
        });
    }
};

// 根据 key 获取服务器列表，用于写操作
HA.prototype.getServers = function (key) {
    var key = md5(key).substring(0, 2),
        servers = this.serverMap[key];
    return servers;
};

// 根据 key 和顺序获取指定服务器，用于读操作
HA.prototype.getServer = function (key, index) {
    var servers = this.getServers(key);
    return servers[index];
};

// 为某个服务器添加错误信息/标识，并尝试重新连接服务器
HA.prototype.markError = function (server) {
    var that = this,
        t = 1000;

    // 标记为错误
    server.status = ERR;
    server.errTimes++;
    console.log('server', server.addr, 'error times', server.errTimes);
    
    // 调整可用服务器顺序
    this.sortServers();

    // 如果超过 30 次重试，后续的需要等待 30 秒才进行一次重试
    if (server.errTimes > 30) {
        t = 30000;
    }
    if (!server.timer) {
        server.timer = setTimeout(function () {
            that.createServer(server);
        }, t);
    }
};

// 服务恢复可用，清除错误标识
HA.prototype.markOK = function (server) {
    var that = this;

    // 标记为正常
    server.status = OK;
    server.errTimes = 0;
    clearTimeout(server.timer);

    // 调整可用服务器顺序
    // 由于刚恢复服务，为了保证之前的数据可以正常读取
    // 因此暂时不调整服务器权重排序，等待一段时间后再恢复
    setTimeout(function () {
        that.sortServers();
    }, 30000);
};

// 读操作，只需要执行一次，只从其中一台服务器读数据
_.each(['get', 'gets', 'getMulti'], function (fn) {
    HA.prototype[fn] = function (key) {
        var that = this,
            server,
            conn,
            args = Array.prototype.slice.call(arguments),
            callback = args[args.length - 1],
            i = 0,
            hasCalled = false;

        args.pop();
        args.push(function (err) {
            if (err) {
                that.markError(server);
            }
            var arr = Array.prototype.slice.call(arguments);
            arr.push(server);
            callback.apply(conn, arr);
        });

        // 找出一个可用的服务器
        while (i < this.options.copies) {
            try {
                server = this.getServer(key, i);
                console.log('found get server', i, server.addr, server.status);
                if (server && server.status === OK) {
                    conn = server.conn;
                    conn[fn].apply(conn, args);
                    hasCalled = true;
                    break;
                } else {
                    console.log('server is not available, try next');
                }
            } catch(e) {
                console.log('try to ', fn, i);
                console.log(fn + ' error', e);
            }
            i++;
        }

        // 没有成功调用，回调出错
        if (!hasCalled) {
            callback.call(this, NO_AVAILABLE_SERVER);
        }
    }
});

// 写操作，需要同时操作所有服务器，同步数据
_.each(['set', 'replace', 'add', 'append', 'prepend', 'incr', 'decr', 'del'], function (fn) {
    HA.prototype[fn] = function (key) {
        var that = this,
            servers = this.getServers(key),
            serverCount = 0,
            args = Array.prototype.slice.call(arguments),
            callback = args[args.length - 1],
            waitAll,
            successServers = [],
            hasCalled = false;
            callTimes = 0;

        // 等待所有 MC 操作执行完回调
        waitAll = function (server, err) {
            var args = Array.prototype.slice.call(arguments);
            args.shift();
            args.push(server);

            // 记录调用次数
            callTimes++;
            if (err) {
                that.markError(server);
                // 如果有一次失败则直接回调失败结果
                callback.apply(this, args);
                hasCalled = true;
            } else {
                successServers.push(server.addr);
            }
            // 如果已经都响应了并且还没有回调过，则执行回调
            if (callTimes === serverCount && !hasCalled) {
                if (callback) {
                    callback.apply(this, args);
                }
                console.log('success set servers', successServers.join(','));
            }
        }

        // 替换回调避免多次调用回调
        args.pop();

        _.each(servers, function (server, i) {
            try {
                console.log('found set server', i, server.addr, server.status);
                if (server.status === OK) {
                    var newArgs = args.slice();
                    newArgs.push(function () {
                        var arr = Array.prototype.slice.call(arguments);
                        arr.unshift(server);
                        waitAll.apply(server.conn, arr);
                    });
                    console.log('set to server', i, server.addr);
                    server.conn[fn].apply(server.conn, newArgs);
                    serverCount++;
                }
            } catch(e) {
                console.log('try to ', fn, i);
                console.log(fn + ' error', e);
            }
        });
    }
});

module.exports = HA;