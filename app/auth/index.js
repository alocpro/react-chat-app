var _ = require('underscore'),
    async = require('async'),
    express = require('express.io'),
    cookieParser = require('cookie-parser'),
    mongoose = require('mongoose'),
    passport = require('passport'),
    passportSocketIo = require('passport.socketio'),
    BearerStrategy = require('passport-http-bearer'),
    settings = require('./../config'),
    available_providers = [
        require('./local'),
        require('./kerberos'),
        require('./ldap')
    ],
    providerSettings = {},
    NO_DELAY_AUTH_ATTEMPTS = 3,
    MAX_AUTH_DELAY_TIME = 24 * 60 * 60 * 1000,
    loginAttempts = {},
    enabledProviders = [];

function getProviders(core) {
    return settings.auth.providers.enable.map(function(key) {
        var Provider = _.find(available_providers, function (p) {
            return p.key === key;
        });

        var provider_settings = settings.auth.providers[key];

        return new Provider(provider_settings, core);
    });
}

function setup(app, session, core) {

    enabledProviders = getProviders(core);

    enabledProviders.forEach(function(provider) {
        provider.setup();
        providerSettings[provider.key] = provider.options;
    });

    passport.use(new BearerStrategy (
        function(token, done) {
            var User = mongoose.model('User');
            User.findByToken(token, function(err, user) {
                if (err) { return done(err); }
                if (!user) { return done(null, false); }
                return done(null, user);
            });
        }
    ));

    passport.serializeUser(function(user, done) {
        done(null, user._id);
    });

    passport.deserializeUser(function(id, done) {
        var User = mongoose.model('User');
        User.findOne({ _id: id }, function(err, user) {
            done(err, user);
        });
    });

    app.use(passport.initialize());
    app.use(passport.session());

    session = _.extend(session, {
        cookieParser: cookieParser,
        passport: passport
    });

    var psiAuth = passportSocketIo.authorize(session);

    app.io.use(function (socket, next) {
        var User = mongoose.model('User');
        if (socket.request._query && socket.request._query.token) {
            User.findByToken(socket.request._query.token, function(err, user) {
                if (err || !user) {
                    return next('Fail');
                }

                socket.request.user = user;
                socket.request.user.logged_in = true;
                socket.request.user.using_token = true;
                next();
            });
        } else {
            psiAuth(socket, next);
        }

    });
}

function checkIfAccountLocked(username, cb) {
    var attempt = loginAttempts[username];
    var isLocked = attempt &&
                   attempt.lockedUntil &&
                   attempt.lockedUntil > Date.now();

    cb(isLocked);
}

function wrapAuthCallback(username, cb) {
    return function(err, user, info) {
        if (!err && !user) {

            if(!loginAttempts[username]) {
                loginAttempts[username] = {
                    attempts: 0,
                    lockedUntil: null
                };
            }

            var attempt = loginAttempts[username];

            attempt.attempts++;

            if (attempt.attempts >= NO_DELAY_AUTH_ATTEMPTS) {
                var lock = Math.min(5000 * Math.pow(2,(attempt.attempts - NO_DELAY_AUTH_ATTEMPTS), MAX_AUTH_DELAY_TIME));
                attempt.lockedUntil = Date.now() + lock;
                return cb(err, user, {
                    locked: true,
                    message: 'Account is locked.'
                });
            }

            return cb(err, user, info);

        } else {

            if(loginAttempts[username]) {
                delete loginAttempts[username];
            }
            cb(err, user, info);
        }
    };
}

function authenticate(username, password, cb) {
    username = username.toLowerCase();

    checkIfAccountLocked(username, function(locked) {
        if (locked) {
            return cb(null, null, {
                locked: true,
                message: 'Account is locked.'
            });
        }

        if (settings.auth.login_throttling &&
            settings.auth.login_throttling.enable) {
            cb = wrapAuthCallback(username, cb);
        }

        var req = {
            body: {
                username: username,
                password: password
            }
        };

        var series = enabledProviders.map(function(provider) {
            return function() {
                var args = Array.prototype.slice.call(arguments);
                var callback = args.slice(args.length - 1)[0];

                if (args.length > 1 && args[0]) {
                    return callback(null, args[0]);
                }

                provider.authenticate(req, function(err, user, info) {
                    if (err) {
                        return callback(err);
                    }
                    return callback(null, user);
                });
            };
        });

        async.waterfall(series, function(err, user) {
            cb(err, user);
        });
    });
}

module.exports = {
    setup: setup,
    authenticate: authenticate,
    providers: providerSettings
};
