var MCHA = require('../mcha'),

    servers = [
                '54.169.149.253:9090',
                '54.169.149.253:9091',
                '54.169.149.253:9092'
            ],

    mcha = new MCHA(servers);


var i = 0;

setInterval(function () {
    i++;
    console.log('==' + i + '==');

    var key = 'nino',
        value = 'i am the value';
    mcha.set(key, value, 2, function (err, success, server) {
        if (err) {
            console.error('set error', err);
        } else {
            console.log('finish set', i, err, server.addr);
            mcha.get(key, function (err, data, server) {
                if (err) {
                    console.error('get error', err);
                } else {
                    console.log('finish get', i, data == value, server.addr);
                }
            });
        }
    });
}, 5000);