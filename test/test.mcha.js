var MCHA = require('../mcha'),

    assert = require('assert'),

    mcha;

describe('mcha', function () {

    describe('create', function () {
        it('should add servers correctly', function () {
            var servers = [
                    '10.1.2.15:11211',
                    'nino',
                    'nino.com:11',
                    'nino.com',
                    '10.0.2.15:11212',
                    '101.1.2.15:11213',
                    '10.0.2.15:11214'
                ],
                prev;

            mcha = new MCHA(servers);
            mcha.servers.forEach(function (server) {
                if (!prev) {
                    prev = server;
                } else {
                    assert.ok(prev.addr < server.addr);
                }
            });

            servers = [
                '54.169.149.253:9090',
                '54.169.149.253:9091',
                '54.169.149.253:9092'
            ];
            mcha = new MCHA(servers);
        });
    });

    describe('action', function () {
        var key = 'name',
            value = 'nino';
        it('should set value correctly', function (done) {
            mcha.set(key, value, 2, function (err) {
                console.log(err);
                assert.ok(!err);
                done();
            });
        });
        it('should get value correctly', function (done) {
            mcha.get(key, function (err, v) {
                console.log(err, v);
                assert.equal(v, value);
                done();
            });
        });
    });
    
});