# firebaseFhirMiddleware
This is an express style middleware to mount on an express server 
application. The middleware acts as an intermediary to a backend internal FHIR server for a front end
firebase web application. In addition to providing user authentication functionality,
if the user creates a fhir resource on the server, it stores resource ids in a firebase database 
associated with user account. Currently, storing IDs is only supported for Questionnaire and 
QuestionnaireResponse resources. 

* The client is expected to be a firebase application. For details see <https://firebase.google.com>.

* The client is expected to follow RESTful FHIR API specifications. 
For details on FHIR API, see <https://www.hl7.org/fhir/http.html>. The FHIR API 
interface is tested with fhir.js package. 

* The middleware also expects to have a running instance of a FHIR server to 
relay the client requests to backend FHIR server. 

#### Using a third party FHIR server
In addition to a default FHIR server, the client could specify a third party 
public FHIR server by using the 'x-target-fhir-endpoint' custom header in the client 
request. If the header is not set, the middleware uses server's default FHIR server.
If the third party FHIR server needs authorization, the client should set 
'x-target-fhir-server-authorization' header with required credentials. The middleware 
sends this header as an Authorization header to the specified FHIR server (the feature is 
only tested with basic authentication protocol).

##### Server side code snippet ...
```javascript

var firebaseFhirMW = require('lforms-firebase-fhir');

var app = require('express')();

// Assuming the fhir server url is http://fhir-server.com/baseDstu3/
var firebaseFhirOpts = {
  firebaseAdmin: admin, // required
  defaultFhirUrl: 'http://fhir-server.com', // required. Do not specify path here. Use proxyPath
  mountPath: '/mypath', // Path where this middleware is mounted on the server.
  proxyPath: '/baseDstu3/' // Path to replace mountPath on FHIR server http requests
};

// Use the middleware
app.use(firebaseFhirOpts.mountPath, firebaseFhirMW(firebaseFhirOpts));

var http = require('http');
var server = http.createServer(app);

server.listen(8080, function(){});
```
##### Client side code snippet ...
```javascript

var mkFhir = require('fhir.js');
var firebaseBearerToken = '...'; // Get the firebase bearer token after user's 
                                 // successful firebase login 
var fhirClientConfig = {
    baseUrl: 'http://localhost:8080/mypath',
    auth: {
      bearer: firebaseBearerToken 
    }
};

// For details on how to use fhir.js package, see https://github.com/FHIR/fhir.js
var client = mkFhir(fhirClientConfig);

// Optionally to specify third party FHIR server.
fhirClientConfig.headers = {
  'x-target-fhir-endpoint': 'http://hapi.fhir.org/baseDstu3/',
  'x-target-fhir-server-authorization': 'Basic XXXXXXXXXXX' // Set a valid authorization
};

// Get FHIR conformance statement from the server.
client.conformance({}).then(function (resp) {
  // resp.data is the conformance statement from http://hapi.fhir.org/baseDstu3/
});

  // Optionally reset custom FHIR headers to use default FHIR server.
fhirClientConfig.headers = {};

client.search({type: 'Questionnaire', query: {title: 'Vital Signs'}})
  .then(function (resp) {
    // resp.data is 'searchset' type FHIR bundle from http://fhir-server.com/baseDstu3/. 
  });
```
