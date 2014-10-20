/**
 * Look for an argument with the given name and remove it if found.
 * Returns `true` if the argument is found, the `defautlValue` value otherwise.
 */
function option(args, name, defaultValue) {
  var i = args.indexOf(name)
  if (~i) {
    args.splice(i, 1)
    return true
  }
  return defaultValue
}

function optionWithAddress(args, name) {
  var i = args.indexOf(name)
  if (~i) {
    var address = args.splice(i, 2)[1]
    if (/^.+?:\d+$/.test(address)) {
      return address.split(':')
    } else {
      throw new Error('Not a valid address for ' + name + ': ' + address)
    }
  }
}

exports.parseOpts = function(args, defaults) {
  var deps = defaults.deps

  // truthy: --all-deps, falsy: one level
  if (typeof deps != 'number') deps = deps? -1 : 1

  if (option(args, '--all-deps')) deps = -1
  else if (option(args, '--no-deps')) deps = 0

  return {
    listen: optionWithAddress(args, '--listen'),
    remote: optionWithAddress(args, '--remote'),
    deps: deps,
    dedupe: option(args, '--dedupe', defaults.dedupe)
  }
}

exports.injectScript = function(args, script) {
  // Find the first arg that is not an option
  for (var i=0; i < args.length; i++) {
    if (!/^-/.test(args[i])) {
      // Splice script into the argument list
      args.splice(i, 0, script)
      break
    }
  }
}
