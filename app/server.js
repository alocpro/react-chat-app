//
// Letschatbro Server
//

var _ = require('underscore');

var fs = require('fs');
var express = require('express');
var expressNamespace = require('express-namespace');
var mongoose = require('mongoose');
var mongoStore = require('connect-mongo')(express);
var swig = require('swig');
var hash = require('node_hash');

// App stuff
var ChatServer = require('./chat.js');

// Models
var models = require('./models/models.js');

// TODO: We should require login on all routes
var requireLogin = function (req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login?next=' + req.path);
    }
};

var Server = function (config) {

    var self = this;

    self.config = config;

	// Mongo URL
	self.mongoURL = 'mongodb://'
		+ self.config.db_user
		+ ':' + self.config.db_password
		+ '@' + self.config.db_host 
		+ ':' + self.config.db_port 
		+ '/' + self.config.db_name;

	// Create server
	self.app = express.createServer();

	// Setup session store
	self.sessionStore = new mongoStore({
		url: self.mongoURL
	});

	// Configuration
	self.app.configure(function () {

		// Setup template stuffs
		self.app.register('.html', swig);
		swig.init({
			cache: !self.config.debug,
			root: 'templates',
			allowErrors: self.config.debug // allows errors to be thrown and caught by express
		});
		self.app.set('view options', {
			layout: false // Prevents express from fucking up our extend/block tags
		});

		self.app.use(express.bodyParser());
		self.app.use(express.cookieParser());
		self.app.use(express.session({
			key: 'express.sid',
			cookie: {
				httpOnly: false // We have to turn off httpOnly for websockets
			}, 
			secret: self.config.cookie_secret,
			store: self.sessionStore
		}));

		// Static directory
		self.app.use('/media', express.static('media'));

		self.app.use(self.app.router);

	});

	// Rooms
    self.app.get('/rooms/?', requireLogin, function (req, res) {
        models.room.find().exec(function(err, rooms) {
            var view = swig.compileFile('rooms.html').render({
                media_url: self.config.media_url,
                rooms: rooms
            });
            res.send(view);
        });
    });

	self.app.get('/rooms/:slug', requireLogin, function (req, res) {
        var slug = req.params.slug;
		var user = req.session.user;
        var room;
        models.room.findOne({
            slug: slug
        }).exec(function (err, doc) {
            if (!doc) {
                room = new models.room({
                    slug: slug,
                    name: slug,
                    owner: user._id
                }).save();
                return;
            }
            room = doc;
            var view = swig.compileFile('chat.html').render({
                media_url: self.config.media_url,
                room: {
                    id: room._id,
                    slug: room.slug,
                    name: room.name,
                    description: room.description
                },
                host: self.config.hostname,
                port: self.config.port,
                user_id: user._id,
                user_email: user.email,
                user_avatar: hash.md5(user.email),
                user_displayname: user.displayName,
                user_lastname: user.lastName,
                user_firstname: user.firstName
            });
            res.send(view);
        });

	});

	// Login
	self.app.get('/login', function (req, res) {
		var render_login_page = function (errors) {
			return swig.compileFile('login.html').render({
				'media_url': self.config.media_url,
				'next': req.param('next', ''),
				'errors': errors
			});
		};
		res.send(render_login_page());
	});

	// Logout
	self.app.all('/logout', function (req, res) {
		req.session.destroy();
		res.redirect('/');
	});

	// Ajax
	self.app.namespace('/ajax', function () {
		// Login
		self.app.post('/login', function (req, res) {
			var form = req.body;
            models.user.findOne({
                'email': form.email 
            }).exec(function (err, user) {
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

		// Register
		self.app.post('/register', function (req, res) {

            var form = req.body;
            models.user.findOne({ 'email': form.email }).exec(function (error, user) {
                // Check if a user with this email exists
                if (user) {
                    res.send({
                        status: 'error',
                        message: 'That email is already in use.'
                    });
                    return;
                }
                // We're good, lets save!
                var hashedPassword = hash.sha256(form.password, self.config.password_salt)
                var user = new models.user({
                    email: form.email,
                    password: hashedPassword,
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

		// Add Room
		self.app.post('/add-room', requireLogin, function (req, res) {
            var form = req.body;
            models.room.findOne({
                'name': form.name
            }).exec(function (error, room) {
                // Check if the same room name exists
                if (room) {
                    res.send({
                        status: 'error',
                        message: 'That room name is already in use.'
                    });
                    return;
                }
                // Save time
                var room = new models.room({
                    slug: form.name,
                    name: form.name,
                    description: form.description,
                    owner: req.session.user._id
                }).save(function(err, room) {
                    if (err) {
                        res.send({
                            status: 'error',
                            message: 'Some fields did not validate',
                            errors: err
                        });
                        return;
                    }
                    res.send({
                        room: room,
                        status: 'success',
                        message: 'The room has been created'
                    });
                });
            });
		});

		// File uploadin'
        // TODO: Some proper error handling
		self.app.post('/upload-file', function (req, res) {
			var moveUpload = function (path, newPath, callback) {
				fs.readFile(path, function (err, data) {
					fs.writeFile(newPath, data, function (err) {
						callback();
					});
				});
			}
			_.each(req.files, function (file) {
				var owner = req.session.user;
				var allowed_file_types = self.config.allowed_file_types;
				// Check MIME Type
				if (_.include(allowed_file_types, file.type)) {
					// Save the file
					new models.file({
						owner: owner._id,
						name: file.name,
						type: file.type,
						size: file.size
					}).save(function(err, savedFile) {
						// Let's move the upload now
						moveUpload(file.path, self.config.uploads_dir + '/' + savedFile._id, function (err) {
							// Let the clients know about the new file
							self.chatServer.sendFile({
								url: '/files/' + savedFile._id + '/' + encodeURIComponent(savedFile.name),
								id: savedFile._id,
								name: savedFile.name,
								type: savedFile.type,
								size: savedFile.size,
								uploaded: savedFile.uploaded,
								owner: owner.displayName
							});
							res.send({
								status: 'success',
								message: 'File has been saved!'
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

	// View files
	self.app.get('/files/:id/:name', function (req, res) {
		models.file.findById(req.params.id, function (err, file) {
			res.contentType(file.type);
			res.sendfile(self.config.uploads_dir + '/' + file._id);
		});
	});

    self.start = function () {

		// Connect to mongo and start listening
		mongoose.connect(self.mongoURL, function(err) {
			if (err) throw err;
			// Go go go!
			self.app.listen(config.port, config.host);
			self.chatServer = new ChatServer(self.app, self.sessionStore).start();
		});

		return this;

    };

};

module.exports = Server;