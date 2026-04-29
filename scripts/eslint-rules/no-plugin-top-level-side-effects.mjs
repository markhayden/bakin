const TIMER_NAMES = new Set(['setInterval', 'setTimeout'])
const EVENT_TARGET_NAMES = new Set(['globalThis', 'window', 'document', 'self'])
const PROCESS_LISTENER_NAMES = new Set(['on', 'addListener'])
const FILE_WATCH_NAMES = new Set(['watch', 'watchFile'])
const EVENT_LISTENER_NAMES = new Set(['on', 'addListener'])
const SOCKET_NAMES = new Set(['WebSocket', 'EventSource'])
const FS_MODULES = new Set(['fs', 'node:fs'])
const CHOKIDAR_MODULES = new Set(['chokidar'])
const EVENTS_MODULES = new Set(['events', 'node:events'])

function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion')
  ) {
    current = current.expression
  }
  return current
}

function getStaticName(node) {
  const unwrapped = unwrap(node)
  if (!unwrapped) return null
  if (unwrapped.type === 'Identifier') return unwrapped.name
  if (unwrapped.type === 'Literal' && typeof unwrapped.value === 'string') return unwrapped.value
  return null
}

function getMemberParts(node) {
  const unwrapped = unwrap(node)
  if (!unwrapped || unwrapped.type !== 'MemberExpression') return null
  return {
    object: unwrap(unwrapped.object),
    property: getStaticName(unwrapped.property),
  }
}

function isRequireCall(node, modules) {
  const unwrapped = unwrap(node)
  return Boolean(
    unwrapped &&
    unwrapped.type === 'CallExpression' &&
    getStaticName(unwrapped.callee) === 'require' &&
    unwrapped.arguments.length > 0 &&
    unwrapped.arguments[0].type === 'Literal' &&
    modules.has(unwrapped.arguments[0].value),
  )
}

function isZeroDelay(node) {
  const unwrapped = unwrap(node)
  if (!unwrapped) return false
  if (unwrapped.type === 'Literal') return Number(unwrapped.value) === 0
  if (unwrapped.type === 'UnaryExpression' && ['+', '-'].includes(unwrapped.operator)) {
    return isZeroDelay(unwrapped.argument)
  }
  return false
}

function isTimeoutAllowed(node) {
  if (node.arguments.length < 2) return true
  return isZeroDelay(node.arguments[1])
}

function isIifeFunction(node, sourceCode) {
  const ancestors = sourceCode.getAncestors(node)
  const parent = ancestors.at(-1)
  if (!parent || parent.type !== 'CallExpression') return false
  return unwrap(parent.callee) === node
}

function createNoPluginTopLevelSideEffectsRule(context) {
  const sourceCode = context.sourceCode ?? context.getSourceCode()
  const importTimeStack = [true]
  const fsNamespaces = new Set()
  const chokidarNamespaces = new Set()
  const fsWatchFunctions = new Set()
  const chokidarWatchFunctions = new Set()
  const eventNamespaces = new Set()
  const eventEmitterConstructors = new Set(['EventEmitter'])
  const eventEmitterVariables = new Set()

  function inImportTimeContext() {
    return importTimeStack.at(-1) === true
  }

  function report(node, kind) {
    context.report({
      node,
      messageId: 'topLevelLifetimeSideEffect',
      data: { kind },
    })
  }

  function trackImportDeclaration(node) {
    const source = node.source.value
    const isFs = FS_MODULES.has(source)
    const isChokidar = CHOKIDAR_MODULES.has(source)
    const isEvents = EVENTS_MODULES.has(source)
    if (!isFs && !isChokidar && !isEvents) return

    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
        if (isFs) fsNamespaces.add(specifier.local.name)
        if (isChokidar) chokidarNamespaces.add(specifier.local.name)
        if (isEvents) eventNamespaces.add(specifier.local.name)
        continue
      }

      if (specifier.type !== 'ImportSpecifier') continue
      const imported = getStaticName(specifier.imported)
      if (isFs && FILE_WATCH_NAMES.has(imported)) fsWatchFunctions.add(specifier.local.name)
      if (isChokidar && imported === 'watch') chokidarWatchFunctions.add(specifier.local.name)
      if (isEvents && imported === 'EventEmitter') eventEmitterConstructors.add(specifier.local.name)
    }
  }

  function trackRequireDeclaration(node) {
    if (!inImportTimeContext()) return
    const id = node.id
    const init = unwrap(node.init)
    if (!id || !init) return

    if (id.type === 'Identifier') {
      if (isRequireCall(init, FS_MODULES)) fsNamespaces.add(id.name)
      if (isRequireCall(init, CHOKIDAR_MODULES)) chokidarNamespaces.add(id.name)
      if (isRequireCall(init, EVENTS_MODULES)) eventNamespaces.add(id.name)
      if (isEventEmitterNew(init)) eventEmitterVariables.add(id.name)
      return
    }

    if (id.type !== 'ObjectPattern') return
    if (!isRequireCall(init, FS_MODULES) && !isRequireCall(init, CHOKIDAR_MODULES) && !isRequireCall(init, EVENTS_MODULES)) return

    for (const property of id.properties) {
      if (property.type !== 'Property') continue
      const imported = getStaticName(property.key)
      const local = property.value?.type === 'Identifier' ? property.value.name : null
      if (!imported || !local) continue
      if (isRequireCall(init, FS_MODULES) && FILE_WATCH_NAMES.has(imported)) fsWatchFunctions.add(local)
      if (isRequireCall(init, CHOKIDAR_MODULES) && imported === 'watch') chokidarWatchFunctions.add(local)
      if (isRequireCall(init, EVENTS_MODULES) && imported === 'EventEmitter') eventEmitterConstructors.add(local)
    }
  }

  function isFsWatchCall(callee) {
    const name = getStaticName(callee)
    if (name && fsWatchFunctions.has(name)) return true

    const member = getMemberParts(callee)
    return Boolean(
      member &&
      member.object?.type === 'Identifier' &&
      fsNamespaces.has(member.object.name) &&
      FILE_WATCH_NAMES.has(member.property),
    )
  }

  function isChokidarWatchCall(callee) {
    const name = getStaticName(callee)
    if (name && chokidarWatchFunctions.has(name)) return true

    const member = getMemberParts(callee)
    return Boolean(
      member &&
      member.object?.type === 'Identifier' &&
      chokidarNamespaces.has(member.object.name) &&
      member.property === 'watch',
    )
  }

  function isEventEmitterNew(node) {
    const unwrapped = unwrap(node)
    if (!unwrapped || unwrapped.type !== 'NewExpression') return false

    const calleeName = getStaticName(unwrapped.callee)
    if (calleeName && eventEmitterConstructors.has(calleeName)) return true

    const member = getMemberParts(unwrapped.callee)
    return Boolean(
      member &&
      member.object?.type === 'Identifier' &&
      eventNamespaces.has(member.object.name) &&
      member.property === 'EventEmitter',
    )
  }

  function isEventEmitterListenerCall(callee) {
    const member = getMemberParts(callee)
    if (!member || !EVENT_LISTENER_NAMES.has(member.property)) return false

    const object = unwrap(member.object)
    if (isEventEmitterNew(object)) return true
    return Boolean(object?.type === 'Identifier' && eventEmitterVariables.has(object.name))
  }

  function checkCallExpression(node) {
    if (!inImportTimeContext()) return

    const callee = unwrap(node.callee)
    const name = getStaticName(callee)
    if (name && TIMER_NAMES.has(name)) {
      if (name === 'setTimeout' && isTimeoutAllowed(node)) return
      report(node, 'timer')
      return
    }

    if (isFsWatchCall(callee) || isChokidarWatchCall(callee)) {
      report(node, 'file watcher')
      return
    }

    const member = getMemberParts(callee)
    if (!member) {
      if (isEventEmitterListenerCall(callee)) report(node, 'event listener')
      return
    }

    const objectName = getStaticName(member.object)
    if (objectName && TIMER_NAMES.has(member.property) && EVENT_TARGET_NAMES.has(objectName)) {
      if (member.property === 'setTimeout' && isTimeoutAllowed(node)) return
      report(node, 'timer')
      return
    }

    if (objectName === 'process' && PROCESS_LISTENER_NAMES.has(member.property)) {
      report(node, 'process listener')
      return
    }

    if (objectName && EVENT_TARGET_NAMES.has(objectName) && member.property === 'addEventListener') {
      report(node, 'event listener')
      return
    }

    if (isEventEmitterListenerCall(callee)) {
      report(node, 'event listener')
    }
  }

  function checkNewExpression(node) {
    if (!inImportTimeContext()) return

    const calleeName = getStaticName(node.callee)
    if (calleeName && SOCKET_NAMES.has(calleeName)) {
      report(node, 'connection')
      return
    }

    const member = getMemberParts(node.callee)
    const objectName = member ? getStaticName(member.object) : null
    if (member && objectName && EVENT_TARGET_NAMES.has(objectName) && SOCKET_NAMES.has(member.property)) {
      report(node, 'connection')
    }
  }

  function enterFunction(node) {
    importTimeStack.push(inImportTimeContext() && isIifeFunction(node, sourceCode))
  }

  function exitFunction() {
    importTimeStack.pop()
  }

  return {
    ImportDeclaration: trackImportDeclaration,
    VariableDeclarator: trackRequireDeclaration,
    FunctionDeclaration: enterFunction,
    'FunctionDeclaration:exit': exitFunction,
    FunctionExpression: enterFunction,
    'FunctionExpression:exit': exitFunction,
    ArrowFunctionExpression: enterFunction,
    'ArrowFunctionExpression:exit': exitFunction,
    CallExpression: checkCallExpression,
    NewExpression: checkNewExpression,
    'VariableDeclarator:exit'(node) {
      if (!inImportTimeContext()) return
      if (node.id?.type === 'Identifier' && isEventEmitterNew(node.init)) {
        eventEmitterVariables.add(node.id.name)
      }
    },
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow plugin lifetime side effects during module import',
    },
    schema: [],
    messages: {
      topLevelLifetimeSideEffect:
        'Move this top-level {{kind}} into activate(ctx) and pair it with cleanup in onShutdown(ctx). Module-load lifetime side effects leak across plugin hot reloads.',
    },
  },
  create: createNoPluginTopLevelSideEffectsRule,
}

export default rule
