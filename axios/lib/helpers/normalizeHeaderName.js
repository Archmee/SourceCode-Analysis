'use strict';

var utils = require('../utils');

/*
    标准化头部字段
    如果传入的headers里的 normalizedName 这个同名字段但大小写不统一，采用 normalizedName，删掉原字段
    比如，accept 和 Accept
*/
module.exports = function normalizeHeaderName(headers, normalizedName) {
  utils.forEach(headers, function processHeader(value, name) {
    if (name !== normalizedName && name.toUpperCase() === normalizedName.toUpperCase()) {
      headers[normalizedName] = value;
      delete headers[name];
    }
  });
};
