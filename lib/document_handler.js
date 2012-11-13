var winston = require('winston');
var mmm = require('mmmagic');
var Magic = mmm.Magic;
var magic = new Magic(mmm.MAGIC_MIME_TYPE);
var fs = require('fs');

// For handling serving stored documents

var DocumentHandler = function(options) {
  if (!options) {
    options = {};
  }
  this.keyLength = options.keyLength || DocumentHandler.defaultKeyLength;
  this.maxLength = options.maxLength; // none by default
  this.store = options.store;
  this.keyGenerator = options.keyGenerator;
};

DocumentHandler.defaultKeyLength = 10;

// Handle retrieving a document
DocumentHandler.prototype.handleGet = function(key, response, skipExpire) {
  this.store.get(key, function(ret) {
    if (ret) {
      winston.verbose('retrieved document', { key: key });
//      response.writeHead(200, { 'Content-Type': 'application/json' });
//      response.end(JSON.stringify({ data: ret, key: key }));
      buf = new Buffer(ret, 'binary');
      magic.detect(buf, function(err, result) {
        if (err) {
          winston.verbose('odd mimetype - redirecting to raw');
          response.writeHead(302, { 'Location': '/raw/' + key });
          response.end();
        } else {
          if ( result.indexOf('image') > -1 || result.indexOf('application/x-bittorent') > -1 ) {
            winston.verbose('image or torrent - redirecting to raw');
            response.writeHead(302, { 'Location': '/raw/' + key });
            response.end();
          } else {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ data: ret, key: key }));
          }
        }
      });
    }
    else {
      winston.warn('document not found', { key: key });
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Document not found.' }));
    }
  }, skipExpire);
};

// Handle retrieving the raw version of a document
DocumentHandler.prototype.handleRawGet = function(key, response, skipExpire) {
  this.store.get(key, function(ret) {
    if (ret) {
      winston.verbose('retrieved raw document', { key: key });
      buf = new Buffer(ret, 'binary');
      magic.detect(buf, function(err, result) {
        if (err) {
          winston.verbose('unable to detect mimetype');
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end(ret, 'binary');
        } else {
          response.writeHead(200, { 'Content-Type': result });
          response.end(ret, 'binary');
          winston.verbose('detected mimetype:', {mimetype: result});
        }
      });
    }
    else {
      winston.warn('raw document not found', { key: key });
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Document not found.' }));
    }
  }, skipExpire);
};

// Handle adding a new Document
DocumentHandler.prototype.handlePost = function(request, response) {
  var _this = this;
  var buffer = '';
  var cancelled = false;
  var tmpfile = '/tmp/node_temp';
  var stream = fs.createWriteStream(tmpfile);
//  request.setEncoding('base64');
  request.on('data', function(data) {
    if (!buffer) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
    }
    buffer += data.toString('binary');
    stream.write(data);
    magic.detect(data, function(err, result) {
      if (err) throw err;
      winston.debug('received mime type: ', {mimetype: result});
    });

    buffer += data;
    if (_this.maxLength && buffer.length > _this.maxLength) {
      cancelled = true;
      winston.warn('document >maxLength', { maxLength: _this.maxLength });
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ message: 'Document exceeds maximum length.' })
      );
    }
  });
  request.on('end', function(end) {
    if (cancelled) return;
    _this.chooseKey(function(key) {
      _this.store.set(key, buffer, function(res) {
        if (res) {
          winston.verbose('added document', { key: key });
          response.end(JSON.stringify({ key: key }));
        }
        else {
          winston.verbose('error adding document');
          response.writeHead(500, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ message: 'Error adding document.' }));
        }
      });
    });
  });
  request.on('error', function(error) {
    winston.error('connection error: ' + error.message);
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Connection error.' }));
  });
};

// Keep choosing keys until one isn't taken
DocumentHandler.prototype.chooseKey = function(callback) {
  var key = this.acceptableKey();
  var _this = this;
  this.store.get(key, function(ret) {
    if (ret) {
      _this.chooseKey(callback);
    } else {
      callback(key);
    }
  });
};

DocumentHandler.prototype.acceptableKey = function() {
  return this.keyGenerator.createKey(this.keyLength);
};

module.exports = DocumentHandler;
