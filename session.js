var MCHA = require('./mcha'),
    uuid = require('./uuid'),

    servers = [
                '54.169.149.253:9090',
                '54.169.149.253:9091',
                '54.169.149.253:9092'
            ],

    sidKey = '_session_id',

    saveDelay = 60,
    sessionExpire = 1800,

    mcha = new MCHA(servers);

function session(req, res, next) {
    var cookies = req.cookies,
        sid;

    // 存在 cookie 的情况下，从 cookie 中取出 sid
    if (cookies) {
        sid = cookies[sidKey];
    }
    
    // 对 sid 进行校验，防止被乱搞
    if (typeof sid !== 'string' || sid.length !== 16) {
        console.warn('error req cookie sid', sid);
        sid = null;
    }

    // 创建指定 id 对应的 session 对象
    session = new Session(sid);
    // 从 MC 中获取指定 sessionId 的 session
    session.fetch(function (err, data) {
        if (!err) {
            // 将 session 放入 req 中供使用
            req.session = session;
            // 将 sid 写回 cookie 中
            res.cookie(sidKey, data.sid, {expires: new Date(Date.now() + 1800000), httpOnly: true, path: '/'});
        } else {
            console.log('session fetch error', err);
        }
        // 继续原有流程
        next();
    });
}

// 创建 session 对象
// 可以传入已有 sid，如果没有则自动生成一个
var Session = function (sid) {
    if (!sid) {
        sid = uuid();
    }

    this.data = {
            sid: sid
        };

    return this;
};

// 获取 session 的值，支持同步和异步返回
Session.prototype.get = function(key, callback) {
    if (callback) {
        callback(null, this.data[key]);
    }
    return this.data[key];
};

// 设置 session 值，只能异步回调
Session.prototype.set = function(key, value, callback) {
    if (!key || !value) {
        if (callback) {
            callback('empty_args');
        } else {
            return;
        }
    }

    // 设置值
    this.data[key] = value;
    // 调用保存方法
    this.save(callback);
};

// 销毁 session 对象
Session.prototype.destroy = function (sid, callback) {
    if (!sid) {
        if (callback) {
            callback('empty_args');
        } else {
            return;
        }
    }

    // 删除对象
    mcha.del(sid, callback);
};

// 从 MC 中拉取数据
Session.prototype.fetch = function (callback) {
    var that = this,
        sid = this.data.sid;
    console.log('fetching sid', sid);
    mcha.get(sid, function (err, data) {
        if (err) {
            console.log('fetching sid', sid, 'error', err);
            if (callback) {
                callback.call(that, err);
            }
            return;
        }
        console.log('fetching sid', sid, 'data', data);
        if (data) {
            try {
                that.data = JSON.parse(data);
            } catch(e) {
                console.error('error parse session data', data, e);
            }
        }
        if (callback) {
            callback.call(that, null, that.data);
        }
    });
};

// 更新数据到 MC 中
Session.prototype.save = function (callback) {
    if (this.delayTimer) {
        clearTimeout(this.delayTimer);
    }

    var data = this.data,
        sid = data.sid;
    this.delayTimer = setTimeout(function () {
        mcha.set(sid, JSON.stringify(data), sessionExpire, callback);
    }, saveDelay);
}

module.exports = session;