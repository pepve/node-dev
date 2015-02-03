var resolve = require('resolve').sync

/**
 * Look for an argument with the given name and remove it if found.
 * Returns `true` if the argument is found, `false` otherwise.
 */
function option(args, name) {
  var i = args.indexOf(name)
  if (~i) {
    args.splice(i, 1)
    return true
  }
  return false
}

function optionValue(args, name) {
  var i = args.indexOf(name)
  if (~i) {
    return args.splice(i, 2)[1]
  }
}

exports.parseOpts = function(args) {
  return {
    remote: option(args, '--remote'),
    remoteHost: optionValue(args, '--remote-host'),
    remotePort: optionValue(args, '--remote-port'),
    allDeps: option(args, '--all-deps'),
    noDeps: option(args, '--no-deps'),
    dedupe: option(args, '--dedupe')
  }
}

exports.injectScript = function(args, script) {
  // Find the first arg that is not an option
  for (var i=0; i < args.length; i++) {
    if (!/^-/.test(args[i])) {
      // Splice script into the argument list
      args.splice(i, 0, script)
      return exports.resolveMain(args[i+1])
    }
  }
}

exports.resolveMain = function(main) {
  return resolve(main, {
    basedir: process.cwd(),
    paths: [process.cwd()]
  })
}
