var express = require('express'),
app = express.createServer();

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

app.listen(3000);
console.log('Express server started on port %s', app.address().port);