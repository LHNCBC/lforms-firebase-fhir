var qRes = require('./Questionnaire.json');
var qrRes = require('./QuestionnaireResponse.json');
module.exports = {
  "resourceType": "Bundle",
  "meta": {
    "lastUpdated": "2014-08-18T01:43:30Z"
  },
  "type": "transaction",
  "entry": [
    {
      "resource": qRes,
      "request": {
        "method": "POST",
        "url": "Questionnaire"
      }
    },
    {
      "resource": qrRes,
      "request": {
        "method": "POST",
        "url": "QuestionnaireResponse"
      }
    }
  ]
};