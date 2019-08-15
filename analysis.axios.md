# axios 源码分析


axios 是一个基于基于 Promise 的网路请求库，可以用于浏览器和node服务器，虽然经常用，但是我并没有看过内部是怎么实现的。

在某天晚上心血来潮，花了一晚上时间读完了axios的源码，其实发现也没有想象中那么难。

在进入具体细节分析前，先预览一下我阅读源码之后绘制的运行依赖图，可以感受下整体结构

![axios运行依赖图](https://raw.githubusercontent.com/Archmee/lkd2d97zvb5fvz89feyhwr98v/master/gitblog/images/axios-structure-2019-08-13_172827.png)

图片中对于方向表达的不是很明确，简单点说就是上层模块依赖下层模块，而右边的模块主要是为左边的这些模块提供一些通用的工具和方法，比如类型判断等，所以下边的分析重点只会聚焦于左边这一块的内容。



> 
>
> 从 github 上下载的 axios 代码根目录下的`lib`目录就是 axios 的所有源代码
>
> 为了易于理解，我分析的时候调整了代码顺序，并且省略了部分代码，一些工具函数也都是见名知义 :smile:
>
> 



## 各个阶段

概括来说主要流程是这样的：

- 调用 createInstance 创建 Axios 实例
- Axios 实例中初始化了拦截器，Axios 的 request 方法被 createInstance 导出
- 用户发起请求，request 方法被调用，对拦截器做出响应，调用 dispatchRequest 
- dispatchRequest 会检查取消请求与否、转换数据 及调用网络请求库等，把数据返回给 request 



下面详细分析



###1. 导入 axios 



#### 1.1 导入配置对象

> defaults.js

导入配置对象，这个对象大概长这样，里面初始化了网络请求库、请求头信息等，该对象随后会在给各个模块间传递进行使用，

```js
defaults = {
  	// 根据 node 和 browser 的区别返回 http | xhr 的模块
    adapter: getDefaultAdapter(),

    // 数据转换，之所以把函数放进数组，是为了方便用户自定义转换函数
    // 这样axios就可以连续调用把数据在多个函数之间传递
    // 看了mergeConfig里面，好像是用户传入是会覆盖默认的
    transformRequest: [transformRequest], // 请求时调用，比如对象转为字符串
    transformResponse: [transformResponse], // 返回响应时调用，将字符串转为json
    
    timeout: 0, // 请求超时时间设置
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    maxContentLength: -1,
    validateStatus: function(){}, // 校验http状态码的函数
    
    headers = {
      common: {
        'Accept': 'application/json, text/plain, */*'
      },
    
      delete: {},
      get: {},
      head: {},
    
      put: { 'Content-Type': 'application/x-www-form-urlencoded' },
      post: { 'Content-Type': 'application/x-www-form-urlencoded' },
      patch: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
}
```



#### 1.2 创建实例

> 文件：axios.js

无论是默认初始化还是用户调用 axios.create，都需要调用 createInstance 。

这里传入了参数 defaults，通过 Axios 创建实例，返回 request 方法

```js

// 创建实例，传入默认配置，从Axios可知，axios.defaults = defaults
axios = createInstance(defaults)

// createInstance 方法
function createInstance(defaultConfig) {

  // 使用 core/Axios 创建实例
  var context = new Axios(defaultConfig);

  // 将 Axios 原型里的 request 方法的绑定到 context
  // 所以 instance 其实就是一个单独的 request 函数，但是绑定了 context
  var instance = bind(Axios.prototype.request, context);
  
  // 把 Axios.prototype 的方法和属性添加到到 instance 函数里面，并将其方法的 this 都绑定到 context
  utils.extend(instance, Axios.prototype, context);

  // 把 context 的方法和属性也添加到 instance 函数里面去
  utils.extend(instance, context);

  // 上面几步很绕，但总结起来就是：把Axios的原型对象和实例对象里的属性和方法都复制给instance函数，
  // 并且所有方法的 this 都被绑定到了context，变成了静态属性或方法
  // 后面可以直接调用 instance() 或者 instance.xxx()
  return instance;
}

// 暴露构造函数
axios.create = function create(instanceConfig) {
  // 将用户传入配置 和 默认配置合并，创建axios实例，但是用户传入的无效配置将不会得到处理
  return createInstance(mergeConfig(axios.defaults, instanceConfig));
};

// 取消请求相关的模块
axios.Cancel = require('./cancel/Cancel');
axios.CancelToken = require('./cancel/CancelToken');
axios.isCancel = require('./cancel/isCancel');

// 发送所有请求
axios.all = function all(promises) {
  return Promise.all(promises);
};

// spread(function(x, y) {})([1, 2]);
axios.spread = require('./helpers/spread');
```



#### 1.3 Axios 构造函数

> 文件：core/Axios.js

createInstance 创建了 Axios 实例，Axios里面创建了两个 interceptor 等待 request 被调用的时候使用。

而通过代码可以看出，request 处理分三个阶段：

1. 请求前的拦截，调用 request.interceptors，如果成功才执行下一步
2. 发出请求，调用网络请求模块
3. 收到响应后的拦截，调用 response.interceptors

```js
function Axios(instanceConfig) {

  this.defaults = instanceConfig;

  // 分别给 request和response 创建了 interceptorMnager
  // 我们在外面就可以调用 axios.interceptors.request.use 等方法
  this.interceptors = {
    request: new InterceptorManager(),
    response: new InterceptorManager()
  };
}

// 这个 request 就是整个 axios 最终导出的函数，目前还不会运行
Axios.prototype.request = function request(config) {

  // 如果调用该方法之前没添加拦截器的话，dispatchRequest 会直接发请求
  var chain = [dispatchRequest, undefined];

  // 在chain头插入 request 的 interceptors
  // request 是一个interceptor对象，forEach方法是该对象自己的
  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
    chain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  // 在chain尾插入 response 的 interceptors
  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
    chain.push(interceptor.fulfilled, interceptor.rejected);
  });

  // 从chain头部顺序弹出fulfilled和rejected作为then函数的resolve和reject
  // 如果剩下 [dispatchRequest, undefined]
  // 则类似这样，promise.then(dispatchRequest, undefined)
  // 实际上在dispatchRequest左边的调用都是在请求前的，即request阶段
  // 如果request阶段的interceptor没问题就会得到这样的调用dispatchRequest(config)
  // 而 dispatchRequest 是真正发出了请求
  // dispatchRequest 后边的都是接收到响应后的，即response阶段
  // 通过分析在chain插入interceptor的顺序就可以分析出

  var promise = Promise.resolve(config); // 将config对象传给then
  while (chain.length) {
    promise = promise.then(chain.shift(), chain.shift());
  }
  return promise;

};

// 为支持的请求方法提供别名比如get/post
// 这里实现了我们在使用的时候通过 axios.get() 这种方法的调用
// 但是如你所见，这只是一个别名而已，最终还是要调用 request 方法

utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
  Axios.prototype[method] = function(url, config) {
    return this.request(utils.merge(config || {}, {
      method: method,
      url: url
    }));
  };
});

utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  Axios.prototype[method] = function(url, data, config) {
    return this.request(utils.merge(config || {}, {
      method: method,
      url: url,
      data: data, // post 的数据就是从这里传入的
    }));
  };
});

```



#### 1.4 InterceptorManager 

> 文件：core/InterceptorManager.js

在Axios构造函数中创建了 InterceptorManager 实例，use 添加拦截器，eject 移除拦截器

```js
// Interceptor 构造器
function InterceptorManager() {
  this.handlers = [];
}

// 添加interceptor
// 这个方法使得我们可以在外调用 axios.interceptors.request.use(resolve, reject)
InterceptorManager.prototype.use = function use(fulfilled, rejected) {
  this.handlers.push({
    fulfilled: fulfilled,
    rejected: rejected
  });
  return this.handlers.length - 1;
};

// 移除interceptor
InterceptorManager.prototype.eject = function eject(id) {
  if (this.handlers[id]) {
    this.handlers[id] = null;
  }
};

// 该方法遍历handlers，将handler作为参数传给外面的回调fn来执行
// Axios.prototype.request 里面有用到这个方法
InterceptorManager.prototype.forEach = function forEach(fn) {
  utils.forEach(this.handlers, function forEachHandler(h) {
    if (h !== null) {
      fn(h);
    }
  });
};
```



### 2. axios 请求

> 文件：core/dispatchRequest.js

axios 真正发出请求都会调用 request 方法，request 处理分三个阶段，请求前拦截=>请求=>响应后拦截，而请求是 dispatchRequest 调用网络请求模块发出，dispatch分为 5 个阶段：

1. 请求前检查请求是否被取消
2. 请求前转换数据（可配置的 transformRequest）
3. 调用网络请求模块发出请求
4. 收到响应后检查请求是否被取消
5. 收到响应后转换数据（可配置的 transformResponse）

```js
function dispatchRequest(config) {
  //1 请求前检查请求是否被取消
  throwIfCancellationRequested(config);
  
  // 2 请求前转换数据，调用transformRequest
  config.data = transformData(
    config.data,
    config.headers,
    config.transformRequest
  );

  // 引入adapter，xhr 或者 http
  var adapter = config.adapter || defaults.adapter;

  // 3 发出请求
  return adapter(config).then(function(response) {

    // 4 收到响应后检查请求是否被取消
    throwIfCancellationRequested(config);
    
    // 5 返回响应后调用 transformResponse 处理
    response.data = transformData(
      response.data,
      response.headers,
      config.transformResponse
    );
    
    // 返回响应给 request 方法
    return response;
    
  }, function(reason) {

    // 返回自定义的json错误信息，也要经过 transformResponse
    return Promise.reject(reason);
    
  });
}
```



### 3. xhr adapter

> 文件：adapters/xhr.js

axios 的网络请求库是 xhr 和 http，由于大部分时间我都工作在浏览器端，所以我只对 xhr 进行分析。

在我删除了一些非核心代码后，它神秘的外衣渐渐褪去，就是用 Promise 包装浏览器的 XMLHttpRequest 而已

```js
// 适配器

function xhrAdapter(config) {

  return new Promise(function(resolve, reject) {

    // 创建xhr
    var request = new XMLHttpRequest();
    
    // 设置超时ms
    request.timeout = config.timeout;
    
    request.onreadystatechange = function() {
      // 根据返回的 status 判断 resolve 或 reject
    };
    request.onabort = function() {};
    request.onerror = function() {};
    request.ontimeout = function() {};
    
    // 设置传入的请求头，如果有必要，添加xsrf头
    request.setRequestHeader(key, val);
    
    // 是否发送cookie
    request.withCredentials = request.withCredentials ? true : false;
    
    // 打开连接，发送请求
    request.open(method, url, true);
    request.send(requestData);
    
 });
```



## 取消请求

> 文件：cancel/CancelToken.js

由于取消请求需要调用者主动发起，所以它并不算我们主要请求阶段，所以单独拿出来聊聊

cancelToken 是一个用于取消请求的模块，我很少用，尝试过感觉难用，不光是接口难用，我看了下源码，CancelToken 构造函数和  CancelToken.source 的实现也有点难理解，不过多看几遍就明白了，我精简了下：

```js
function CancelToken(executor) {
  
  // promise 执行器，也就是通过下面调用后，resolvePromise 可以激发 then 的调用
  var resolvePromise;
  this.promise = new Promise(function promiseExecutor(resolve) {
    resolvePromise = resolve;
  });

  var token = this;
  
  // 当cancel被调用时，reason有了，resolvePromise被执行，等待被catch接收
  executor(function cancel(message) {
    if (token.reason) { // 如果cancel已经被调用过了，就不能重复调用了
      return;
    }

    token.reason = new Cancel(message);
    resolvePromise(token.reason); // 发给promise.then
  });
}

// 可以先忽略这里
CancelToken.source = function source() {
  var cancel;
  
  // 创建 CancelToken 实例，传入一个函数，该函数会在 CancelToken 构造函数内部传回cancel
  var token = new CancelToken(function executor(c) {
    cancel = c;
  });

  return {
    token: token,
    cancel: cancel
  };
};
```



are u Crying？？？

i m not！！！



CancelToken 其实做了一件事，即接收一个函数，并给了你一个接受 cancel 函数的机会，你如果调用这个 cancel 函数，就会设置 token.reason 同时触发 resolvePromise 

不知道你是否还记得 dispatchRequest 的 5 个阶段，请求前和响应后都会检查请求是否被取消，而正是通过下面这个 throwIfCancellationRequested 方法

```js
// dispatchRequest.js

// 检查用户请求时传入的参数是否有cancelToken，这是用户在发送请求时设置的一个CancelToken实例
// 如果有，则说明用户有取消的潜在需求，然后调用 cancelToken.throwIfRequested 
function throwIfCancellationRequested(config) {
  if (config.cancelToken) {
    config.cancelToken.throwIfRequested();
  }
}

// CancelToken.js

// 判断 reason 是否存在？
// 不存在，说明 cancel 没有执行过，则放你一马
// 存在，说明 cancel 被执行了，则报警，必须立刻马上取消请求
CancelToken.prototype.throwIfRequested = function throwIfRequested() {
  if (this.reason) {
    throw this.reason;
  }
};
```

注意，throwIfRequested 是在 dispatchRequest 中被执行的，而 dispatchRequest  是在 Axios.Prototype.request （所有请求的方法都会经过request）方法中被 `promise = promise.then(dispatchRequest)` 执行的，而这个promise最终会带着错误被返回给调用者，必然会被调用者的 catch() 捕获到

再来看一下用法，则更能容易理解了，这个CancelToken的 2 个要素： token 和 cancel 函数

```js
var cancel;

// 第一要素，请求时要获取一个cancelToken，并且同时要拿到cancel函数
axios.get('/api', {
  cancelToken: new CancelToken(function(c){
    cancel = c
  })
});

// 第二，任何时候，你都可以调用cancel取消请求
cancel()
```



至于 CancelToken.source， 只是把这个过程封装了一下而已



## 其他

还有几个地方提一下，感兴趣的同学自己看代码

1. createInstance 函数里面

   createInstance 返回后的实例 并没有被返回，而是返回了`axios = Axios.prototype.request`，我知道这样做的好处是可以直接`axios()`这样调用，也可以调用静态方法`axios.get()`，可使除此之外呢？

2. interceptor 在 request 方法中的链式调用

   代码很简单，又觉得妙，这个 chain 大概长这个样子`[resolve, reject, dispatchRequest, undefined, resolve, reject]`，然后不断的 `promise = promise.then(resolve, reject)`

3. 一个类似于bind的函数，觉得还不错

   ```js
   function spread(callback) {
     return function wrap(arr) {
       return callback.apply(null, arr);
     };
   };
   // spread(function(x, y, z) {})([1, 2, 3]);
   ```

4. 了解到一个新接口 URLSearchParams，见名知义，用法如下

   ```js
   var params = new URLSearchParams();
   params.append('id', '123')
   params.append('name', 'haaa')
   params.toString() // id=123&name=haaa
   ```

   ​

## 总结

总体来说 axios 运行分三个阶段：

1. 导入 axios 模块
   1. 导入 defaults 配置对象
   2. 调用 createInstance 创建一个 Axios 实例 instance，创建Axios实例的时候分别为请求和响应创建了interceptor，然后返回 Axios.Prototype.request 函数，不过这个函数复制了 Axios.Prototype 和 instance 上的所有属性和方法，方法的 this 都被绑定了 instance
   3. 这个 request 是一个核心函数，最后导出的 axios 就是这个函数（函数对象也是对象），axios.create 得到的也是一个request方法、axios.get、post、delete 这些外部可见的请求方法都是调用 request 方法
2. 配置 interceptor
   1. 当我们在正式请求之前会配置 axios 的拦截器，也就是调用 axios.request.interceptor.use 和 axios.response.interceptor.use 的时候，内部的 interceptorManager 会为每一个 axios 实例维护一个request 拦截列表 和 response 拦截列表，多次调用 use 可以配置多个拦截器
   2. interceptor 不但可以用 use 添加拦截器，也可以用 eject 移除拦截器
3. 调用 axios 方法
   1. 发出请求之前，request 会按照 use 调用的顺序处理所有的 request.interceptor，如果成功，则发出请求，否则中断请求
   2. 调用 dispatchRequest 模块
      1. 检查请求是否被用户取消，取消则中断处理
      2. 处理一些头信息并调用 transformRequest 转换数据
      3. 然后调用网络请求模块发出请求，数据返回
      4. 检查请求是否被用户取消，取消则中断处理
      5. 调用 transformResponse 转换数据，最后返回数据
   3. 收到结果之后，request 会按照 use 调用的顺序处理所有的 response.interceptor，分别对成功和失败做出处理





sofa !

