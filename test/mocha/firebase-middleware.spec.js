/**
 * Test firebase-fhir middleware using fhir.js api
 */

var expect = require('chai').expect;
var sinon = require('sinon');
var requestMock = require('express-request-mock');
var fhirMock = require('./fhir-server-mock');
let dummyData = require('./fixtures/dummyData');

var mkFhir = require('fhir.js');
var _firebaseFhir = require('../../src/firebase-middleware');
var firebaseFhirAPI = require('../../');

var app = require('express')();
var bodyParser = require('body-parser');

app.use(bodyParser.json());
var http = require('http');
var server = http.createServer(app);

var targetFhirUrl = 'https://example.com:8443';
var defaultFhirUrl = 'http://example1.org:8080';

let targetfhirEndpoint = targetFhirUrl+'/baseDstu3/';
let defaultfhirEndpoint = defaultFhirUrl+'/baseDstu3/';

let encodedTargetfhirEndpoint = Buffer.from(targetfhirEndpoint).toString('base64');
let encodedDefaultfhirEndpoint = Buffer.from(defaultfhirEndpoint).toString('base64');

describe('Test firebase-fhir-middleware api', function() {

  var admin, firebaseFhirOpts, _firebaseActions;

  // START firebase admin mock setup.
  var verifyIdTokenStub, refStub, updateStub, removeStub;
  var onceStubUserResourceIds, onceStubUsers;
  var users = 'user-resources';
  var patients = 'patient-resources';
  var userResources = 'user-resources/dummyUserToken1';
  var dummyUserTargetFhirResource1 = 'user-resources/dummyUserToken1/'+encodedTargetfhirEndpoint+'/1';
  var dummyUserDefFhirResource1 = 'user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/1';
  var patientResources = 'patient-resources/dummyPatient1';
  let sandbox1 = sinon.sandbox.create();

  before(function () {


    admin =  require('firebase-admin');

    sandbox1.stub(admin, 'initializeApp');
    verifyIdTokenStub = sandbox1.stub();
    verifyIdTokenStub.withArgs('dummyBearerToken1').returns(Promise.resolve({uid: 'dummyUserToken1'}));
    verifyIdTokenStub.withArgs('dummyBearerToken2').returns(Promise.resolve({uid: 'dummyUserToken2'}));
    let invalidPrm = Promise.reject('Invalid token');
    invalidPrm.catch(()=>{});
    verifyIdTokenStub.withArgs('invalidBearerToken').returns(invalidPrm);
    sandbox1.stub(admin, 'auth').get(function getterFn(){
      return function () {
        return {verifyIdToken: verifyIdTokenStub};
      };
    });
    onceStubUsers = sandbox1.stub();
    onceStubUsers.returns(Promise.resolve({val: function() {return dummyData.QData}}));
    onceStubUserResourceIds = sandbox1.stub();
    onceStubUserResourceIds.returns(Promise.resolve({val: function() {return dummyData.QData1}}));
    updateStub = sandbox1.stub();
    updateStub.resolves(null);
    removeStub = sandbox1.stub();
    removeStub.resolves(null);

    refStub = sandbox1.stub();
    refStub.withArgs(dummyUserTargetFhirResource1).returns({once: onceStubUserResourceIds, update: updateStub, remove: removeStub});
    refStub.withArgs(dummyUserDefFhirResource1).returns({once: onceStubUserResourceIds, update: updateStub, remove: removeStub});
    refStub.withArgs(userResources).returns({once: onceStubUserResourceIds, update: updateStub, remove: removeStub});
    refStub.withArgs(users).returns({once: onceStubUsers, update: updateStub, remove: removeStub});
    sandbox1.stub(admin, 'database').get(function getterFn(){
      return function () {
        return {ref: refStub};
      };
    });

  // END of firebase mock setup

    firebaseFhirOpts = {
      firebaseAdmin: admin, // required
      defaultFhirUrl: defaultFhirUrl, // required
      mountPath: '/',
      proxyPath: '/baseDstu3/'
    };

    // Use the middleware
    _firebaseActions = _firebaseFhir(firebaseFhirOpts.firebaseAdmin);
    app.use(firebaseFhirOpts.mountPath, firebaseFhirAPI(firebaseFhirOpts));

    // Testing is limited to how the fhir.js api is translated to HTTP requests sent to backend fhir server.
    // fhirMock returns translated urls, and request objects. Run the tests on these expected http requests.
    fhirMock(defaultFhirUrl).persist();
    fhirMock(targetFhirUrl).persist();

    server.listen(9021, function(){});

  });

  after(function () {
    sandbox1.restore();
    server.close();
  });

  describe('firebase operations', function() {

    let sandbox2 = sinon.sandbox.create();
    let prePath = 'user-resources/dummyUserToken1/'+ encodedDefaultfhirEndpoint;

    let ref = sandbox2.stub();
    let rStub = sandbox2.stub();
    let uStub = sandbox2.stub();
    let notFoundOnceStub = sandbox2.stub();
    let foundOnceStub = sandbox2.stub();
    notFoundOnceStub.returns(Promise.resolve({val: function() {}}));
    foundOnceStub.returns(Promise.resolve({val: function() {return  dummyData.QData1}}));
    let errorOnceStub = sandbox2.stub();
    let fakePrm = Promise.reject("Fake error");
    fakePrm.catch(()=>{});
    errorOnceStub.returns(fakePrm);

    before(function () {
      sandbox2.stub(admin, 'database').get(function getterFn(){
        return function () {
          return {ref: ref};
        };
      });

      ref.withArgs(prePath + '/Questionnaire').returns({update: uStub});
      ref.withArgs(prePath + '/Questionnaire/1').returns({once: foundOnceStub, remove: rStub});
      ref.withArgs(prePath + '/Questionnaire/X').returns({once: notFoundOnceStub});
      ref.withArgs(prePath + '/Questionnaire/ERROR').returns({once: errorOnceStub});
      ref.withArgs(prePath + '/aType').returns({once: errorOnceStub});
    });

    after(function () {
      sandbox2.restore();
    });

    it('should verify user', function(){
      let req = {headers: {authorization: "bearer dummyBearerToken1"}};
      return requestMock(_firebaseActions.verifyUser, req)
        .then(function ({res}) {
          expect(res.locals.userId).to.equal('dummyUserToken1');
        });
    });

    it('should return 401 error on invalid user', function(){
      let req = {headers: {authorization: "bearer invalidBearerToken"}};
      return requestMock(_firebaseActions.verifyUser, req).then(({res}) => {
        expect(res.statusCode).to.equal(401);
        expect(res._getData().error).to.equal('Invalid token');
      });
    });

    it('should return 403 error on no user specified', function(){
      let req = {headers: {}};
      return requestMock(_firebaseActions.verifyUser, req).then(({res}) => {
        expect(res.statusCode).to.equal(403);
        expect(res._getData().error).to.equal('User identification required.');
      });
    });

    it('should return success on checkResourceOwner', function(){
      let req = {
        headers: {authorization: "bearer dummyBearerToken1"},
        params: {_id: '1', _type: 'Questionnaire'}};
      let decorator = {locals: {userId: 'dummyUserToken1', fhirEndpoint: defaultfhirEndpoint}};
      return requestMock(_firebaseActions.checkResourceOwner, req, decorator).then(({res}) => {
        expect(res.statusCode).to.equal(200);
      });
    });

    it('should return 400 error on checkResourceOwner with no resource id', function(){
      return requestMock(_firebaseActions.checkResourceOwner, {}).then(({res}) => {
        expect(res.statusCode).to.equal(400);
        expect(res._getData().error).to.equal("Resource id not specified");
      });
    });

    it('should return 400 error on checkResourceOwner/firebase.once() error', function(){
      let req = {
        headers: {authorization: "bearer dummyBearerToken1"},
        params: {_id: 'ERROR', _type: 'Questionnaire'}};
      let decorator = {locals: {userId: 'dummyUserToken1', fhirEndpoint: defaultfhirEndpoint}};
      return requestMock(_firebaseActions.checkResourceOwner, req, decorator).then(({res}) => {
        expect(res.statusCode).to.equal(400);
        expect(res._getData().error).to.equal('Fake error');
      });
    });

    it('should return 401 error on checkResourceOwner', function(){
      let req = {
        headers: {authorization: "bearer dummyBearerToken1"},
        params: {_id: 'X', _type: 'Questionnaire'}};
      let decorator = {locals: {userId: 'dummyUserToken1', fhirEndpoint: defaultfhirEndpoint}};
      return requestMock(_firebaseActions.checkResourceOwner, req, decorator).then(({res}) => {
        expect(res.statusCode).to.equal(401);
        expect(res._getData().error).to.have.string('The resource is not found');
      });
    });

    it('should return 404 error on search/firebase.once error', function(){
      let req = {
        headers: {authorization: "bearer dummyBearerToken1"},
        params: {_id: 'ERROR', _type: 'aType'},
        query: {thisUserOnly: true}};
      let decorator = {locals: {userId: 'dummyUserToken1', fhirEndpoint: defaultfhirEndpoint}};
      return requestMock(_firebaseActions.search, req, decorator).then(({res}) => {
        expect(res.statusCode).to.equal(404);
        expect(res._getData().error).to.equal('Fake error');
      });
    });

    describe('user related resource data', function () {
      let userReq = {params: {_id: '1'}};
      let userRes = {locals: {userId: 'dummyUserToken1', fhirEndpoint: defaultfhirEndpoint}};
      let QRProxyResData = require('fs').readFileSync(__dirname+'/fixtures/QuestionnaireResponse.json');
      let QProxyResData = require('fs').readFileSync(__dirname+'/fixtures/Questionnaire.json');

      afterEach(function () {
        uStub.resetHistory();
        rStub.resetHistory();
      });

      it('should create storage for Questionnaire', function() {
        userReq.params._type = 'Questionnaire';
        uStub.resolves(QProxyResData);

        return _firebaseActions.create({}, QProxyResData, userReq, userRes).then(function (respData) {
          expect(respData).to.deep.equal(QProxyResData);
          expect(uStub.calledOnceWith({'1': {resName: 'US Surgeon General family health portrait',
              updatedAt: '2018-02-20T14:56:27-05:00'}})).to.be.true;
        });
      });

      it('should update storage for Questionnaire', function() {
        userReq.params._type = 'Questionnaire';
        uStub.resolves(QProxyResData);

        return _firebaseActions.update({}, QProxyResData, userReq, userRes).then(function (respData) {
          expect(respData).to.deep.equal(QProxyResData);
          expect(uStub.calledOnceWith({'1': {resName: 'US Surgeon General family health portrait',
              updatedAt: '2018-02-20T14:56:27-05:00'}})).to.be.true;
        });
      });

      it('should delete Questionnaire', function() {
        userReq.params._type = 'Questionnaire';
        rStub.resolves(null);
        return _firebaseActions.delete({}, {}, userReq, userRes).then(function () {
          expect(rStub.calledOnce).to.be.true;
        });
      });

    });
  });

  describe('FHIR RESTful interaction with fhir.js', function () {
    var fhirClientConfig, client;
    before(function() {
      fhirClientConfig = {
        baseUrl: 'http://localhost:9021',
        auth: {}
      };
      client = mkFhir(fhirClientConfig);
    });

    beforeEach(function(){
      fhirClientConfig.auth.bearer = 'dummyBearerToken1';
      fhirClientConfig.headers = {};
    });

    it('should get capability statement', function() {
      return client.conformance({}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.req.headers.host).to.equal(defaultFhirUrl.replace(/^https?:\/\//, ''));
        expect(resp.data.uri).to.equal('/baseDstu3/metadata');
      });
    });

    it('should use target fhir endpoint', function() {
      // Set a target fhir endpoint and its authentication.
      fhirClientConfig.headers = {
        'x-target-fhir-endpoint': targetfhirEndpoint,
        'x-target-fhir-server-authorization': 'Basic bGZvcm1zOmRlbW8='
      };
      return client.conformance({}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.req.headers.host).to.equal(targetFhirUrl.replace(/^https?:\/\//, ''));
        expect(resp.data.uri).to.equal('/baseDstu3/metadata');
      });
    });

    it('should fail with invalid bearer token', function() {
      // Recreate fhir client with invalid token
      fhirClientConfig.auth.bearer = 'invalidBearerToken';
      var aClient = mkFhir(fhirClientConfig);
      return aClient.search({type: "Questionnaire"}).then(function (resp) {
        throw new Error("Not expected to resolve"+JSON.stringify(resp));
      }, function(error) {
        expect(error.status).to.equal(401);
      });
    });

    it('should fail with empty bearer token', function() {
      // Recreate fhir client with empty token
      fhirClientConfig.auth.bearer = '';
      var aClient = mkFhir(fhirClientConfig);
      return aClient.search({type: "Questionnaire"}).then(function (resp) {
        throw new Error("Not expected to resolve"+JSON.stringify(resp));
      }, function(error) {
        expect(error.status).to.equal(403);
      });
    });

    it('should search all Questionnaires', function() {
      return client.search({type: "Questionnaire"}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire');
      });
    });

    it('should search user Questionnaires', function() {
      // Stub firebase call
      let onceStub = sandbox1.stub().returns(Promise.resolve({val: function() {return dummyData.QData1}}));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire').returns({once: onceStub});

      return client.search({type: "Questionnaire", query: {thisUserOnly: 'true'}}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire?_id=1%2C2');
      });
    });

    it('should search all QuestionnaireResponse', function() {
      return client.search({type: "QuestionnaireResponse"}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.uri).to.equal('/baseDstu3/QuestionnaireResponse');
      });
    });

    it('should delete a resource', function() {
      // Stub firebase call for resource ownership and remove
      let onceStub = sandbox1.stub().returns(Promise.resolve({val: function() {return dummyData.QData1["1"]}}));
      let rmStub = sandbox1.stub().returns(Promise.resolve(null));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire/1').returns({once: onceStub, remove: rmStub});

      return client.delete({type: "Questionnaire", id: 1}).then(function (resp) {
        expect(resp.data.method).to.equal('DELETE');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire/1');
      });
    });

    it('should update a resource', function() {
      // Stub firebase call for resource ownership and update
      let onceStub = sandbox1.stub().returns(Promise.resolve({val: function() {return dummyData.QData1["1"]}}));
      let updateStub = sandbox1.stub().returns(Promise.resolve(null));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire/1').returns({once: onceStub});
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire').returns({update: updateStub});

      let res = {id: 1, resourceType: 'Questionnaire', dummy: 'dummy'};
      return client.update({type: "Questionnaire", id: 1, resource: res}).then(function (resp) {
        expect(resp.data.method).to.equal('PUT');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire/1');
        expect(resp.data.requestBody).to.deep.equal(res);
      });
    });

    it('should create a resource', function() {
      // Stub firebase call for update, which is used for create call
      let updateStub = sandbox1.stub().returns(Promise.resolve(null));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire').returns({update: updateStub});

      let res = {resourceType: 'Questionnaire', entry: []};
      return client.create({resource: res}).then(function (resp) {
        expect(resp.data.method).to.equal('POST');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire');
        expect(resp.data.requestBody).to.deep.equal(res);
      });
    });

    it('should read a resource', function() {
      // Stub firebase once
      let onceStub = sandbox1.stub().returns(Promise.resolve({val: function() {return dummyData.QData1["1"]}}));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire/1').returns({once: onceStub});
      return client.read({type: "Questionnaire", id: '1'}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire/1');
      });
    });

    it('should vread a resource', function() {
      // Stub firebase once
      let onceStub = sandbox1.stub().returns(Promise.resolve({val: function() {return dummyData.QData1["1"]}}));
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint+'/Questionnaire/1').returns({once: onceStub});
      return client.vread({type: "Questionnaire", id: '1', versionId: 5}).then(function (resp) {
        expect(resp.data.method).to.equal('GET');
        expect(resp.data.uri).to.equal('/baseDstu3/Questionnaire/1/_history/5');
      });
    });

    it('should do transaction', function() {
      let transactionBundle = require('./fixtures/transaction-test');
      let qTransactionStub = sandbox1.stub();
      let callbackData = {};

      // Capture data from transaction's callback and assert after success.
      qTransactionStub.callsArgWith(0, callbackData);
      refStub.withArgs('user-resources/dummyUserToken1/'+encodedDefaultfhirEndpoint).returns({transaction: qTransactionStub});

      return client.transaction({bundle: transactionBundle}).then(function (resp) {
        expect(resp.data.type).to.equal('transaction-response');

        let [qType, qId] = resp.data.entry[0].response.location.split('/');
        // Check resource ids being updated in callback data.
        expect(resp.data.entry[0].response.lastModified).to.equal(callbackData[qType][qId].updatedAt);
        expect(resp.config.method).to.equal('POST');
        expect(resp.config.body).to.deep.equal(transactionBundle);
      });
    });
  });
});
