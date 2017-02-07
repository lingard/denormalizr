import { schema as Schema } from 'normalizr';
import merge from 'lodash/merge';
import isObject from 'lodash/isObject';
import assign from 'lodash/assign';
import { isImmutable, getIn, setIn } from './ImmutableUtils';

const EntitySchema = Schema.Entity;
const ArraySchema = Schema.Array;
const UnionSchema = Schema.Union;
const ValuesSchema = Schema.Values;

/**
 * Take either an entity or id and derive the other.
 *
 * @param   {object|Immutable.Map|number|string} entityOrId
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @returns {object}
 */
function resolveEntityOrId(entityOrId, entities, schema) {
  const key = schema.key;

  let entity = entityOrId;
  let id = entityOrId;

  if (isObject(entityOrId)) {
    const mutableEntity = isImmutable(entity) ? entity.toJS() : entity;
    id = schema.getId(mutableEntity) || getIn(entity, ['id']);
    entity = getIn(entities, [key, id]);
  } else {
    entity = getIn(entities, [key, id]);
  }

  return { entity, id };
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
  const isMappable = typeof items.map === 'function';

  const itemSchema = Array.isArray(schema) ? schema[0] : schema.schema;

  // Handle arrayOf iterables
  if (isMappable) {
    return items.map(o => denormalize(o, entities, itemSchema, bag));
  }

  // Handle valuesOf iterables
  const denormalized = {};
  Object.keys(items).forEach((key) => {
    denormalized[key] = denormalize(items[key], entities, itemSchema, bag);
  });
  return denormalized;
}

/*
 * Memoized version of `denormalizeIterable`.
 */
function denormalizeIterableMemoized(items, entities, schema, bag) {
  const itemSchema = Array.isArray(schema) ? schema[0] : schema.schema;

  let isDifferent = false;
  const newItems = items.map((o, i) => {
    const newItem = denormalizeMemoized(o, entities, itemSchema, bag);

    if (newItem !== items[i]) {
      isDifferent = true;
    }

    return newItem;
  });

  return isDifferent ? newItems : items;
}

/**
 * @param   {object|Immutable.Map|number|string} entity
 * @param   {object|Immutable.Map} entities
 * @param   {schema.Entity} schema
 * @param   {object} bag
 * @returns {object|Immutable.Map}
 */
function denormalizeUnion(entity, entities, schema, bag) {
  const schemaAttribute = getIn(entity, ['schema']);
  const itemSchema = getIn(schema, ['schema', schemaAttribute]);
  if (!itemSchema) return entity;

  const mutableEntity = isImmutable(entity) ? entity.toJS() : entity;
  const id = itemSchema.getId(mutableEntity) || getIn(entity, ['id']);

  return denormalize(
    id,
    entities,
    itemSchema,
    bag,
  );
}

/*
 * Memoized version of `denormalizeUnion`.
 */
function denormalizeUnionMemoized(entity, entities, unionSchema, bag) {
  if (!entity.schema) {
    throw new Error('Expect `entity` to have a schema key as a result from normalizing an union.');
  }

  const schemaAttribute = getIn(entity, ['schema']);
  const itemSchema = getIn(schema, ['schema', schemaAttribute]);

  const id = itemSchema.getId(mutableEntity) || getIn(entity, ['id']);

  // const id = getIn(entity, [itemSchema.getIdAttribute()]);
  const trueEntity = getIn(entities, [itemSchema.key, id]);

  return denormalizeMemoized(
    trueEntity,
    entities,
    itemSchema,
    bag,
  );
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
  let denormalized = obj;

  const schemaDefinition = typeof schema.inferSchema === 'function'
    ? schema.inferSchema(obj)
    : (schema.schema || schema)
  ;

  Object.keys(schemaDefinition)
    // .filter(attribute => attribute.substring(0, 1) !== '_')
    .filter(attribute => typeof getIn(obj, [attribute]) !== 'undefined')
    .forEach((attribute) => {
      const item = getIn(obj, [attribute]);
      const itemSchema = getIn(schemaDefinition, [attribute]);

      denormalized = setIn(denormalized, [attribute], denormalize(item, entities, itemSchema, bag));
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
  const key = schema.key;
  const { entity, id } = resolveEntityOrId(entityOrId, entities, schema);

  if (!bag.hasOwnProperty(key)) {
    bag[key] = {};
  }

  if (!bag[key].hasOwnProperty(id)) {
    // Ensure we don't mutate it non-immutable objects
    const obj = isImmutable(entity) ? entity : merge({}, entity);

    // Need to set this first so that if it is referenced within the call to
    // denormalizeObject, it will already exist.
    bag[key][id] = obj;
    bag[key][id] = denormalizeObject(obj, entities, schema, bag);
  }

  return bag[key][id];
}

export const cache = {};

function denormalizeEntityMemoized(entityOrId, entities, schema, bag) {
  const key = schema.key
  const { entity, id } = resolveEntityOrId(entityOrId, entities, schema);

  const schemaDefinition = typeof schema.inferSchema === 'function'
    ? schema.inferSchema(obj)
    : (schema.schema || schema);

  if (!entity) {
    return null;
  }

  /* Cache */
  if (!cache[key]) {
    cache[key] = {};
  }
  if (!cache[key][id]) {
    cache[key][id] = {
      entity,
      denormalized: entity,
    };
  }
  /* Cache *****/

  if (!bag.hasOwnProperty(`${key}:${id}`)) {
    bag[`${key}:${id}`] = true;

    /* If cache entity is different, wipe cache */
    if (cache[key][id].entity !== entity) {
      cache[key][id].entity = entity;
      cache[key][id].denormalized = entity;
    }

    /* Start with the cache as reference */
    const referenceObject = cache[key][id].denormalized;
    const relationsToUpdate = {};

    /* For each relation in EntitySchema */
    Object.keys(schemaDefinition)
      /* Filter out private attributes */
      .filter(attribute => attribute.substring(0, 1) !== '_')
      /* Filter out relations not present */
      .filter(attribute => typeof getIn(referenceObject, [attribute]) !== 'undefined')
      .forEach((relation) => {
        const item = getIn(referenceObject, [relation]);
        const itemSchema = getIn(schemaDefinition, [relation]);

        const denormalizedItem = denormalizeMemoized(item, entities, itemSchema, bag);

        if (denormalizedItem !== item) {
          relationsToUpdate[relation] = denormalizedItem;
        }
      });

    /* If there is any relations to update, we send a new object */
    let returnObject = referenceObject;
    if (Object.keys(relationsToUpdate).length > 0) {
      returnObject = assign({}, returnObject, relationsToUpdate);
    }

    /* We update the cache */
    cache[key][id].denormalized = returnObject;

    delete bag[`${key}:${id}`];

    return returnObject;
  }

  return id;
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
function denormalize(obj, entities, schema, bag = {}) {
  if (obj === null || typeof obj === 'undefined' || !isObject(schema)) {
    return obj;
  }

  if (schema instanceof EntitySchema) {
    return denormalizeEntity(obj, entities, schema, bag);
  } else if (
    schema instanceof ValuesSchema ||
    schema instanceof ArraySchema ||
    Array.isArray(schema)
  ) {
    return denormalizeIterable(obj, entities, schema, bag);
  } else if (schema instanceof UnionSchema) {
    return denormalizeUnion(obj, entities, schema, bag);
  }

  // Ensure we don't mutate it non-immutable objects
  const entity = isImmutable(obj) ? obj : merge({}, obj);
  return denormalizeObject(entity, entities, schema, bag);
}

/**
 * Memoized version of `denormalize`.
 *
 * `denormalizeMemoized` will return values of previous denormalizations
 * if nothing changed in the concerned entities.
 *
 * The key goal is to be able to provide a quick way to determine
 * if an entity or its relations changed by using a shallow equality.
 * This is a performance optimization.
 *
 * For example, this would be used on Connected Components in a Redux App.
 * Connected Components use shallow comparison on their props to know if they
 * need to be re-renderer or not.
 *
 * Without memoization, Components will trigger a re-render everytime
 * the store changes ; because `denormalize` returns a new object everytime.
 * With memoization, a new object will be returned only if the underlying entity
 * and/or its underlying relations have changed.
 */
function denormalizeMemoized(obj, entities, schema, bag = {}) {
  if (obj === null || typeof obj === 'undefined' || !isObject(schema)) {
    return obj;
  }

  if (schema instanceof EntitySchema) {
    return denormalizeEntityMemoized(obj, entities, schema, bag);
  } else if (
    schema instanceof ValuesSchema ||
    schema instanceof ArraySchema ||
    Array.isArray(schema)
  ) {
    return denormalizeIterableMemoized(obj, entities, schema, bag);
  } else if (schema instanceof UnionSchema) {
    return denormalizeUnionMemoized(obj, entities, schema, bag);
  }

  // return obj;
}

// eslint-disable-next-line no-undef,func-names
module.exports.denormalize = function (obj, entities, schema, options = {}) {
  if (options.memoized) {
    return denormalizeMemoized(obj, entities, schema, {});
  }

  return denormalize(obj, entities, schema, {});
};
