/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

const TEMPORARY_REFERENCE_TAG = Symbol.for('react.temporary.reference');

// eslint-disable-next-line no-unused-vars
export opaque type TemporaryReference<T> = {
  $$typeof: symbol,
  $$id: string,
};

export function isTemporaryReference(reference: Object): boolean {
  return reference.$$typeof === TEMPORARY_REFERENCE_TAG;
}

export function resolveTemporaryReferenceID<T>(
  temporaryReference: TemporaryReference<T>,
): string {
  return temporaryReference.$$id;
}

const proxyHandlers = {
  get: function (
    target: Function,
    name: string | symbol,
    receiver: Proxy<Function>,
  ) {
    switch (name) {
      // These names are read by the Flight runtime if you end up using the exports object.
      case '$$typeof':
        // These names are a little too common. We should probably have a way to
        // have the Flight runtime extract the inner target instead.
        return target.$$typeof;
      case '$$id':
        return target.$$id;
      case '$$async':
        return target.$$async;
      case 'name':
        return undefined;
      case 'displayName':
        return undefined;
      // We need to special case this because createElement reads it if we pass this
      // reference.
      case 'defaultProps':
        return undefined;
      // Avoid this attempting to be serialized.
      case 'toJSON':
        return undefined;
      case Symbol.toPrimitive:
        // $FlowFixMe[prop-missing]
        return Object.prototype[Symbol.toPrimitive];
      case Symbol.toStringTag:
        // $FlowFixMe[prop-missing]
        return Object.prototype[Symbol.toStringTag];
      case 'Provider':
        throw new Error(
          `Cannot render a Client Context Provider on the Server. ` +
            `Instead, you can export a Client Component wrapper ` +
            `that itself renders a Client Context Provider.`,
        );
    }
    throw new Error(
      // eslint-disable-next-line react-internal/safe-string-coercion
      `Cannot access ${String(name)} on the server. ` +
        'You cannot dot into a temporary client reference from a server component. ' +
        'You can only pass the value through to the client.',
    );
  },
  set: function () {
    throw new Error(
      'Cannot assign to a temporary client reference from a server module.',
    );
  },
};

export function createTemporaryReference<T>(id: string): TemporaryReference<T> {
  const reference: TemporaryReference<any> = Object.defineProperties(
    (function () {
      throw new Error(
        // eslint-disable-next-line react-internal/safe-string-coercion
        `Attempted to call a temporary Client Reference from the server but it is on the client. ` +
          `It's not possible to invoke a client function from the server, it can ` +
          `only be rendered as a Component or passed to props of a Client Component.`,
      );
    }: any),
    {
      $$typeof: {value: TEMPORARY_REFERENCE_TAG},
      $$id: {value: id},
    },
  );

  return new Proxy(reference, proxyHandlers);
}
