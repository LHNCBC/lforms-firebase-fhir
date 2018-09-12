
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

    nsp: {
      package: grunt.file.readJSON('./package.json'),
      shrinkwrap: grunt.file.readJSON('./package-lock.json')
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
      'mochaTest',
      'nsp'
    ]);
  });
  grunt.registerTask('default', 'test');

};

