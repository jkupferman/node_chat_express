var express = require('express'),
app = express.createServer();

var sys = require("sys");
var url = require("url");
var qs = require("querystring");

// when the daemon started
var starttime = (new Date()).getTime();

app.configure(function(){
    app.use(express.logger());
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    app.set('views', __dirname + '/views');
    app.set('views');
    app.set('view engine', 'jade');
});

app.get('/', function(req, res){
    res.render('index');
});

app.get('/join', function(req, res){
    res.contentType('json');

    var nick = qs.parse(url.parse(req.url).query).nick;
    if (nick == null || nick.length == 0) {
        res.send(JSON.stringify({error: "Bad nick."}, 400));
        return;
    }
    var session = createSession(nick);
    if (session == null) {
        res.send(JSON.stringify({error: "Nick in use."}, 400));
        return;
    }

    //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

    channel.appendMessage(session.nick, "join");
    res.send(JSON.stringify({ id: session.id,
                              nick: session.nick,
                              rss: mem.rss,
                              starttime: starttime
                            },
                            200));
});

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);

var sessions = {};

function createSession (nick) {
    if (nick.length > 50) return null;
    if (/[^\w_\-^!]/.exec(nick)) return null;

    for (var i in sessions) {
        var session = sessions[i];
        if (session && session.nick === nick) return null;
    }

    var session = {
        nick: nick,
        id: Math.floor(Math.random()*99999999999).toString(),
        timestamp: new Date(),

        poke: function () {
            session.timestamp = new Date();
        },

        destroy: function () {
            channel.appendMessage(session.nick, "part");
            delete sessions[session.id];
        }
    };

    sessions[session.id] = session;
    return session;
}

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

var channel = new function () {
    var messages = [],
    callbacks = [];

    this.appendMessage = function (nick, type, text) {
        var m = { nick: nick
                  , type: type // "msg", "join", "part"
                  , text: text
                  , timestamp: (new Date()).getTime()
                };

        switch (type) {
        case "msg":
            sys.puts("<" + nick + "> " + text);
            break;
        case "join":
            sys.puts(nick + " join");
            break;
        case "part":
            sys.puts(nick + " part");
            break;
        }

        messages.push( m );

        while (callbacks.length > 0) {
            callbacks.shift().callback([m]);
        }

        while (messages.length > MESSAGE_BACKLOG)
            messages.shift();
    };

    this.query = function (since, callback) {
        var matching = [];
        for (var i = 0; i < messages.length; i++) {
            var message = messages[i];
            if (message.timestamp > since)
                matching.push(message)
        }

        if (matching.length != 0) {
            callback(matching);
        } else {
            callbacks.push({ timestamp: new Date(), callback: callback });
        }
    };

    // clear old callbacks
    // they can hang around for at most 30 seconds.
    setInterval(function () {
        var now = new Date();
        while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
            callbacks.shift().callback([]);
        }
    }, 3000);
};



app.listen(3000);
console.log('Express server started on port %s', app.address().port);