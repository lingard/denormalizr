'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isImmutable = isImmutable;
exports.getIn = getIn;
exports.setIn = setIn;

var _reduce = require('lodash/reduce');

var _reduce2 = _interopRequireDefault(_reduce);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Helpers to enable Immutable-JS compatibility.
 */

function stringifiedArray(array) {
  return array.map(function (item) {
    return item && item.toString();
  });
}

/**
 * To avoid including immutable-js as a dependency, check if an object is
 * immutable by checking if it implements the getIn method.
 *
 * @param  {Any} object
 * @return {Boolean}
 */
function isImmutable(object) {
  return object && !!object.getIn;
}

/**
 * If the object responds to getIn, that's called directly. Otherwise
 * recursively apply object/array access to get the value.
 *
 * @param  {Object, Immutable.Map, Immutable.Record} object
 * @param  {Array<string, number>} keyPath
 * @return {Any}
 */
function getIn(object, keyPath) {
  if (object.getIn) {
    return object.getIn(stringifiedArray(keyPath));
  }

  return (0, _reduce2.default)(keyPath, function (memo, key) {
    return memo[key];
  }, object);
}

/**
 * If the object responds to setIn, that's called directly. Otherwise
 * recursively apply object/array access and set the value at that location.
 *
 * @param  {Object, Immutable.Map, Immutable.Record} object
 * @param  {Array<string, number>} keyPath
 * @param  {Any} value
 * @return {Any}
 */
function setIn(object, keyPath, value) {
  if (object.setIn) {
    return object.setIn(stringifiedArray(keyPath), value);
  }

  var lastKey = keyPath.pop();
  var location = getIn(object, keyPath);

  location[lastKey] = value;

  return object;
}