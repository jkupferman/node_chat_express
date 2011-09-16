var fs = require('fs');
var express = require('express'),
		app = express.createServer();

var sys = require("sys");
var url = require("url");
var qs = require("querystring");

var winston = require('winston');
var logger = new (winston.Logger)({
	transports: [
		new (winston.transports.Console)(),
		new (winston.transports.File)({ filename: 'nodechat.log' })
	],
	exceptionHandlers: [
		new (winston.transports.File)({ filename: 'exceptions.log'})
	]
});

var config = require('./conf/conf.js');

if ( config.options.secure === true ) {
	logger.info('Running as secure server');
	var RedisStore = require('connect-redis')(express); 
	var crypto = require('crypto');

	var Client = require('mysql').Client;
	var client = new Client();
	//mySQL user and server info
	client.user = config.db.user;
	client.password = config.db.password;
	client.host = config.db.host;
	client.port = config.db.port;

	app = require('express').createServer({ 
		key: fs.readFileSync('conf/cert/nodechat.key'),
		cert: fs.readFileSync('conf/cert/nodechat.crt')
	});
	app.use(express.cookieParser());
	app.use(express.session({ key: 'nodechat.sid', secret: config.sess.secret, store: new RedisStore }));
};

if ( config.loggly.use === true ) {
	logger.add(winston.transports.Loggly, {
		subdomain: config.loggly.subdomain,
		inputToken: config.loggly.inputToken,
		handleExceptions: true
	});

	logger.handleExceptions();
};

// when the daemon started
var starttime = (new Date()).getTime();

//Load configuration settings from external file.

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

app.get('/', requiresLogin, function(req, res){
    res.render('index', {
			secure: config.options.secure
		});
});

if ( config.options.secure === true ) {
	app.post('/login', function(req, res) {
		authenticate(req.body.login, req.body.password, function(user) {
			if (user) {
				req.session.user = user.login;
				req.session.community = user.comm;
				req.session.level = user.level;
				res.redirect('/');
			} else {
				res.send(403);
			}
		})
	});

	app.post('/newuser', requiresLogin, function(req, res) {
		var cipher = crypto.createCipher('blowfish', req.body.password);
		var pass = cipher.final('base64');
		var values = [req.body.login, pass];
		client.query("INSERT INTO login SET login = ?, password = ?", values,
		function(error, results) {
			if(error) {
				logger.error(error);
				logger.error(req.session);
				res.send('Fail! Error was: ' + error.message);
			} else {
				logger.info('New user added by ' + req.session.user);
				res.send('User created successfully.');
			}
		});
	});

	app.get('/newuser', requiresLogin, function(req, res) {
		res.render('newuser');
	});
};

app.get('/join', requiresLogin, function(req, res){
    res.contentType('json');

		if ( config.options.secure === true ) {
			var nick = req.session.user
		} else {
			var nick = qs.parse(url.parse(req.url).query).nick;
			if (nick == null || nick.length == 0) {
					res.send(JSON.stringify({error: "Bad nick."}, 400));
					return;
			}
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

app.get("/part", requiresLogin, function (req, res) {
    var id = qs.parse(url.parse(req.url).query).id;
    var session;
    if (id && sessions[id]) {
        session = sessions[id];
        session.destroy();
    }
    res.send(JSON.stringify({ rss: mem.rss }), 200);
});

app.get("/recv", requiresLogin, function (req, res) {
    if (!qs.parse(url.parse(req.url).query).since) {
        res.send(JSON.stringify({error: "Must supply since parameter"}, 400));
        return;
    }
    var id = qs.parse(url.parse(req.url).query).id;
    var session;
    if (id && sessions[id]) {
        session = sessions[id];
        session.poke();
    }

    var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

    channel.query(since, function (messages) {
        if (session) session.poke();
        res.send(JSON.stringify({ messages: messages, rss: mem.rss }, 200));
    });
});

app.get("/send", requiresLogin, function (req, res) {
    var id = qs.parse(url.parse(req.url).query).id;
    var text = qs.parse(url.parse(req.url).query).text;

    var session = sessions[id];
    if (!session || !text) {
        res.send(JSON.stringify({ error: "No such session id" }, 400));
        return;
    }

    session.poke();

    channel.appendMessage(session.nick, "msg", text);
		logger.info("User: " + session.nick + " said: " + text);
    res.send(JSON.stringify({ rss: mem.rss }, 200));
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

setInterval( function() {
	var date = new Date();
	var cutoff = date.getTime() - SESSION_TIMEOUT;
	for ( var i in sessions ) {
		if ( sessions[i].timestamp.getTime() < cutoff ) {
			sessions[i].destroy();
		}
	}
}, 10 * 1000 );

function requiresLogin(req, res, next) {
	if ( config.options.secure === true ) {
		if (req.session.user) {
			next();
		} else {
			//res.redirect('/login');
			res.render('login');
		}
	} else {
		next();
	}
};

function authenticate(login, password, callback) {
	var cipher = crypto.createCipher('blowfish', password);
	var pass = cipher.final('base64');
	var values = [login, pass];
	client.query("SELECT * FROM login WHERE login = ? AND password = ?", values,
							 function(error, results) {
								 if(error) {
									 logger.error(error)
									 logger.error(req.session);
								 } else {
									 var user = results[0];
									 if (!user) {
										 callback(null);
										 return;
									 } else {
										 callback(user);
										 return;
									 }
								 }
							 });
};

if ( config.options.secure === true ) {
	client.connect(function(error, results) {
		if(error) {
			logger.error('MySQL Connection Error: ' + error.message);
			return;
		}
		logger.info('Connected to MySQL');
		//Select the DB
		ClientConnectionReady(client);
	});

	// Selects the database
	ClientConnectionReady = function(client)
	{
			client.query('USE ' + config.db.dbname, function(error, results) {
					if(error) {
							logger.error('ClientConnectionReady Error: ' + error.message);
							client.end();
							return;
					} else {
							logger.info('Database Selected');
							app.listen(3000);
							console.log('Express server started on port %s', app.address().port);
				pingDB();
					}
			});
	};
} else {
	app.listen(3000);
	console.log('Express server started on port %s', app.address().port);
};
function pingDB() {
    setInterval( function() {
			client.query('USE ' + config.db.dbname, function(error, results) {
	   if(error) {
	       logger.error('Database Selection Error: ' + error.message);
	       client.end();
	       return;
	   } else {
	       logger.info('Database Re-Selected');            
	   }
       });
    }, 60 * 1000 )
};

