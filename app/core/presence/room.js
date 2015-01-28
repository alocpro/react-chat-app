'use strict';

var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    _ = require('underscore'),
    ConnectionCollection = require('./connection-collection');

function Room(roomId, roomSlug) {
    EventEmitter.call(this);
    this.roomId = roomId;
    this.roomSlug = roomSlug;
    this.connections = new ConnectionCollection();
    this.users = {};

    this.getUserIds = this.getUserIds.bind(this);
    this.getUsernames = this.getUsernames.bind(this);
    this.containsUser = this.containsUser.bind(this);
    this.getUserCount = this.getUserCount.bind(this);

    this.emitUserJoin = this.emitUserJoin.bind(this);
    this.emitUserLeave = this.emitUserLeave.bind(this);
    this.addConnection = this.addConnection.bind(this);
    this.removeConnection = this.removeConnection.bind(this);
}

util.inherits(Room, EventEmitter);

Room.prototype.getUserIds = function() {
    return this.connections.getUserIds();
};

Room.prototype.getUsernames = function() {
    return this.connections.getUsernames();
};

Room.prototype.containsUser = function(userId) {
    return this.getUserIds().indexOf(userId) !== -1;
};

Room.prototype.getUserCount = function() {
    return Object.keys(this.users).length;
};

Room.prototype.emitUserJoin = function(data) {
    this.users[data.userId] = true;
    this.emit('user_join', {
        roomId: this.roomId,
        roomSlug: this.roomSlug,
        userId: data.userId,
        username: data.username
    });
};

Room.prototype.emitUserLeave = function(data) {
    delete this.users[data.userId];
    this.emit('user_leave', {
        roomId: this.roomId,
        roomSlug: this.roomSlug,
        userId: data.userId,
        username: data.username
    });
};

Room.prototype.usernameChanged = function(data) {
    if (this.containsUser(data.userId)) {
        // User leaving room
        this.emitUserLeave({
            userId: data.userId,
            username: data.oldUsername
        });
        // User rejoining room with new username
        this.emitUserJoin({
            userId: data.userId,
            username: data.username
        });
    }
};

Room.prototype.addConnection = function(connection) {
    if (!connection) {
        console.error('Attempt to add an invalid connection was detected');
        return;
    }

    if (!this.containsUser(connection.userId)) {
        // User joining room
        this.emitUserJoin({
            userId: connection.userId,
            username: connection.username
        });
    }
    this.connections.add(connection);
};

Room.prototype.removeConnection = function(connection) {
    if (!connection) {
        console.error('Attempt to remove an invalid connection was detected');
        return;
    }

    if (this.connections.remove(connection)) {
        if (!this.containsUser(connection.userId)) {
            // Leaving room altogether
            this.emitUserLeave({
                userId: connection.userId,
                username: connection.username
            });
        }
    }
};

module.exports = Room;
