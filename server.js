var express = require('express'),
app = express.createServer();

var sys = require("sys");
var url = require("url");
var qs = require("querystring");

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

app.listen(3000);
console.log('Express server started on port %s', app.address().port);