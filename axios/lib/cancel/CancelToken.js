'use strict';

var Cancel = require('./Cancel');

/**
 * A `CancelToken` is an object that can be used to request cancellation of an operation.
 *
 * @class
 * @param {Function} executor The executor function.
 */
function CancelToken(executor) {
  if (typeof executor !== 'function') {
    throw new TypeError('executor must be a function.');
  }

  var resolvePromise;
  this.promise = new Promise(function promiseExecutor(resolve) {
    // 把 resolve 函数赋值给了外部变量
    resolvePromise = resolve;
  });

  var token = this;
  // executor 已经是外面传入的函数，此处执行又传入了一个函数参数
  // 当cancel被调用时，resolvePromise被执行，接下来是this.promise.then接收
  executor(function cancel(message) {
    if (token.reason) {
      // Cancellation has already been requested
      return;
    }

    token.reason = new Cancel(message);
    resolvePromise(token.reason); // 发给promise.then
  });
}

/**
 * Throws a `Cancel` if cancellation has been requested.
 */
CancelToken.prototype.throwIfRequested = function throwIfRequested() {
  if (this.reason) {
    throw this.reason;
  }
};

/**
 * Returns an object that contains a new `CancelToken` and a function that, when called,
 * cancels the `CancelToken`.
 */


// source()调用后会返回一个对象 o，包括token和cancel
// o.cancel();调用会引起 CancelToken 函数中的 resolvePromise 触发

// 准备好接收promise.then
// o.token.promise.then(callback);

CancelToken.source = function source() {
  var cancel;
  // 创建 CancelToken 实例，传入一个函数，该函数会在 CancelToken 构造函数内部调用，并传入一个参数
  // executor 执行之后，cancel等于c的值
  var token = new CancelToken(function executor(c) {
    cancel = c;
  });

  return {
    token: token,
    cancel: cancel
  };
};

module.exports = CancelToken;
