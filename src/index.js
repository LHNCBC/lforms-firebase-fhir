'use strict';

/**
 * The module creates an express router mounted with firebase-fhir middleware.
 *
 * The caller is expected to provide firebase admin object and backend fhir server url in the
 * options to create the router. (See README_firebasefhir.md for more details.)
 *
 */

var express = require('express');
var proxy = require('express-http-proxy');
var firebaseMW = require('./firebase-middleware');


const { URLSearchParams } = require('url');
const { URL } = require('url');
const targetServerHeader = 'x-target-fhir-endpoint';
const targetServerAuthHeader = 'x-target-fhir-server-authorization';
/**
 * Proxy response decorator, mainly used for debugging.
 *
 * @param proxyRes
 * @param proxyResData
 */
function proxyResponseDecorator(proxyRes, proxyResData) {
  return new Promise(function(resolve){
    console.log(proxyResData.toString('utf-8'));
    resolve(proxyResData);
  });
}


/**
 * Update headers before sending the request to fhir server. Mainly set
 * authorization and authentication headers and delete any unwanted headers.
 *
 * @param reqOpts - Request headers to be sent to fhir server.
 * @param srcReq - Request headers from client.
 */
function updateBackendHeaders (reqOpts, srcReq) {
  delete reqOpts.headers.authorization;
  delete srcReq.headers.authorization;
  if(srcReq.headers[targetServerAuthHeader]) {
    reqOpts.headers.authorization = srcReq.headers[targetServerAuthHeader];
  }
  delete reqOpts.headers[targetServerAuthHeader];
  delete reqOpts.headers[targetServerHeader];
}


/**
 * Create an express router and initialize it with proxy settings.
 *
 * @param options - It includes the following:
 *   firebaseAdmin: It is valid firebase-admin object to interact with firebase server.
 *     Initializing this object is specific to application domain. This library assumes
 *     that it is validated before instantiating this router.
 *   defaultFhirUrl: The url of the default target server
 *   mountPath: Where this middleware is mounted on the server
 *   proxyPath: The target path could be different than the mounted path on this server.
 *              If specified this path replaces mountPath before sending the requests to target.
 *   proxyOptions: Any proxy options to pass it to express-http-proxy.
 *
 * @returns {*}
 */
function initializeRouter(options) {

  /**
   * Parse userid, type, id etc. and store them in response.locals for later usage.
   *
   * @param req {Object} - Request object
   * @param res {Object} - Response object
   * @param next {Function} - Call to go to next middleware.
   */
  var parse = function (req, res, next) {
    res.locals.query = req.query;
    res.locals.patientId = req.query.patient;

    // Figure out fhir end point
    var url = options.defaultFhirUrl;
    var proxyPath = options.proxyPath;
    var targetServer = req.header(targetServerHeader);
    if(targetServer) {
      let tUrl = new URL(targetServer);
      url = tUrl.origin;
      proxyPath = tUrl.pathname;
    }

    res.locals.fhirEndpoint = url+proxyPath;

    next();
  };



  /**
   * Send the request to proxy server.
   * Optionally, call a proxy response interceptor, typically to update
   * firebase database with the results from fhir server.
   *
   * @param interceptResp - An optional callback to intercept the target's response data before relaying it to
   * the client. It is mainly intended to update firebase server after successful response from fhir server.
   *
   * @returns {*}
   */
  var sendToProxy = function (interceptResp) {
    var opts = Object.assign({}, options.proxyOptions);
    if(interceptResp) {
      opts.userResDecorator = interceptResp;
    }
    else {
      // Debug purpose only. Keep it for future debugging
      // opts.userResDecorator = proxyResponseDecorator;
    }

    return function (req, res, next) {
      let url = new URL(res.locals.fhirEndpoint);
      (proxy(url.origin, opts)(req, res));
    };
  };


  var router = express.Router();
// These are direct pass through to target
// Capability statement
  router.use(parse);
  router.get('/metadata', sendToProxy());

// FHIR history
  router.use('/_history', sendToProxy());
  router.get('/:_type/_history', sendToProxy());
  router.get('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})/_history', sendToProxy());

  // If firebase is used
  if(options.firebaseAdmin) {
    // The following requests are intercepted for authentication.
    var firebaseActions = firebaseMW(options.firebaseAdmin);
    router.use(firebaseActions.verifyUser);

    // 'FHIR operations'
    router.post('/([\$]):name', sendToProxy());
    router.post('/:_type/([\$]):name', sendToProxy());
    router.post('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})/([\$]):name', sendToProxy());
    router.get('/([\$]):name', sendToProxy());
    router.get('/:_type/([\$]):name', sendToProxy());
    router.get('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})/([\$]):name', sendToProxy());

    // FHIR search
    router.post('/:_type/_search', firebaseActions.search, sendToProxy());
    router.get('/:_type', firebaseActions.search, sendToProxy());
    router.get('/', firebaseActions.search, sendToProxy());

    // FHIR read
    router.get('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})', sendToProxy()); // read
    router.get('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})/_history/:vid([a-zA-Z0-9\\.\\-]{1,64})', sendToProxy()); // vread

    router.post('/', sendToProxy(firebaseActions.transactionResponse));  // Transaction

    router.post('/:_type', sendToProxy(firebaseActions.create)); // Create

    router.delete('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})', firebaseActions.checkResourceOwner, sendToProxy(firebaseActions.delete)); // Delete
    router.put('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})', firebaseActions.checkResourceOwner, sendToProxy(firebaseActions.update)); // Update
    router.patch('/:_type/:_id([a-zA-Z0-9\\.\\-]{1,64})', firebaseActions.checkResourceOwner, sendToProxy(firebaseActions.update)); // Patch
  }
  router.use(sendToProxy()); // Let FHIR handle all other requests?

  return router;
}


/**
 * Create the middleware router with given options.
 *
 * @param options - Middleware options including proxy options. See {@link initializeRouter} for details.
 * @returns {object} Returns an express middleware router initialized with this middleware routes
 */
module.exports = function (options) {

  // At minimum and defaultFhirUrl are required.
  if(!options || !options.defaultFhirUrl) {
    return null;
  }


  // Add our required options here
  var proxyOptions = {
    /**
     * This is where to map proxy path to target path
     * @param req - request object
     */
    proxyReqPathResolver: function(req) {
      var proxyPath = options.proxyPath;
      var targetServer = req.header(targetServerHeader);
      if(targetServer) {
        var url = new URL(targetServer);
        proxyPath = url.pathname;
      }
      return req.originalUrl.replace(options.mountPath, proxyPath);
    },


    /**
     * Modify anything before sending to target. We are adding a few custom
     * parameters in fhir.js. Here we are stripping them, otherwise the target might throw errors.
     * @param proxyReqOpts - Not changing any to this.
     * @param srcReq - The custom parameters are built into urls in this object.
     *   Reformat the urls removing the unwanted params.
     * @returns {*}
     */
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
      var removeList = ['thisUserOnly', 'allUsers', 'thisPatientOnly', 'allPatients'];
      updateBackendHeaders(proxyReqOpts, srcReq);
      // Remove custom url params before sending the url to FHIR server
      removeList.forEach(function(x) {
        delete srcReq.query[x];
      });
      srcReq.url = srcReq.url.replace(/\?.*$/, '');
      srcReq.originalUrl = srcReq.originalUrl.replace(/\?.*$/, '');
      var params = new URLSearchParams(srcReq.query).toString();
      if(params) {
        srcReq.url += '?' + params;
        srcReq.originalUrl += '?' + params;
      }

      return proxyReqOpts;
    }
  };

  options.proxyOptions = Object.assign(proxyOptions, options.proxyOptions);
  options.mountPath = options.mountPath || '';
  options.proxyPath = options.proxyPath || '';

  return initializeRouter(options);
};