var express = require('express'),
    cookieParser = require('cookie-parser'),
    
    session = require('./session'),

    app = express();

app.use(cookieParser());
app.use(session);

app.get('/', function (req, res) {
    var session = req.session,
        name = session.get('name'),
        welcome = 'hello stranger~';
    if (name) {
        welcome = 'hello ' + name;
    }
    res.send(welcome);
});

app.get('/:name', function (req, res) {
    var session = req.session,
        name = req.params.name;
    session.set('name', name);
    res.send('You are ' + name + ' now!');
});

app.listen(5000);