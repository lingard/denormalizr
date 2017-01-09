'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.denormalize = denormalize;

var _normalizr = require('normalizr');

var _merge = require('lodash/merge');

var _merge2 = _interopRequireDefault(_merge);

var _isObject = require('lodash/isObject');

var _isObject2 = _interopRequireDefault(_isObject);

var _ImmutableUtils = require('./ImmutableUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var EntitySchema = _normalizr.schema.Entity;
var ArraySchema = _normalizr.schema.Array;
var UnionSchema = _normalizr.schema.Union;
var ValuesSchema = _normalizr.schema.Values;

/**
 * Take either an entity or id and derive the other.
 *
 * @param   {object|Immutable.Map|number|string} entityOrId
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @returns {object}
 */
function resolveEntityOrId(entityOrId, entities, schema) {
  var key = schema.key;

  var entity = entityOrId;
  var id = entityOrId;

  if ((0, _isObject2.default)(entityOrId)) {
    var mutableEntity = (0, _ImmutableUtils.isImmutable)(entity) ? entity.toJS() : entity;
    id = schema.getId(mutableEntity) || (0, _ImmutableUtils.getIn)(entity, ['id']);
  } else {
    entity = (0, _ImmutableUtils.getIn)(entities, [key, id]);
  }

  return { entity: entity, id: id };
}

/**
 * Denormalizes each entity in the given array.
 *
 * @param   {Array|Immutable.List} items
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {Array|Immutable.List}
 */
function denormalizeIterable(items, entities, schema, bag) {
  var isMappable = typeof items.map === 'function';

  var itemSchema = Array.isArray(schema) ? schema[0] : schema.schema;

  // Handle arrayOf iterables
  if (isMappable) {
    return items.map(function (o) {
      return denormalize(o, entities, itemSchema, bag);
    });
  }

  // Handle valuesOf iterables
  var denormalized = {};
  Object.keys(items).forEach(function (key) {
    denormalized[key] = denormalize(items[key], entities, itemSchema, bag);
  });
  return denormalized;
}

/**
 * @param   {object|Immutable.Map|number|string} entity
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {object|Immutable.Map}
 */
function denormalizeUnion(entity, entities, schema, bag) {
  var schemaAttribute = (0, _ImmutableUtils.getIn)(entity, ['schema']);
  var itemSchema = (0, _ImmutableUtils.getIn)(schema, ['schema', schemaAttribute]);
  if (!itemSchema) return entity;

  var mutableEntity = (0, _ImmutableUtils.isImmutable)(entity) ? entity.toJS() : entity;
  var id = itemSchema.getId(mutableEntity) || (0, _ImmutableUtils.getIn)(entity, ['id']);

  return denormalize(id, entities, itemSchema, bag);
}

/**
 * Takes an object and denormalizes it.
 *
 * Note: For non-immutable objects, this will mutate the object. This is
 * necessary for handling circular dependencies. In order to not mutate the
 * original object, the caller should copy the object before passing it here.
 *
 * @param   {object|Immutable.Map} obj
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {object|Immutable.Map}
 */
function denormalizeObject(obj, entities, schema, bag) {
  var denormalized = obj;

  var schemaDefinition = typeof schema.inferSchema === 'function' ? schema.inferSchema(obj) : schema.schema || schema;

  Object.keys(schemaDefinition)
  // .filter(attribute => attribute.substring(0, 1) !== '_')
  .filter(function (attribute) {
    return typeof (0, _ImmutableUtils.getIn)(obj, [attribute]) !== 'undefined';
  }).forEach(function (attribute) {
    var item = (0, _ImmutableUtils.getIn)(obj, [attribute]);
    var itemSchema = (0, _ImmutableUtils.getIn)(schemaDefinition, [attribute]);

    denormalized = (0, _ImmutableUtils.setIn)(denormalized, [attribute], denormalize(item, entities, itemSchema, bag));
  });

  return denormalized;
}

/**
 * Takes an entity, saves a reference to it in the 'bag' and then denormalizes
 * it. Saving the reference is necessary for circular dependencies.
 *
 * @param   {object|Immutable.Map|number|string} entityOrId
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {object|Immutable.Map}
 */
function denormalizeEntity(entityOrId, entities, schema, bag) {
  var key = schema.key;

  var _resolveEntityOrId = resolveEntityOrId(entityOrId, entities, schema),
      entity = _resolveEntityOrId.entity,
      id = _resolveEntityOrId.id;

  if (!bag.hasOwnProperty(key)) {
    bag[key] = {};
  }

  if (!bag[key].hasOwnProperty(id)) {
    // Ensure we don't mutate it non-immutable objects
    var obj = (0, _ImmutableUtils.isImmutable)(entity) ? entity : (0, _merge2.default)({}, entity);

    // Need to set this first so that if it is referenced within the call to
    // denormalizeObject, it will already exist.
    bag[key][id] = obj;
    bag[key][id] = denormalizeObject(obj, entities, schema, bag);
  }

  return bag[key][id];
}

/**
 * Takes an object, array, or id and returns a denormalized copy of it. For
 * an object or array, the same data type is returned. For an id, an object
 * will be returned.
 *
 * If the passed object is null or undefined or if no schema is provided, the
 * passed object will be returned.
 *
 * @param   {object|Immutable.Map|array|Immutable.list|number|string} obj
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {object|Immutable.Map|array|Immutable.list}
 */
function denormalize(obj, entities, schema) {
  var bag = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

  if (obj === null || typeof obj === 'undefined' || !(0, _isObject2.default)(schema)) {
    return obj;
  }

  if (schema instanceof EntitySchema) {
    return denormalizeEntity(obj, entities, schema, bag);
  } else if (schema instanceof ValuesSchema || schema instanceof ArraySchema || Array.isArray(schema)) {
    return denormalizeIterable(obj, entities, schema, bag);
  } else if (schema instanceof UnionSchema) {
    return denormalizeUnion(obj, entities, schema, bag);
  }

  // Ensure we don't mutate it non-immutable objects
  var entity = (0, _ImmutableUtils.isImmutable)(obj) ? obj : (0, _merge2.default)({}, obj);
  return denormalizeObject(entity, entities, schema, bag);
}