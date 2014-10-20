var fork = require('child_process').fork
  , util = require('util')
  , events = require('events')
  , EventEmitter = events.EventEmitter
  , path = require('path')
  , net = require('net')
  , filewatcher = require('filewatcher')
  , ipc = require('./ipc')
  , notify = require('./notify')
  , cfg = require('./cfg')
  , cli = require('./cli')
  , log = require('./log')

module.exports = function(args) {

  // Parse command line options
  var opts = cli.parseOpts(args, cfg)

  if (opts.listen) {
    var server = net.createServer(function(conn) {
      var watcher = filewatcher()

      var buffer = ''
      conn.on('data', function(data) {
        buffer += data.toString()
        while ((index = buffer.indexOf('\r\n')) !== -1) {
          var str = buffer.substr(0, index)
          buffer = buffer.substr(index + 2)

          var cmd = str.split(' ')
          if (cmd[0] === 'ADD') {
            watcher.add(cmd[1])
          } else if (cmd[0] === 'REMOVEALL') {
            watcher.removeAll()
          }
        }
      })

      conn.on('error', function() {
        // Nothing to do here
      })

      watcher.on('change', function(file) {
        conn.write('CHANGE ' + file + '\r\n')
        watcher.removeAll()
      })

      watcher.on('fallback', function(limit) {
        conn.write('FALLBACK ' + limit + '\r\n')
      })
    })

    server.listen(opts.listen[1], opts.listen[0])

    return
  }

  // The child_process
  var child

  // Run ./dedupe.js as prelaod script
  if (opts.dedupe) process.env.NODE_DEV_PRELOAD = __dirname + '/dedupe'

  // Inject wrap.js into the args array
  cli.injectScript(args, __dirname + '/wrap.js')

  var watcher = new WatchWrapper(opts.remote)

  watcher.on('change', function(file) {
    if (cfg.clear) process.stdout.write('\033[2J\033[H')
    notify('Restarting', file + ' has been modified')
    watcher.removeAll()
    if (child) {
      // Child is still running, restart upon exit
      child.on('exit', start)
      stop()
    }
    else {
      // Child is already stopped, probably due to a previous error
      start()
    }
  })

  watcher.on('fallback', function(limit) {
    log.warn('node-dev ran out of file handles after watching %s files.', limit)
    log.warn('Falling back to polling which uses more CPU.')
    log.info('Run ulimit -n 10000 to increase the file descriptor limit.')
    if (opts.deps) log.info('... or add `--no-deps` to use less file handles.')
  })

  /**
   * Run the wrapped script.
   */
  function start() {
    child = fork(args[0], args.slice(1), {
      cwd: process.cwd(),
      env: process.env
    })
    .on('exit', function(code) {
      if (!child.respawn) process.exit(code)
      child = undefined
    })

    // Listen for `required` messages and watch the required file.
    ipc.on(child, 'required', function(m) {
      if (opts.deps == -1 || getLevel(m.required) <= opts.deps) {
        watcher.add(m.required)
      }
    })

    // Upon errors, display a notification and tell the child to exit.
    ipc.on(child, 'error', function(m) {
      notify(m.error, m.message, 'error')
      stop()
    })
  }

  function stop() {
    child.respawn = true
    child.kill('SIGTERM')
    child.disconnect()
  }

  // Relay SIGTERM
  process.on('SIGTERM', function() {
    if (child) child.kill('SIGTERM')
    process.exit(0)
  })

  start()
}

/**
 * Returns the nesting-level of the given module.
 * Will return 0 for modules from the main package or linked modules,
 * a positive integer otherwise.
 */
function getLevel(mod) {
  var p = getPrefix(mod)
  return p.split('node_modules').length-1
}

/**
 * Returns the path up to the last occurence of `node_modules` or an
 * empty string if the path does not contain a node_modules dir.
 */
function getPrefix(mod) {
  var n = 'node_modules'
  var i = mod.lastIndexOf(n)
  return ~i ? mod.slice(0, i+n.length) : ''
}

function WatchWrapper(remote) {
  this.remote = remote
  var self = this

  this.watcher = filewatcher()
  this.watcher.on('change', function(file) {
    self.emit('change', file)
  })
  this.watcher.on('fallback', function(limit) {
    self.emit('change', limit)
  })

  if (this.remote) {
    this.files = []
    var self = this

    !(function connectLoop() {
      self.conn = net.createConnection(self.remote[1], self.remote[0])

      self.files.forEach(function(file) {
        self.conn.write('ADD ' + file + '\r\n')
      })

      self.conn.on('connect', function() {
        log.info('Connected to remote')
      })

      var buffer = ''
      self.conn.on('data', function(data) {
        buffer += data.toString()
        while ((index = buffer.indexOf('\r\n')) !== -1) {
          var str = buffer.substr(0, index)
          buffer = buffer.substr(index + 2)

          var cmd = str.split(' ')
          if (cmd[0] === 'CHANGE') {
            self.emit('change', cmd[1])
          } else if (cmd[0] === 'FALLBACK') {
            self.emit('fallback', cmd[1])
          }
        }
      })

      self.conn.on('error', function() {
        // Nothing to do here
      })

      self.conn.on('close', function() {
        log.info('Disconnected from remote, reconnecting in 10 seconds...')
        setTimeout(connectLoop, 10000)
      })
    }())
  }
}

util.inherits(WatchWrapper, EventEmitter)

WatchWrapper.prototype.add = function(file) {
  this.watcher.add(file)

  if (this.remote) {
    if (file.indexOf(process.cwd()) !== 0) {
      log.warn('Ignoring file outside of current working directory: ' + file)
    } else {
      var relFile = file.substr(process.cwd().length + 1)
      this.files.push(relFile)
      this.conn.write('ADD ' + relFile + '\r\n')
    }
  }
}

WatchWrapper.prototype.removeAll = function() {
  this.watcher.removeAll()

  if (this.remote) {
    this.files = []
    this.conn.write('REMOVEALL\r\n')
  }
}
