
var Telegram = function(opts) {
  if (opts.token) {
    this._token = opts.token;
  } else {
    return new Error('Telegram API-token must be specified');
  }

  var polling = {};
  if (opts.polling) {
    // print('if (opts.polling) {');
    polling.interval = opts.polling.interval || 1000;
    polling.timeout = opts.polling.timeout || 0;
    polling.limit = opts.polling.limit || 1;
    polling.retryTimeout = opts.polling.retryTimeout || 5000;
  }
  this._polling = polling;
  // print('this._polling:', this._polling);

  this._events = {};

  this._connected = false;
  this._doUpdateLoop = false;
  this._updateTimeout = undefined;

  this._lastUpdate = 0;
  this._callFunction = [];
  this._http = require('http');
};

Telegram.prototype.connect = function() {
  this._doUpdateLoop = true;
  this._update();
  this._imready();
};

Telegram.prototype.disconnect = function() {
  if (this._connected) {
    this._event('disconnect');
  }
  if (this._updateTimeout) {
    clearTimeout(this._updateTimeout);
    this._updateTimeout = undefined;
  }
  this._doUpdateLoop = false;
  this._connected = false;
  this._callFunction = [];
};

Telegram.prototype.on = function(types, callback) {
  if (typeof types == 'string') {
    types = [types];
  }
  for (var t in types) {
    if (!this._events[types[t]]) {
      this._events[types[t]] = callback;
    }
  }
};

Telegram.prototype.button = function(type, text) {
  if (type ==='contact') {
    return {'text': text, 'request_contact': true};
  } else {
    return {'text': text, 'request_location': true};
  }
};

Telegram.prototype.keyboard = function(arrayOfButtons, opts) {
  opts = opts || {};
  var keyboard = {
    'keyboard': arrayOfButtons,
    'one_time_keyboard': !!opts.once,
    'resize_keyboard': !!opts.resize,
    'selective': !!opts.selective
  };
  return JSON.stringify(keyboard);
};

Telegram.prototype.inlineButton = function(text, opt) {
  opt = opt || {};
  var markup = {'text': text};
  if (opt.url) {
    markup.url = opt.url;
  }
  if (opt.inline || opt.inline === '') {
    markup.switch_inline_query = opt.inline; // eslint-disable-line camelcase
  }
  if (opt.callback) {
    markup.callback_data = String(opt.callback); // eslint-disable-line camelcase
  }
  return markup;
};

Telegram.prototype.inlineKeyboard = function(arrayOfButtons) {
  return JSON.stringify({'inline_keyboard': arrayOfButtons});
};

Telegram.prototype.sendLocation = function(chatId, coordinates, payload) {
  // chat_id, [latitude, longitude], {reply, markup, notify}
  var params = {
    'chat_id': chatId,
    'latitude': coordinates[0] || 0,
    'longitude': coordinates[1] || 0
  };
  params = this._addPreparedPayload(payload, params);
  // print('do "send location"');
  this._callFunction.push({
    method: 'sendLocation',
    query: params
  });
};

Telegram.prototype._event = function(eventName, params, eventType) {
  // print('EVENT ', eventName);
  if (this._events[eventName]) {
    this._events[eventName](params, {type: eventType || eventName});
  }
};

Telegram.prototype._addPreparedPayload = function(payload, dest) {
  // payload === {reply, markup, notify}
  if (payload) {
    if (payload.reply) {
      dest.reply_to_message_id = payload.reply; // eslint-disable-line camelcase
    }
    if (payload.markup) {
      if (payload.markup === 'hide' || payload.markup === false) {
        // Hide keyboard
        dest.reply_markup = JSON.stringify({hide_keyboard: true}); // eslint-disable-line camelcase
      } else if (payload.markup === 'reply') {
        // Fore reply
        dest.reply_markup = JSON.stringify({force_reply: true}); // eslint-disable-line camelcase
      } else {
        // JSON keyboard
        dest.reply_markup = payload.markup; // eslint-disable-line camelcase
      }
    }
    if (payload.notify) {
      dest.disable_notification = !!(payload.notify); // eslint-disable-line camelcase
    }
  }
  return dest;
};

Telegram.prototype.sendMessage = function(chatId, text, payload) {
  var params = {
    'chat_id': chatId,
    'text': text || ''
  };
  params = this._addPreparedPayload(payload, params);
  // print('do "send message"');
  this._callFunction.push({
    method: 'sendMessage',
    query: params
  });
};

Telegram.prototype.answerCallback = function(callbackQueryId, text, showAlert) {
  // print('do "answerCallback"');
  this._callFunction.push({
    method: 'answerCallbackQuery',
    query: {
      callback_query_id: callbackQueryId, // eslint-disable-line camelcase
      show_alert: !!showAlert, // eslint-disable-line camelcase
      text: text
    }
  });
};

Telegram.prototype._messageEvent = function(params) {
  if (params.entities) {
    if (params.entities[0].type === 'bot_command') {
      var indexA = params.entities[0].offset;
      var indexB = indexA + params.entities[0].length;
      var cmd = params.text.substring(indexA, indexB);
      // print('it is a bot command: ', cmd);
      this._event(cmd, params, 'command');
      this._event('/*', params, 'command');
    }
    // entities: [ { type: 'bot_command', offset: 0, length: 15 } ] }
  }
  if (params.contact) {
    this._event('contact', params);
  }
  if (params.location) {
    this._event('location', params);
  }
  this._event('text', params);
  this._event('*', params, 'text');
};

Telegram.prototype._parseUpdate = function(response) {
  // print('Telegram.prototype._parseUpdate');
  if (response && response.result) {
    if (this._connected === false) {
      this._connected = true;
      this._event('connect');
    }
    this._event('update', response.result, 'callbackQuery');
    if (response.result.length > 0) {
      this._lastUpdate = response.result[0].update_id + 1;
      var data;
      if (response.result[0].callback_query) {
        data = response.result[0].callback_query;
        response = null;
        process.memory();
        this._event('callbackQuery', data);
      } else if (response.result[0].message) {
        data = response.result[0].message;
        response = null;
        process.memory();
        this._messageEvent(data);
      }
    }
  }
  response = null;
  process.memory();
  // print('End of UPDATE');
  this._update();
};

Telegram.prototype._update = function() {
  // print('getting updates');
  // this._get('getUpdates', params, this._parseUpdate);
  this._callFunction.push({
    method: 'getUpdates',
    query: {
      offset: this._lastUpdate,
      limit: this._polling.limit,
      timeout: this._polling.timeout
    },
    callback: this._parseUpdate.bind(this)
  });

  // print(this._callFunction);
};

Telegram.prototype._imready = function() {
  if (this._callFunction.length > 0) {
    var task = this._callFunction[0];
    // print('add func:', task.method);
    this._callFunction.splice(0, 1);
    var self = this;
    if (task.method === 'getUpdates') {
      // var self = this;
      this._updateTimeout = setTimeout(function() {
        this._updateTimeout = undefined;
        self._request(task.method, task.query, task.callback);
      }, this._polling.interval);
    } else {
      // var self = this;
      setTimeout(function() {
        self._request(task.method, task.query, task.callback);
      }, 100);
    }
  } else {
    // print('this._callFunction.length === 0');
    this._update();
    this._imready();
  }
};

Telegram.prototype._request = function(method, query, callback) {
  var content = JSON.stringify(query);
  // print('I MAKE REQUEST!');
  var url = {
    host: 'api.telegram.org',
    port: 443,
    path: '/bot'+this._token+'/'+method,
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': content.length
    }
  };
  var self = this;
  this._http.request(url, function(res) {
    var response = '';
    res.on('data', function(d) {
      response += d;
    });
    res.on('close', function() {
      // print(response);
      var json = JSON.parse(response);
      response = '';
      if (callback) {
        if (self._doUpdateLoop) {
          callback(json);
        }
      }
      self._imready();
    });
  }).end(content);
};

exports.create = function(opts) {
  var params = {};
  if (typeof opts == 'string') {
    params.token = opts;
  } else {
    params = opts;
  }
  return new Telegram(params);
};
