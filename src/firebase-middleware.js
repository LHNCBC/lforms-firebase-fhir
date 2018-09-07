/**
 * The module returns an object consisting of APIs to interact with
 * a supported backend fhir server and a firebase application. The firebase application
 * is used for user authentication and storing their fhir resource IDs
 * in firebase database.
 *
 * The APIs are express style middleware functions and proxy response decorators.
 * See express npm module for details on how to use middleware functions.
 * See express-http-proxy npm module for details on how to use the response decorators.
 *
 */

module.exports = function(firebaseAdmin) {
  if(!firebaseAdmin) {
    return null;
  }

  var fireAdmin = firebaseAdmin;


  /**
   * Get firebase database reference
   *
   * @param path - firebase schema path
   * @returns {*} - firebase ref object.
   */
  function getFirebaseReference (path) {
    var ref = null;
    if(path && path.length > 0) {
      ref = fireAdmin.database().ref(path.join('/'));
    }
    return ref;
  }


  /**
   * Construct path array upto resource id.
   *
   * @param resourceType - Resource type
   * @param userRes - Response object of this server.
   * @param resourceId - fhir resource id
   * @returns {*}
   */
  function getFirebaseResourceIdPath (resourceType, userRes, resourceId) {
    var path = getFirebaseResourcePath(resourceType, userRes);
    path.push(resourceId);
    return path;
  }


  /**
   * Construct path array up to Resource type
   *
   * @param resourceType - Resource type
   * @param userRes - Response object of this server.
   * @returns {*}
   */
  function getFirebaseResourcePath (resourceType, userRes) {
    var path = getFirebaseFhirEndpointPath(userRes);
    path.push(resourceType);
    return path;
  }


  /**
   * Construct path array upto fhir url
   *
   * @param userRes - Response object of this server.
   * @returns {*}
   */
  function getFirebaseFhirEndpointPath (userRes) {

    var path = ['user-resources'];
    path.push(userRes.locals.userId);
    path.push(Buffer.from(userRes.locals.fhirEndpoint).toString('base64'));
    return path;
  }


  /**
   * Parse user token from the authorization header
   *
   * @param req {Object} - Request object
   * @returns {String} - User id
   */
  function parseUserToken (req) {
    var ret = null;
    var bearerToken = req.get('authorization');
    if (bearerToken) {
      var ret = bearerToken.replace(/^\s*bearer\s*/i, '');
    }
    return ret;
  }


  /**
   * Handle void type promises from firebase. Typically used in proxy response decorators
   * to update the firebase.
   *
   * @param method - Represents firebase operation
   * @param proxyRes - Represents response from target server
   * @param proxyResData - Represents response data from target server
   * @param userReq - Represents user request to this server
   * @param userRes - Represents response object of this server.
   * @returns {Promise<any>} Return promise
   */
  function handleFirebaseVoid(method, proxyRes, proxyResData, userReq, userRes) {
    var resId = null;
    var resource = null;
    var fbPath = null;

    if(method === 'remove') {
      // For remove, use resource reference.
      // For update/set use parent reference
      resId = userReq.params._id;
      fbPath = getFirebaseResourceIdPath(userReq.params._type, userRes, resId);
    }
    else {
      resource = JSON.parse(proxyResData.toString('utf-8'));
      fbPath = getFirebaseResourcePath(userReq.params._type, userRes);
    }

    var userResRef = getFirebaseReference(fbPath);
    return new Promise(function (resolve, reject) {
      if(isUserResource(userReq.params._type)) {
        firebaseExecute(method, userResRef, resource)
          .then(function () {
            resolve(proxyResData);
          })
          .catch(reject);
      }
      else {
        resolve(proxyResData);
      }
    });
  }


  /**
   * Execute firebase operation with given reference
   *
   * @param method - Represents firebase operation
   * @param firebaseReference - firebase reference
   * @param resource - Optional resource object from fhir server.
   * @returns {*} Returns promise
   */
  function firebaseExecute (method, firebaseReference, resource) {

    var firebaseFn = null;
    var data = null; // Used for get/set/update.
    switch (method) {
      case 'get':
        firebaseFn = firebaseReference.once;
        data = 'value'; // Argument for .once()
        break;
      case 'remove':
        firebaseFn = firebaseReference.remove;
        break;

      case 'set':
      // IMPORTANT - firebase.set replaces all children. For our semantics, use update.
      case 'update':
        data = {};
        data[resource.id] = createStorageData(resource);
        firebaseFn = firebaseReference.update;
        break;
    }

    return firebaseFn.call(firebaseReference, data);
  }


  /**
   * Handles updating/deleting resource references from firebase storage, using
   * firebase transaction api.
   *
   * @param fhirTransactionBundle - Fhir transaction bundle specifying transaction request.
   * @param fhirTransactionResponseBundle - Fhir transaction response bundle obtained from fhir server.
   * @param userRes - User response object as defined by express.js
   * @returns {Promise<any>} A promise which consolidates all firebase transaction promises.
   */
  function firebaseTransactionProcess(fhirTransactionBundle, fhirTransactionResponseBundle, userRes) {

    var resources = parseIdsFromFhirTransactionResponse(fhirTransactionBundle, fhirTransactionResponseBundle);
    if (resources.remove.length > 0 || resources.update.length > 0) {

      var ref = getFirebaseReference(getFirebaseFhirEndpointPath(userRes));

      handleFirebaseTransaction(ref, function (currentData) {
        resources.remove.forEach(function (item) {
          if (currentData[item.resourceType]) {
            delete currentData[item.resourceType][item.id];
          }
        });

        resources.update.forEach(function (item) {
          if (!currentData[item.resourceType]) {
            currentData[item.resourceType] = {};
          }
          currentData[item.resourceType][item.id] = item.data;
        });

        return currentData;
      });
    }

    return fhirTransactionResponseBundle;
  }


  /**
   * Do firebase transaction with a call back.
   *
   * @param fbDatabaseRef - Firebase database reference object.
   * @param callback - The callback to update the data at reference location. The call back is given the current
   *                   snapshot of the data. The caller may modify it and return the object. To abort the
   *                   changes, caller could return null;
   * @returns {*|void|Promise<{committed: boolean; snapshot: admin.database.DataSnapshot | null}>|IDBTransaction}
   */
  function handleFirebaseTransaction(fbDatabaseRef, callback) {
    return fbDatabaseRef.transaction(function (currentData) {
      if (!currentData) {
        currentData = {};
      }
      return callback(currentData);
    }, function (error, commmitted, snapshot) {
      if (error) {
        console.log('Transaction failed abnormally!', error);
      }
    });
  }


  /**
   * Gather resource ids from the transaction response bundle into a data structure
   * identifying the resources for updates and deletions. This information is
   * intended to update firebase storage using firebase transaction.
   *
   * @param fhirRequestBundle - FHIR Request bundle sent to FHIR server.
   * @param fhirResponseBundle - FHIR response bundle received from FHIR server
   */
  function parseIdsFromFhirTransactionResponse(fhirRequestBundle, fhirResponseBundle) {
    var ret = {remove: [], update: []};
    if(fhirResponseBundle.type === 'transaction-response') {
      fhirRequestBundle.entry.forEach(function(entry, index){
        var location = null;
        // If a resource is created on the server, read the id and type from the response,
        // otherwise read it from request url. 201 = created.
        if(fhirResponseBundle.entry[index].response.status.startsWith('201')) {
          location = fhirResponseBundle.entry[index].response.location;
        }
        else if(fhirResponseBundle.entry[index].response.status.startsWith('20')) {
          location = entry.request.url;
        }
        // Separate resources for updates and removals
        if(location && location.search(/\//) > 0) {
          var locationParts = location.split('/', 2);
          var method = entry.request.method.toUpperCase();
          var obj = null;
          if(method === 'DELETE') {
            obj = ret.remove;
          }
          else if(method === 'POST' || method === 'PUT' || method === 'PATCH') {
            obj = ret.update;
          }
          else {
            return; // Iterate next. Other methods don't effect firebase storage.
          }

          var resourceType = locationParts[0];
          var dataToStore = createStorageData(entry.resource);

          if(fhirResponseBundle.entry[index].response && fhirResponseBundle.entry[index].response.lastModified) {
            dataToStore.updatedAt = fhirResponseBundle.entry[index].response.lastModified;
          }

          if(isUserResource(resourceType)) {
            var data = {data: dataToStore, id: locationParts[1].toString(), resourceType: resourceType};
            obj.push(data);
          }
        }
     });
    }

    return ret;
  }


  /**
   * Create a firebase storage data out of fhir resource
   *
   * @param fhirResource
   * @returns {*}
   */
  function createStorageData(fhirResource) {
    let ret = null;
    if(fhirResource) {
      ret = {
        updatedAt: fhirResource.date || Date(),
        resName: fhirResource.name || ''
      };
    }
    return  ret;
  }


  /**
   * See whether to bypass check for resource ownership
   * @param resType - FHIR resource type
   * @returns {boolean}
   */
  function isUserResource(resType) {
    let userResources = [
      'Questionnaire'
    ];
    let ret = false;
    if(userResources.includes(resType)) {
      ret = true;
    }

    return ret;
  }


  return {
    /**
     * Proxy response decorator used after updating a resource on the fhir server.
     *
     * @param proxyRes - Represents response from target server
     * @param proxyResData - Represents response data from target server
     * @param userReq - Represents user request to this server
     * @param userRes - Represents response object of this server.
     */
    update: function (proxyRes, proxyResData, userReq, userRes) {
      return handleFirebaseVoid('update', proxyRes, proxyResData, userReq, userRes);
    },


    /**
     * Proxy response decorator to update firebase after create operation on fhir server
     *
     * @param proxyRes - Represents response from target server
     * @param proxyResData - Represents response data from target server
     * @param userReq - Represents user request to this server
     * @param userRes - Represents response object of this server.
     */
    create: function (proxyRes, proxyResData, userReq, userRes) {
      return handleFirebaseVoid('set', proxyRes, proxyResData, userReq, userRes);
    },


    /**
     * Proxy response decorator to update firebase after delete operation on fhir server
     *
     * @param proxyRes - Represents response from target server
     * @param proxyResData - Represents response data from target server
     * @param userReq - Represents user request to this server
     * @param userRes - Represents response object of this server.
     */
    'delete': function (proxyRes, proxyResData, userReq, userRes) {
      return handleFirebaseVoid('remove', proxyRes, proxyResData, userReq, userRes);
    },


    /**
     * Proxy response decorator to update firebase after delete operation on fhir server
     *
     * @param proxyRes - Represents response from target server (FHIR server)
     * @param proxyResData - Represents response data from target server
     * @param userReq - Represents user request to this server
     * @param userRes - Represents response object of this server.
     */
    transactionResponse: function (proxyRes, proxyResData, userReq, userRes) {
      return firebaseTransactionProcess(userReq.body, JSON.parse(proxyResData.toString('utf-8')), userRes);
    },


    /**
     * Search fhir server using optional resource ids stored in firebase.
     *
     * It handles special cases of searching Questionnaire/QuestionnaireResponse
     * resources whose id are store in firebase.
     *
     * @param req {Object} - Request object
     * @param res {Object} - Response object
     * @param next {Function} - Call to go to next middleware.
     */
    search: function (req, res, next) {

      var all = false;
      var firebaseRef = null;
      let fbPath = null;

      // Build appropriate firebase reference
      if (req.query.allUsers) {
        all = true;
        fbPath = ['user-resources'];
      }
      else if (req.query.thisUserOnly) {
        fbPath = getFirebaseResourcePath(req.params._type, res);
      }

      firebaseRef = getFirebaseReference(fbPath);
      if (firebaseRef) {
        firebaseExecute('get', firebaseRef)
          .then(function (snapshot) {
            var storedItems = {};
            var values = snapshot.val();
            if (values) {
              if (all) {
                Object.keys(values).forEach(function (userId) {
                  var resources = values[userId][Buffer.from(userRes.locals.fhirEndpoint).toString('base64')][req.params._type];
                  Object.keys(resources).forEach(function (resId) {
                    storedItems[resId] = resources[resId];
                  });
                });
              }
              else {
                storedItems = values;
              }
            }
            var ids = storedItems ? Object.keys(storedItems) : [];
            // If there are no ids, we want to send a bundle with empty entries.
            // fhir.js does not take empty or null id list. Search it with non existing id.
            // Set a default search for a zero hits. Hopefully 0 id is not
            // allowed in FHIR???
            if (!ids.length) {
              ids.push('.');
            }
            req.query._id = ids.join(',');
            next();
          })
          .catch(function (err) {
            res.status(404).send({error: err});
          });
      }
      else {
        // No firebase reference implies searching other than
        // questionnaire/response resources. Pass it through to proxy.
        next();
      }
    },


    /**
     * Authenticate user with Firebase and store the user id in res.locals.
     *
     * @param req {Object} - Request object
     * @param res {Object} - Response object
     * @param next {Function} - Call to go to next middleware.
     */
    verifyUser: function (req, res, next) {
      var idToken = parseUserToken(req);
      if (idToken) {
        fireAdmin.auth().verifyIdToken(idToken)
          .then(function (decodedToken) {
            res.locals.userId = decodedToken.uid;
            next();
          })
          .catch(function (error) {
            // Handle error
            console.log("Id token verification failed:");
            console.log(error);
            res.status(401).send({error: error});
          });
      }
      else {
        console.log("User identification required:");
        res.status(403).send({error: "User identification required."});
      }
    },


    /**
     * Check the ownership of the resource to modify. Should be called after parsing.
     *
     * @param req {Object} - Request object
     * @param res {Object} - Response object
     * @param next {Function} - Call to go to next middleware.
     */
    checkResourceOwner: function (req, res, next) {
      if (!req.params._id) {
        const str = "Resource id not specified";
        console.log(str);
        res.status(400).send({error: str});
      }
      else if (isUserResource(req.params._type)) {
        var path = getFirebaseResourceIdPath(req.params._type, res, req.params._id);
        var userResRef = getFirebaseReference(path);
        userResRef.once("value")
          .then(function (snapshot) {
            if (snapshot.val()) {
              console.log("owner, permission granted");
              next();
            }
            else {
              console.log("not owner, permission not granted");
              res.status(401).send({error: 'The resource is not found. This is due to either the user is not owner of this resource, or it has been deleted from the storage.'});
            }
          })
          .catch(function (error) {
            console.log("Error finding owner permissions.");
            res.status(400).send({error: error});
          });
      }
      else {
        next();
      }
    },
  };
};
