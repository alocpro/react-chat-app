'use strict';

var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    uuid = require('node-uuid');


function Connection(type, userId, screenName) {
    EventEmitter.call(this);
    this.type = type;
    this.id = uuid.v4();
    this.userId = userId.toString();
    this.screenName = screenName.toString();
}

util.inherits(Connection, EventEmitter);

module.exports = Connection;
