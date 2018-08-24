/**
 * This creates a mock http server that returns the requested parameters back to client
 * to test how the http requests are made to server.
 *
 */

var nock = require('nock');

/**
 * Mock http calls to reply with requested parameters. It intends to test
 * what http values are passed to intended server (url).
 *
 *
 * @param url - The url of the backend http server to intercept the calls.
 * @returns {object} - Returns nock object. Once instantiated, it intercepts all
 *   http calls and returns response object with properties of notable http request
 *   parameters, namely http method, uri, requestBody, and nodejs request object.
 */
function fhirNock(url) {
  var ret;
  ret = nock(url).defaultReplyHeaders({
    'Content-Type': 'application/json',
    'Content-Length': function (req, res, body) {
      return body.length;
    }
  });

  var uriEx = /\/baseDstu3\/.+/;
  var stockReply = function(uri, requestBody) {
    return [200, {method: this.method, uri: uri, requestBody: requestBody, req: this.req}];
  };

  var transactionReply = function(uri, requestBody) {
    var resp = require('fs').readFileSync(__dirname+'/fixtures/transaction-response.json', {encoding: 'utf-8'});
    return [200, JSON.parse(resp)];
  };
  ret.post(/^\/baseDstu3\/?$/).reply(200, transactionReply);
  ret.get(uriEx).reply(stockReply);
  ret.post(uriEx).reply(stockReply);
  ret.delete(uriEx).reply(stockReply);
  ret.put(uriEx).reply(stockReply);
  return ret;
}


module.exports = fhirNock;
module.exports.nock = nock;
