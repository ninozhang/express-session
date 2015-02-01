var md5 = require('../md5'),

    assert = require('assert');

var data = [],
    dataCount = 100;

function gen() {
    var a = ((Math.random() * 1234) * (Math.random() * 4567) * (Math.random() * 7890)).toString(16).replace('.', ''),
        b = ((Math.random() * 7890) * (Math.random() * 5678) * (Math.random() * 1234)).toString(16).replace('.', ''),
        s = a + b,
        c = s.length,
        m = c > 2 ? 2 : c,
        i0 = Math.floor(Math.random() * m),
        i1 = Math.floor(Math.random() * (c - i0)) + i0 - 1;
    return md5(s.substring(i0, i1));
}

function genData() {
    for (var i = 0; i < dataCount; i++) {
        data.push(gen());
    }
}

describe('md5', function () {
    describe('check result', function () {
        it('should return correct result', function () {
            var key = 'nino';
            assert.equal(md5(key), '45ff0fa8ba18b7a076efa812989dd948');
        });
    });

    describe('check performance', function () {
        it('should performance well', function () {
            var t1 = Date.now();
            genData();
            var t2 = Date.now();
            var cost = ((t2 - t1) / dataCount);
            console.log('cost ' + cost + ' ms per md5.');
            assert.ok(cost * 10 < 1);
        });
    });

    describe('check uniformity', function () {
        it('should spread', function () {
            var indexes = {};
            for (var i = data.length - 1; i >=0 ; i--) {
                var s = data[i].substring(0, 2);
                if (!indexes[s]) {
                    indexes[s] = 0;
                }
                indexes[s] += 1;
            }

            '0123456789abcdef'.split('').forEach(function (s1) {
                '0123456789abcdef'.split('').forEach(function (s2) {
                    var s = s1 + s2;
                    // console.log(s + ': ' + indexes[s] + ' ' + (indexes[s]/data.length*100).toFixed(2) + '%');
                });
            });
        });
    });

});