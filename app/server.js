//
// Letschatbro Server
//

var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var express = require('express');
var expressNamespace = require('express-namespace');
var mongoose = require('mongoose');
var mongoStore = require('connect-mongo')(express);
var swig = require('swig');
var hash = require('node_hash');
var moment = require('moment');

// App stuff
var ChatServer = require('./chat.js');

// Models
var models = require('./models/models.js');

// TODO: We should require login on all routes
var requireLogin = function(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login?next=' + req.path);
    }
};

//
// Web
//
var Server = function(config) {

    var self = this;

    self.config = config;

    // Mongo URL
    self.mongoURL = 'mongodb://'
        + self.config.db_user
        + ':' + self.config.db_password
        + '@' + self.config.db_host 
        + ':' + self.config.db_port 
        + '/' + self.config.db_name;

    // Create express app
    self.app = express();

    //
    // Configuration
    //
    self.app.configure(function() {

        // Sessions
        self.sessionStore = new mongoStore({
            url: self.mongoURL
        });
        self.app.use(express.cookieParser());
        self.app.use(express.session({
            key: 'express.sid',
            cookie: {
                httpOnly: false // We have to turn off httpOnly for websockets
            }, 
            secret: self.config.cookie_secret,
            store: self.sessionStore
        }));

        // Templates
        swig.init({
            cache: !self.config.debug,
            root: 'templates',
            allowErrors: self.config.debug // allows errors to be thrown and caught by express
        });
        self.app.set('view options', {
            layout: false // Prevents express from fucking up our extend/block tags
        });

        // Static
        self.app.use('/media', express.static('media'));
        
        // Router
        self.app.use(express.bodyParser());
        self.app.use(self.app.router);

    });

    //
    // Chat
    //
    self.app.get('/', requireLogin, function(req, res) {
        var user = req.session.user;
        var vars = {
            media_url: self.config.media_url,
            host: self.config.hostname,
            port: self.config.port,
            user_id: user._id,
            user_email: user.email,
            user_avatar: hash.md5(user.email),
            user_displayname: user.displayName,
            user_lastname: user.lastName,
            user_firstname: user.firstName
        }
        var view = swig.compileFile('chat.html').render(vars);
        res.send(view);
    });

    //
    // Login
    //
    self.app.get('/login', function(req, res) {
        var render_login_page = function(errors) {
            return swig.compileFile('login.html').render({
                'media_url': self.config.media_url,
                'next': req.param('next', ''),
                'errors': errors,
                'disableRegistration': self.config.disableRegistration
            });
        };
        res.send(render_login_page());
    });
    
    //
    // Logout
    //
    self.app.all('/logout', function(req, res) {
        req.session.destroy();
        res.redirect('/');
    });
    
    //
    // Serve Plugins
    //
    self.app.namespace('/plugins', function() {
        if (self.config.plugins) {
            _.each(self.config.plugins, function(plugin) {
                self.app.get('/' + plugin.url, function(req, res) {
                    res.json(require('../' + self.config.plugins_dir + '/' + plugin.file));
                });
            });
        }
    });

    //
    // Ajax
    //
    self.app.namespace('/ajax', function() {

        //
        // Login
        //
        self.app.post('/login', function(req, res) {
            var form = req.body;
            models.user.findOne({
                'email': form.email 
            }).exec(function(err, user) {
                if (err) {
                    res.send({
                        status: 'error',
                        message: 'Some fields did not validate',
                        errors: err
                    });
                    return;
                }
                var hashedPassword = hash.sha256(form.password, self.config.password_salt)
                if (user && hashedPassword === user.password) {
                    req.session.user = user;
                    req.session.save();
                    res.send({
                        status: 'success',
                        message: 'Logging you in...'
                    });
                } else {
                    res.send({
                        status: 'error',
                        message: 'Incorrect login credentials.'
                    });
                }
            });
        });

        //
        // Register
        //
        if (!self.config.disableRegistration) {
            self.app.post('/register', function(req, res) {
                var form = req.body;
                models.user.findOne({ 'email': form.email }).exec(function(error, user) {
                    // Check if a user with this email exists
                    if (user) {
                        res.send({
                            status: 'error',
                            message: 'That email is already in use.'
                        });
                        return;
                    }
                    // We're good, lets save!
                    var user = new models.user({
                        email: form.email,
                        password: form.password,
                        firstName: form['first-name'],
                        lastName: form['last-name'],
                        displayName: form['first-name'] + ' ' + form['last-name']
                    }).save(function(err, user) {
                        if (err) {
                            res.send({
                                status: 'error',
                                message: 'Some fields did not validate',
                                errors: err
                            });
                            return;
                        }
                        req.session.user = user;
                        req.session.save();
                        res.send({
                            status: 'success',
                            message: 'You\'ve been successfully registered.'
                        });
                    });
                });
            });
        }
        
        //
        // Edit Profile
        //
        self.app.post('/profile', requireLogin, function(req, res) {
            var form = req.body;
            var profile = models.user.findOne({
                _id: req.session.user._id
            }).exec(function(err, user) {
                if (err) {
                    // Well shit.
                    return;
                }
                _.each({
                    displayName: form['display-name'],
                    firstName: form['first-name'],
                    lastName: form['last-name']
                }, function(value,  field) {
                    if (value.length > 0) {
                        user[field] = value;
                    }
                });
                user.save(function(err) {
                    if (err) {
                        res.send({
                            status: 'error',
                            message: 'Some fields did not validate',
                            errors: err
                        });
                        return;
                    }
                    // Update session
                    req.session.user = user;
                    req.session.save();
                    res.send({
                        status: 'success',
                        message: 'Your profile has been saved.'
                    });
                });
            });
        });

        //
        // Account Settings
        //
        self.app.post('/account', requireLogin, function(req, res) {
            var form = req.body;
            var profile = models.user.findOne({
                _id: req.session.user._id
            }).exec(function(err, user) {
                if (err) {
                    // Well shit.
                    return;
                }
                // Is the password good?
                if (hash.sha256(form.password, self.config.password_salt) !== user.password) {
                    res.send({
                        status: 'error',
                        message: 'Incorrect password.'
                    });
                    return;
                }
                // Do we have a new email?
                if (form.email.length > 0) {
                    user.email = form.email;
                }
                // How about a new password?
                if (form['new-password'].length > 0) {
                    user.password = form['new-password'];
                }
                user.save(function(err) {
                    if (err) {
                        res.send({
                            status: 'error',
                            message: 'Some fields did not validate',
                            errors: err
                        });
                        return;
                    }
                    // Update session
                    req.session.user = user;
                    req.session.save();
                    res.send({
                        status: 'success',
                        message: 'Your account has been updated.'
                    });
                });
            });
        });

        //
        // File uploadin'
        // TODO: Some proper error handling
        self.app.post('/upload-file', requireLogin, function(req, res) {
            var moveUpload = function(path, newPath, callback) {
                fs.readFile(path, function(err, data) {
                    fs.writeFile(newPath, data, function(err) {
                        callback();
                    });
                });
            }
            // Loops through them files
            _.each(req.files, function(file) {
                var roomID = req.body.room;
                var file = file[0];
                var owner = req.session.user;
                var allowed_file_types = self.config.allowed_file_types;
                // Lets see if this room exists
                models.room.findOne({
                    '_id': roomID
                }).exec(function(err, room) {
                    if (err) {
                        // Danger zone!
                        res.send({
                            status: 'error',
                            message: 'Couldn\'t do the db query'
                        });
                        return;
                    }
                    // No such room?
                    if (!room) {
                        res.send({
                            status: 'error',
                            message: 'This room does not exist'
                        });
                        return;
                    }
                    // Check MIME Type
                    if (_.include(allowed_file_types, file.type)) {
                        // Save the file
                        new models.file({
                            owner: owner._id,
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            room: room._id
                        }).save(function(err, savedFile) {
                            // Let's move the upload now
                            moveUpload(file.path, self.config.uploads_dir + '/' + savedFile._id, function(err) {
                                // Let the clients know about the new file
                                var url = '/files/' + savedFile._id + '/' + encodeURIComponent(savedFile.name);
                                self.chatServer.sendFile({
                                    url: url,
                                    id: savedFile._id,
                                    name: savedFile.name,
                                    type: savedFile.type,
                                    size: Math.floor(savedFile.size / 1024),
                                    uploaded: savedFile.uploaded,
                                    owner: owner.displayName,
                                    room: room._id
                                });
                                res.send({
                                    status: 'success',
                                    message: file.name + ' has been saved!',
                                    url: url
                                });
                            });
                        });
                    } else {
                        res.send({
                            status: 'error',
                            message: 'The MIME type ' + file.type + ' is not allowed'
                        });
                    }
                });
            });
        });
    });

    //
    // View files
    //
    self.app.get('/files/:id/:name', requireLogin, function(req, res) {
        models.file.findById(req.params.id, function(err, file) {
            if (err) {
                // Error
                res.send(500, 'Something went terribly wrong');
                return;
            }
            res.contentType(file.type);
            res.sendfile(self.config.uploads_dir + '/' + file._id);
        });
    });
    
    //
    // Transcripts
    //
    self.app.get('/transcripts/:room/:date?', requireLogin, function(req, res) {  
        var uriToDate = function(uri) {
            if (uri == 'today' || !uri) {
                var date = new Date();
                date.setHours(0, 0, 0, 0);
                return date;
            }
            return !isNaN(Date.parse(uri)) ? new Date(uri) : false;
        }
        var date = uriToDate(req.params.date);
        if (date === false) {
            // Error, Invalid date
            res.send(404, 'Invalid date');
        }
        // Lookup room
        models.room.findById(req.params.room, function(err, room) {
            if (err) {
                // Error
                res.send(500, 'Something went wrong trying to lookup the room');
                return;
            }
            // Lookup messages
            // TODO: Maybe we should push message refs to room so we can use populate :|
            models.message.find({
                room: room._id
            }).select('-room -__v')
            .populate('owner')
            .where('posted').gt(date).lt(new Date(date).setDate(date.getDate() + 1))
            .exec(function(err, docs) {
                if (err) {
                    // Whoopsie
                    return;
                }
                var user = req.session.user;
                // Let's process some messages
                var messages = [];
                docs.forEach(function (message) {
                    messages.push({
                        id: message._id,
                        owner: message.owner._id,
                        avatar: hash.md5(message.owner.email),
                        name: message.owner.displayName,
                        text: message.text,
                        posted: message.posted,
                        time: moment(message.posted).format('h:mma')
                    });
                });
                var view = swig.compileFile('transcript.html').render({
                    media_url: self.config.media_url,
                    date: moment(date).format('dddd, MMM Do YYYY'),
                    room: {
                        id: room._id,
                        name: room.name,
                        description: room.description
                    },
                    messages: messages,
                    user: {
                        id: user._id,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        displayName: user.displayName,
                        avatar: hash.md5(user.email),
                        safeName: user.displayName.replace(/\W/g, '')
                    }
                });
                res.send(view);
            });
        });
    });

    //
    // Start
    //
    self.start = function() {
        // Connect to mongo and start listening
        mongoose.connect(self.mongoURL, function(err) {
            if (err) throw err;
            // Go go go!
            if (!self.config.https) {
                // Create regular HTTP server
                self.server = http.createServer(self.app)
                  .listen(self.config.port, self.config.host);
            } else {
                // Setup HTTP -> HTTP redirect server
                var redirectServer = express();
                redirectServer.get('*', function(req, res){
                    res.redirect('https://' + req.host + ':' + self.config.https.port + req.path)
                })
                http.createServer(redirectServer)
                  .listen(self.config.port, self.config.host);
                // Create HTTPS server
                self.server = https.createServer({
                    key: fs.readFileSync(self.config.https.key),
                    cert: fs.readFileSync(self.config.https.cert)
                }, self.app).listen(self.config.https.port);
            }
            self.chatServer = new ChatServer(config, self.server, self.sessionStore).start();
        });
        return this;
    };

};

module.exports = Server;