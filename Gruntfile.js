
'use strict';


module.exports = function(grunt) {

  // Load grunt tasks automatically, when needed
  require('jit-grunt')(grunt, {
    mochaTest: 'grunt-mocha-test'
  });

  grunt.initConfig({
    // Configure a mochaTest task
    mochaTest: {
      test: {
        options: {
          reporter: 'spec'
        },
        src: ['test/mocha/*.spec.js']
      }
    },

    env: {
      test: {
        NODE_ENV: 'test'
      }
    }
  });

  grunt.registerTask('test', function(target) {
    return grunt.task.run([
      'env:test',
      'mochaTest'
    ]);
  });
  grunt.registerTask('default', 'test');

};

