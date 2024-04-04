/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Chunk, BinaryChunk, Destination} from './ReactServerStreamConfig';

import type {Postpone} from 'react/src/ReactPostpone';

import {
  enableBinaryFlight,
  enablePostpone,
  enableTaint,
  enableServerComponentKeys,
  enableRefAsProp,
  enableServerComponentLogs,
} from 'shared/ReactFeatureFlags';

import {
  scheduleWork,
  flushBuffered,
  beginWriting,
  writeChunkAndReturn,
  stringToChunk,
  typedArrayToBinaryChunk,
  byteLengthOfChunk,
  byteLengthOfBinaryChunk,
  completeWriting,
  close,
  closeWithError,
} from './ReactServerStreamConfig';

export type {Destination, Chunk} from './ReactServerStreamConfig';

import type {
  ClientManifest,
  ClientReferenceMetadata,
  ClientReference,
  ClientReferenceKey,
  ServerReference,
  ServerReferenceId,
  Hints,
  HintCode,
  HintModel,
} from './ReactFlightServerConfig';
import type {ThenableState} from './ReactFlightThenable';
import type {
  Wakeable,
  Thenable,
  PendingThenable,
  FulfilledThenable,
  RejectedThenable,
  ReactDebugInfo,
  ReactComponentInfo,
  ReactAsyncInfo,
} from 'shared/ReactTypes';
import type {LazyComponent} from 'react/src/ReactLazy';
import type {TemporaryReference} from './ReactFlightServerTemporaryReferences';

import {
  resolveClientReferenceMetadata,
  getServerReferenceId,
  getServerReferenceBoundArguments,
  getClientReferenceKey,
  isClientReference,
  isServerReference,
  supportsRequestStorage,
  requestStorage,
  createHints,
  initAsyncDebugInfo,
} from './ReactFlightServerConfig';

import {
  isTemporaryReference,
  resolveTemporaryReferenceID,
} from './ReactFlightServerTemporaryReferences';

import {
  HooksDispatcher,
  prepareToUseHooksForRequest,
  prepareToUseHooksForComponent,
  getThenableStateAfterSuspending,
  resetHooksForRequest,
} from './ReactFlightHooks';
import {DefaultCacheDispatcher} from './flight/ReactFlightServerCache';

import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_MEMO_TYPE,
  REACT_POSTPONE_TYPE,
} from 'shared/ReactSymbols';

import {
  describeValueForErrorMessage,
  describeObjectForErrorMessage,
  isSimpleObject,
  jsxPropsParents,
  jsxChildrenParents,
  objectName,
} from 'shared/ReactSerializationErrors';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import ReactServerSharedInternals from './ReactServerSharedInternals';
import isArray from 'shared/isArray';
import getPrototypeOf from 'shared/getPrototypeOf';
import binaryToComparableString from 'shared/binaryToComparableString';

import {SuspenseException, getSuspendedThenable} from './ReactFlightThenable';

initAsyncDebugInfo();

function patchConsole(consoleInst: typeof console, methodName: string) {
  const descriptor = Object.getOwnPropertyDescriptor(consoleInst, methodName);
  if (
    descriptor &&
    (descriptor.configurable || descriptor.writable) &&
    typeof descriptor.value === 'function'
  ) {
    const originalMethod = descriptor.value;
    const originalName = Object.getOwnPropertyDescriptor(
      // $FlowFixMe[incompatible-call]: We should be able to get descriptors from any function.
      originalMethod,
      'name',
    );
    const wrapperMethod = function (this: typeof console) {
      const request = resolveRequest();
      if (methodName === 'assert' && arguments[0]) {
        // assert doesn't emit anything unless first argument is falsy so we can skip it.
      } else if (request !== null) {
        // Extract the stack. Not all console logs print the full stack but they have at
        // least the line it was called from. We could optimize transfer by keeping just
        // one stack frame but keeping it simple for now and include all frames.
        let stack = new Error().stack;
        if (stack.startsWith('Error: \n')) {
          stack = stack.slice(8);
        }
        const firstLine = stack.indexOf('\n');
        if (firstLine === -1) {
          stack = '';
        } else {
          // Skip the console wrapper itself.
          stack = stack.slice(firstLine + 1);
        }
        request.pendingChunks++;
        // We don't currently use this id for anything but we emit it so that we can later
        // refer to previous logs in debug info to associate them with a component.
        const id = request.nextChunkId++;
        emitConsoleChunk(request, id, methodName, stack, arguments);
      }
      // $FlowFixMe[prop-missing]
      return originalMethod.apply(this, arguments);
    };
    if (originalName) {
      Object.defineProperty(
        wrapperMethod,
        // $FlowFixMe[cannot-write] yes it is
        'name',
        originalName,
      );
    }
    Object.defineProperty(consoleInst, methodName, {
      value: wrapperMethod,
    });
  }
}

if (
  enableServerComponentLogs &&
  __DEV__ &&
  typeof console === 'object' &&
  console !== null
) {
  // Instrument console to capture logs for replaying on the client.
  patchConsole(console, 'assert');
  patchConsole(console, 'debug');
  patchConsole(console, 'dir');
  patchConsole(console, 'dirxml');
  patchConsole(console, 'error');
  patchConsole(console, 'group');
  patchConsole(console, 'groupCollapsed');
  patchConsole(console, 'groupEnd');
  patchConsole(console, 'info');
  patchConsole(console, 'log');
  patchConsole(console, 'table');
  patchConsole(console, 'trace');
  patchConsole(console, 'warn');
}

const ObjectPrototype = Object.prototype;

type JSONValue =
  | string
  | boolean
  | number
  | null
  | {+[key: string]: JSONValue}
  | $ReadOnlyArray<JSONValue>;

const stringify = JSON.stringify;

type ReactJSONValue =
  | string
  | boolean
  | number
  | null
  | $ReadOnlyArray<ReactClientValue>
  | ReactClientObject;

// Serializable values
export type ReactClientValue =
  // Server Elements and Lazy Components are unwrapped on the Server
  | React$Element<React$AbstractComponent<any, any>>
  | LazyComponent<ReactClientValue, any>
  // References are passed by their value
  | ClientReference<any>
  | ServerReference<any>
  // The rest are passed as is. Sub-types can be passed in but lose their
  // subtype, so the receiver can only accept once of these.
  | React$Element<string>
  | React$Element<ClientReference<any> & any>
  | string
  | boolean
  | number
  | symbol
  | null
  | void
  | bigint
  | Iterable<ReactClientValue>
  | Array<ReactClientValue>
  | Map<ReactClientValue, ReactClientValue>
  | Set<ReactClientValue>
  | Date
  | ReactClientObject
  | Promise<ReactClientValue>; // Thenable<ReactClientValue>

type ReactClientObject = {+[key: string]: ReactClientValue};

const PENDING = 0;
const COMPLETED = 1;
const ABORTED = 3;
const ERRORED = 4;

type Task = {
  id: number,
  status: 0 | 1 | 3 | 4,
  model: ReactClientValue,
  ping: () => void,
  toJSON: (key: string, value: ReactClientValue) => ReactJSONValue,
  keyPath: null | string, // parent server component keys
  implicitSlot: boolean, // true if the root server component of this sequence had a null key
  thenableState: ThenableState | null,
};

interface Reference {}

export type Request = {
  status: 0 | 1 | 2,
  flushScheduled: boolean,
  fatalError: mixed,
  destination: null | Destination,
  bundlerConfig: ClientManifest,
  cache: Map<Function, mixed>,
  nextChunkId: number,
  pendingChunks: number,
  hints: Hints,
  abortableTasks: Set<Task>,
  pingedTasks: Array<Task>,
  completedImportChunks: Array<Chunk>,
  completedHintChunks: Array<Chunk>,
  completedRegularChunks: Array<Chunk | BinaryChunk>,
  completedErrorChunks: Array<Chunk>,
  writtenSymbols: Map<symbol, number>,
  writtenClientReferences: Map<ClientReferenceKey, number>,
  writtenServerReferences: Map<ServerReference<any>, number>,
  writtenObjects: WeakMap<Reference, number>, // -1 means "seen" but not outlined.
  identifierPrefix: string,
  identifierCount: number,
  taintCleanupQueue: Array<string | bigint>,
  onError: (error: mixed) => ?string,
  onPostpone: (reason: string) => void,
  // DEV-only
  environmentName: string,
};

const {
  TaintRegistryObjects,
  TaintRegistryValues,
  TaintRegistryByteLengths,
  TaintRegistryPendingRequests,
  ReactCurrentCache,
} = ReactServerSharedInternals;
const ReactCurrentDispatcher = ReactSharedInternals.ReactCurrentDispatcher;

function throwTaintViolation(message: string) {
  // eslint-disable-next-line react-internal/prod-error-codes
  throw new Error(message);
}

function cleanupTaintQueue(request: Request): void {
  const cleanupQueue = request.taintCleanupQueue;
  TaintRegistryPendingRequests.delete(cleanupQueue);
  for (let i = 0; i < cleanupQueue.length; i++) {
    const entryValue = cleanupQueue[i];
    const entry = TaintRegistryValues.get(entryValue);
    if (entry !== undefined) {
      if (entry.count === 1) {
        TaintRegistryValues.delete(entryValue);
      } else {
        entry.count--;
      }
    }
  }
  cleanupQueue.length = 0;
}

function defaultErrorHandler(error: mixed) {
  console['error'](error);
  // Don't transform to our wrapper
}

function defaultPostponeHandler(reason: string) {
  // Noop
}

const OPEN = 0;
const CLOSING = 1;
const CLOSED = 2;

export function createRequest(
  model: ReactClientValue,
  bundlerConfig: ClientManifest,
  onError: void | ((error: mixed) => ?string),
  identifierPrefix?: string,
  onPostpone: void | ((reason: string) => void),
  environmentName: void | string,
): Request {
  if (
    ReactCurrentCache.current !== null &&
    ReactCurrentCache.current !== DefaultCacheDispatcher
  ) {
    throw new Error(
      'Currently React only supports one RSC renderer at a time.',
    );
  }
  ReactCurrentCache.current = DefaultCacheDispatcher;

  const abortSet: Set<Task> = new Set();
  const pingedTasks: Array<Task> = [];
  const cleanupQueue: Array<string | bigint> = [];
  if (enableTaint) {
    TaintRegistryPendingRequests.add(cleanupQueue);
  }
  const hints = createHints();
  const request: Request = ({
    status: OPEN,
    flushScheduled: false,
    fatalError: null,
    destination: null,
    bundlerConfig,
    cache: new Map(),
    nextChunkId: 0,
    pendingChunks: 0,
    hints,
    abortableTasks: abortSet,
    pingedTasks: pingedTasks,
    completedImportChunks: ([]: Array<Chunk>),
    completedHintChunks: ([]: Array<Chunk>),
    completedRegularChunks: ([]: Array<Chunk | BinaryChunk>),
    completedErrorChunks: ([]: Array<Chunk>),
    writtenSymbols: new Map(),
    writtenClientReferences: new Map(),
    writtenServerReferences: new Map(),
    writtenObjects: new WeakMap(),
    identifierPrefix: identifierPrefix || '',
    identifierCount: 1,
    taintCleanupQueue: cleanupQueue,
    onError: onError === undefined ? defaultErrorHandler : onError,
    onPostpone: onPostpone === undefined ? defaultPostponeHandler : onPostpone,
  }: any);
  if (__DEV__) {
    request.environmentName =
      environmentName === undefined ? 'Server' : environmentName;
  }
  const rootTask = createTask(request, model, null, false, abortSet);
  pingedTasks.push(rootTask);
  return request;
}

let currentRequest: null | Request = null;

export function resolveRequest(): null | Request {
  if (currentRequest) return currentRequest;
  if (supportsRequestStorage) {
    const store = requestStorage.getStore();
    if (store) return store;
  }
  return null;
}

function serializeThenable(
  request: Request,
  task: Task,
  thenable: Thenable<any>,
): number {
  const newTask = createTask(
    request,
    null,
    task.keyPath, // the server component sequence continues through Promise-as-a-child.
    task.implicitSlot,
    request.abortableTasks,
  );

  if (__DEV__) {
    // If this came from Flight, forward any debug info into this new row.
    const debugInfo: ?ReactDebugInfo = (thenable: any)._debugInfo;
    if (debugInfo) {
      forwardDebugInfo(request, newTask.id, debugInfo);
    }
  }

  switch (thenable.status) {
    case 'fulfilled': {
      // We have the resolved value, we can go ahead and schedule it for serialization.
      newTask.model = thenable.value;
      pingTask(request, newTask);
      return newTask.id;
    }
    case 'rejected': {
      const x = thenable.reason;
      if (
        enablePostpone &&
        typeof x === 'object' &&
        x !== null &&
        (x: any).$$typeof === REACT_POSTPONE_TYPE
      ) {
        const postponeInstance: Postpone = (x: any);
        logPostpone(request, postponeInstance.message);
        emitPostponeChunk(request, newTask.id, postponeInstance);
      } else {
        const digest = logRecoverableError(request, x);
        emitErrorChunk(request, newTask.id, digest, x);
      }
      return newTask.id;
    }
    default: {
      if (typeof thenable.status === 'string') {
        // Only instrument the thenable if the status if not defined. If
        // it's defined, but an unknown value, assume it's been instrumented by
        // some custom userspace implementation. We treat it as "pending".
        break;
      }
      const pendingThenable: PendingThenable<mixed> = (thenable: any);
      pendingThenable.status = 'pending';
      pendingThenable.then(
        fulfilledValue => {
          if (thenable.status === 'pending') {
            const fulfilledThenable: FulfilledThenable<mixed> = (thenable: any);
            fulfilledThenable.status = 'fulfilled';
            fulfilledThenable.value = fulfilledValue;
          }
        },
        (error: mixed) => {
          if (thenable.status === 'pending') {
            const rejectedThenable: RejectedThenable<mixed> = (thenable: any);
            rejectedThenable.status = 'rejected';
            rejectedThenable.reason = error;
          }
        },
      );
      break;
    }
  }

  thenable.then(
    value => {
      newTask.model = value;
      pingTask(request, newTask);
    },
    reason => {
      if (
        enablePostpone &&
        typeof reason === 'object' &&
        reason !== null &&
        (reason: any).$$typeof === REACT_POSTPONE_TYPE
      ) {
        const postponeInstance: Postpone = (reason: any);
        logPostpone(request, postponeInstance.message);
        emitPostponeChunk(request, newTask.id, postponeInstance);
      } else {
        newTask.status = ERRORED;
        const digest = logRecoverableError(request, reason);
        emitErrorChunk(request, newTask.id, digest, reason);
      }
      request.abortableTasks.delete(newTask);
      if (request.destination !== null) {
        flushCompletedChunks(request, request.destination);
      }
    },
  );

  return newTask.id;
}

export function emitHint<Code: HintCode>(
  request: Request,
  code: Code,
  model: HintModel<Code>,
): void {
  emitHintChunk(request, code, model);
  enqueueFlush(request);
}

export function getHints(request: Request): Hints {
  return request.hints;
}

export function getCache(request: Request): Map<Function, mixed> {
  return request.cache;
}

function readThenable<T>(thenable: Thenable<T>): T {
  if (thenable.status === 'fulfilled') {
    return thenable.value;
  } else if (thenable.status === 'rejected') {
    throw thenable.reason;
  }
  throw thenable;
}

function createLazyWrapperAroundWakeable(wakeable: Wakeable) {
  // This is a temporary fork of the `use` implementation until we accept
  // promises everywhere.
  const thenable: Thenable<mixed> = (wakeable: any);
  switch (thenable.status) {
    case 'fulfilled':
    case 'rejected':
      break;
    default: {
      if (typeof thenable.status === 'string') {
        // Only instrument the thenable if the status if not defined. If
        // it's defined, but an unknown value, assume it's been instrumented by
        // some custom userspace implementation. We treat it as "pending".
        break;
      }
      const pendingThenable: PendingThenable<mixed> = (thenable: any);
      pendingThenable.status = 'pending';
      pendingThenable.then(
        fulfilledValue => {
          if (thenable.status === 'pending') {
            const fulfilledThenable: FulfilledThenable<mixed> = (thenable: any);
            fulfilledThenable.status = 'fulfilled';
            fulfilledThenable.value = fulfilledValue;
          }
        },
        (error: mixed) => {
          if (thenable.status === 'pending') {
            const rejectedThenable: RejectedThenable<mixed> = (thenable: any);
            rejectedThenable.status = 'rejected';
            rejectedThenable.reason = error;
          }
        },
      );
      break;
    }
  }
  const lazyType: LazyComponent<any, Thenable<any>> = {
    $$typeof: REACT_LAZY_TYPE,
    _payload: thenable,
    _init: readThenable,
  };
  if (__DEV__) {
    // If this came from React, transfer the debug info.
    lazyType._debugInfo = (thenable: any)._debugInfo || [];
  }
  return lazyType;
}

function renderFunctionComponent<Props>(
  request: Request,
  task: Task,
  key: null | string,
  Component: (p: Props, arg: void) => any,
  props: Props,
): ReactJSONValue {
  // Reset the task's thenable state before continuing, so that if a later
  // component suspends we can reuse the same task object. If the same
  // component suspends again, the thenable state will be restored.
  const prevThenableState = task.thenableState;
  task.thenableState = null;

  if (__DEV__) {
    if (debugID === null) {
      // We don't have a chunk to assign debug info. We need to outline this
      // component to assign it an ID.
      return outlineTask(request, task);
    } else if (prevThenableState !== null) {
      // This is a replay and we've already emitted the debug info of this component
      // in the first pass. We skip emitting a duplicate line.
    } else {
      // This is a new component in the same task so we can emit more debug info.
      const componentName =
        (Component: any).displayName || Component.name || '';
      request.pendingChunks++;
      emitDebugChunk(request, debugID, {
        name: componentName,
        env: request.environmentName,
      });
    }
  }

  prepareToUseHooksForComponent(prevThenableState);
  // The secondArg is always undefined in Server Components since refs error early.
  const secondArg = undefined;
  let result = Component(props, secondArg);
  if (
    typeof result === 'object' &&
    result !== null &&
    typeof result.then === 'function'
  ) {
    // When the return value is in children position we can resolve it immediately,
    // to its value without a wrapper if it's synchronously available.
    const thenable: Thenable<any> = result;
    if (thenable.status === 'fulfilled') {
      return thenable.value;
    }
    // TODO: Once we accept Promises as children on the client, we can just return
    // the thenable here.
    result = createLazyWrapperAroundWakeable(result);
  }
  // Track this element's key on the Server Component on the keyPath context..
  const prevKeyPath = task.keyPath;
  const prevImplicitSlot = task.implicitSlot;
  if (key !== null) {
    // Append the key to the path. Technically a null key should really add the child
    // index. We don't do that to hold the payload small and implementation simple.
    task.keyPath = prevKeyPath === null ? key : prevKeyPath + ',' + key;
  } else if (prevKeyPath === null) {
    // This sequence of Server Components has no keys. This means that it was rendered
    // in a slot that needs to assign an implicit key. Even if children below have
    // explicit keys, they should not be used for the outer most key since it might
    // collide with other slots in that set.
    task.implicitSlot = true;
  }
  const json = renderModelDestructive(request, task, emptyRoot, '', result);
  task.keyPath = prevKeyPath;
  task.implicitSlot = prevImplicitSlot;
  return json;
}

function renderFragment(
  request: Request,
  task: Task,
  children: $ReadOnlyArray<ReactClientValue>,
): ReactJSONValue {
  if (__DEV__) {
    const debugInfo: ?ReactDebugInfo = (children: any)._debugInfo;
    if (debugInfo) {
      // If this came from Flight, forward any debug info into this new row.
      if (debugID === null) {
        // We don't have a chunk to assign debug info. We need to outline this
        // component to assign it an ID.
        return outlineTask(request, task);
      } else {
        // Forward any debug info we have the first time we see it.
        // We do this after init so that we have received all the debug info
        // from the server by the time we emit it.
        forwardDebugInfo(request, debugID, debugInfo);
      }
    }
  }
  if (!enableServerComponentKeys) {
    return children;
  }
  if (task.keyPath !== null) {
    // We have a Server Component that specifies a key but we're now splitting
    // the tree using a fragment.
    const fragment = [
      REACT_ELEMENT_TYPE,
      REACT_FRAGMENT_TYPE,
      task.keyPath,
      {children},
    ];
    if (!task.implicitSlot) {
      // If this was keyed inside a set. I.e. the outer Server Component was keyed
      // then we need to handle reorders of the whole set. To do this we need to wrap
      // this array in a keyed Fragment.
      return fragment;
    }
    // If the outer Server Component was implicit but then an inner one had a key
    // we don't actually need to be able to move the whole set around. It'll always be
    // in an implicit slot. The key only exists to be able to reset the state of the
    // children. We could achieve the same effect by passing on the keyPath to the next
    // set of components inside the fragment. This would also allow a keyless fragment
    // reconcile against a single child.
    // Unfortunately because of JSON.stringify, we can't call the recursive loop for
    // each child within this context because we can't return a set with already resolved
    // values. E.g. a string would get double encoded. Returning would pop the context.
    // So instead, we wrap it with an unkeyed fragment and inner keyed fragment.
    return [fragment];
  }
  // Since we're yielding here, that implicitly resets the keyPath context on the
  // way up. Which is what we want since we've consumed it. If this changes to
  // be recursive serialization, we need to reset the keyPath and implicitSlot,
  // before recursing here.
  return children;
}

function renderClientElement(
  task: Task,
  type: any,
  key: null | string,
  props: any,
): ReactJSONValue {
  if (!enableServerComponentKeys) {
    return [REACT_ELEMENT_TYPE, type, key, props];
  }
  // We prepend the terminal client element that actually gets serialized with
  // the keys of any Server Components which are not serialized.
  const keyPath = task.keyPath;
  if (key === null) {
    key = keyPath;
  } else if (keyPath !== null) {
    key = keyPath + ',' + key;
  }
  const element = [REACT_ELEMENT_TYPE, type, key, props];
  if (task.implicitSlot && key !== null) {
    // The root Server Component had no key so it was in an implicit slot.
    // If we had a key lower, it would end up in that slot with an explicit key.
    // We wrap the element in a fragment to give it an implicit key slot with
    // an inner explicit key.
    return [element];
  }
  // Since we're yielding here, that implicitly resets the keyPath context on the
  // way up. Which is what we want since we've consumed it. If this changes to
  // be recursive serialization, we need to reset the keyPath and implicitSlot,
  // before recursing here. We also need to reset it once we render into an array
  // or anything else too which we also get implicitly.
  return element;
}

// The chunk ID we're currently rendering that we can assign debug data to.
let debugID: null | number = null;

function outlineTask(request: Request, task: Task): ReactJSONValue {
  const newTask = createTask(
    request,
    task.model, // the currently rendering element
    task.keyPath, // unlike outlineModel this one carries along context
    task.implicitSlot,
    request.abortableTasks,
  );

  retryTask(request, newTask);
  if (newTask.status === COMPLETED) {
    // We completed synchronously so we can refer to this by reference. This
    // makes it behaves the same as prod during deserialization.
    return serializeByValueID(newTask.id);
  }
  // This didn't complete synchronously so it wouldn't have even if we didn't
  // outline it, so this would reduce to a lazy reference even in prod.
  return serializeLazyID(newTask.id);
}

function renderElement(
  request: Request,
  task: Task,
  type: any,
  key: null | string,
  ref: mixed,
  props: any,
): ReactJSONValue {
  if (ref !== null && ref !== undefined) {
    // When the ref moves to the regular props object this will implicitly
    // throw for functions. We could probably relax it to a DEV warning for other
    // cases.
    // TODO: `ref` is now just a prop when `enableRefAsProp` is on. Should we
    // do what the above comment says?
    throw new Error(
      'Refs cannot be used in Server Components, nor passed to Client Components.',
    );
  }
  if (__DEV__) {
    jsxPropsParents.set(props, type);
    if (typeof props.children === 'object' && props.children !== null) {
      jsxChildrenParents.set(props.children, type);
    }
  }
  if (typeof type === 'function') {
    if (isClientReference(type) || isTemporaryReference(type)) {
      // This is a reference to a Client Component.
      return renderClientElement(task, type, key, props);
    }
    // This is a Server Component.
    return renderFunctionComponent(request, task, key, type, props);
  } else if (typeof type === 'string') {
    // This is a host element. E.g. HTML.
    return renderClientElement(task, type, key, props);
  } else if (typeof type === 'symbol') {
    if (type === REACT_FRAGMENT_TYPE && key === null) {
      // For key-less fragments, we add a small optimization to avoid serializing
      // it as a wrapper.
      const prevImplicitSlot = task.implicitSlot;
      if (task.keyPath === null) {
        task.implicitSlot = true;
      }
      const json = renderModelDestructive(
        request,
        task,
        emptyRoot,
        '',
        props.children,
      );
      task.implicitSlot = prevImplicitSlot;
      return json;
    }
    // This might be a built-in React component. We'll let the client decide.
    // Any built-in works as long as its props are serializable.
    return renderClientElement(task, type, key, props);
  } else if (type != null && typeof type === 'object') {
    if (isClientReference(type)) {
      // This is a reference to a Client Component.
      return renderClientElement(task, type, key, props);
    }
    switch (type.$$typeof) {
      case REACT_LAZY_TYPE: {
        const payload = type._payload;
        const init = type._init;
        const wrappedType = init(payload);
        return renderElement(request, task, wrappedType, key, ref, props);
      }
      case REACT_FORWARD_REF_TYPE: {
        return renderFunctionComponent(request, task, key, type.render, props);
      }
      case REACT_MEMO_TYPE: {
        return renderElement(request, task, type.type, key, ref, props);
      }
    }
  }
  throw new Error(
    `Unsupported Server Component type: ${describeValueForErrorMessage(type)}`,
  );
}

function pingTask(request: Request, task: Task): void {
  const pingedTasks = request.pingedTasks;
  pingedTasks.push(task);
  if (pingedTasks.length === 1) {
    request.flushScheduled = request.destination !== null;
    scheduleWork(() => performWork(request));
  }
}

function createTask(
  request: Request,
  model: ReactClientValue,
  keyPath: null | string,
  implicitSlot: boolean,
  abortSet: Set<Task>,
): Task {
  request.pendingChunks++;
  const id = request.nextChunkId++;
  if (typeof model === 'object' && model !== null) {
    // If we're about to write this into a new task we can assign it an ID early so that
    // any other references can refer to the value we're about to write.
    if (enableServerComponentKeys && (keyPath !== null || implicitSlot)) {
      // If we're in some kind of context we can't necessarily reuse this object depending
      // what parent components are used.
    } else {
      request.writtenObjects.set(model, id);
    }
  }
  const task: Task = {
    id,
    status: PENDING,
    model,
    keyPath,
    implicitSlot,
    ping: () => pingTask(request, task),
    toJSON: function (
      this:
        | {+[key: string | number]: ReactClientValue}
        | $ReadOnlyArray<ReactClientValue>,
      parentPropertyName: string,
      value: ReactClientValue,
    ): ReactJSONValue {
      const parent = this;
      // Make sure that `parent[parentPropertyName]` wasn't JSONified before `value` was passed to us
      if (__DEV__) {
        // $FlowFixMe[incompatible-use]
        const originalValue = parent[parentPropertyName];
        if (
          typeof originalValue === 'object' &&
          originalValue !== value &&
          !(originalValue instanceof Date)
        ) {
          if (objectName(originalValue) !== 'Object') {
            const jsxParentType = jsxChildrenParents.get(parent);
            if (typeof jsxParentType === 'string') {
              console.error(
                '%s objects cannot be rendered as text children. Try formatting it using toString().%s',
                objectName(originalValue),
                describeObjectForErrorMessage(parent, parentPropertyName),
              );
            } else {
              console.error(
                'Only plain objects can be passed to Client Components from Server Components. ' +
                  '%s objects are not supported.%s',
                objectName(originalValue),
                describeObjectForErrorMessage(parent, parentPropertyName),
              );
            }
          } else {
            console.error(
              'Only plain objects can be passed to Client Components from Server Components. ' +
                'Objects with toJSON methods are not supported. Convert it manually ' +
                'to a simple value before passing it to props.%s',
              describeObjectForErrorMessage(parent, parentPropertyName),
            );
          }
        }
      }
      return renderModel(request, task, parent, parentPropertyName, value);
    },
    thenableState: null,
  };
  abortSet.add(task);
  return task;
}

function serializeByValueID(id: number): string {
  return '$' + id.toString(16);
}

function serializeLazyID(id: number): string {
  return '$L' + id.toString(16);
}

function serializeInfinitePromise(): string {
  return '$@';
}

function serializePromiseID(id: number): string {
  return '$@' + id.toString(16);
}

function serializeServerReferenceID(id: number): string {
  return '$F' + id.toString(16);
}

function serializeTemporaryReferenceID(id: string): string {
  return '$T' + id;
}

function serializeSymbolReference(name: string): string {
  return '$S' + name;
}

function serializeNumber(number: number): string | number {
  if (Number.isFinite(number)) {
    if (number === 0 && 1 / number === -Infinity) {
      return '$-0';
    } else {
      return number;
    }
  } else {
    if (number === Infinity) {
      return '$Infinity';
    } else if (number === -Infinity) {
      return '$-Infinity';
    } else {
      return '$NaN';
    }
  }
}

function serializeUndefined(): string {
  return '$undefined';
}

function serializeDateFromDateJSON(dateJSON: string): string {
  // JSON.stringify automatically calls Date.prototype.toJSON which calls toISOString.
  // We need only tack on a $D prefix.
  return '$D' + dateJSON;
}

function serializeBigInt(n: bigint): string {
  return '$n' + n.toString(10);
}

function serializeRowHeader(tag: string, id: number) {
  return id.toString(16) + ':' + tag;
}

function encodeReferenceChunk(
  request: Request,
  id: number,
  reference: string,
): Chunk {
  const json = stringify(reference);
  const row = id.toString(16) + ':' + json + '\n';
  return stringToChunk(row);
}

function serializeClientReference(
  request: Request,
  parent:
    | {+[propertyName: string | number]: ReactClientValue}
    | $ReadOnlyArray<ReactClientValue>,
  parentPropertyName: string,
  clientReference: ClientReference<any>,
): string {
  const clientReferenceKey: ClientReferenceKey =
    getClientReferenceKey(clientReference);
  const writtenClientReferences = request.writtenClientReferences;
  const existingId = writtenClientReferences.get(clientReferenceKey);
  if (existingId !== undefined) {
    if (parent[0] === REACT_ELEMENT_TYPE && parentPropertyName === '1') {
      // If we're encoding the "type" of an element, we can refer
      // to that by a lazy reference instead of directly since React
      // knows how to deal with lazy values. This lets us suspend
      // on this component rather than its parent until the code has
      // loaded.
      return serializeLazyID(existingId);
    }
    return serializeByValueID(existingId);
  }
  try {
    const clientReferenceMetadata: ClientReferenceMetadata =
      resolveClientReferenceMetadata(request.bundlerConfig, clientReference);
    request.pendingChunks++;
    const importId = request.nextChunkId++;
    emitImportChunk(request, importId, clientReferenceMetadata);
    writtenClientReferences.set(clientReferenceKey, importId);
    if (parent[0] === REACT_ELEMENT_TYPE && parentPropertyName === '1') {
      // If we're encoding the "type" of an element, we can refer
      // to that by a lazy reference instead of directly since React
      // knows how to deal with lazy values. This lets us suspend
      // on this component rather than its parent until the code has
      // loaded.
      return serializeLazyID(importId);
    }
    return serializeByValueID(importId);
  } catch (x) {
    request.pendingChunks++;
    const errorId = request.nextChunkId++;
    const digest = logRecoverableError(request, x);
    emitErrorChunk(request, errorId, digest, x);
    return serializeByValueID(errorId);
  }
}

function outlineModel(request: Request, value: ReactClientValue): number {
  const newTask = createTask(
    request,
    value,
    null, // The way we use outlining is for reusing an object.
    false, // It makes no sense for that use case to be contextual.
    request.abortableTasks,
  );
  retryTask(request, newTask);
  return newTask.id;
}

function serializeServerReference(
  request: Request,
  serverReference: ServerReference<any>,
): string {
  const writtenServerReferences = request.writtenServerReferences;
  const existingId = writtenServerReferences.get(serverReference);
  if (existingId !== undefined) {
    return serializeServerReferenceID(existingId);
  }

  const bound: null | Array<any> = getServerReferenceBoundArguments(
    request.bundlerConfig,
    serverReference,
  );
  const serverReferenceMetadata: {
    id: ServerReferenceId,
    bound: null | Promise<Array<any>>,
  } = {
    id: getServerReferenceId(request.bundlerConfig, serverReference),
    bound: bound ? Promise.resolve(bound) : null,
  };
  const metadataId = outlineModel(request, serverReferenceMetadata);
  writtenServerReferences.set(serverReference, metadataId);
  return serializeServerReferenceID(metadataId);
}

function serializeTemporaryReference(
  request: Request,
  temporaryReference: TemporaryReference<any>,
): string {
  const id = resolveTemporaryReferenceID(temporaryReference);
  return serializeTemporaryReferenceID(id);
}

function serializeLargeTextString(request: Request, text: string): string {
  request.pendingChunks += 2;
  const textId = request.nextChunkId++;
  const textChunk = stringToChunk(text);
  const binaryLength = byteLengthOfChunk(textChunk);
  const row = textId.toString(16) + ':T' + binaryLength.toString(16) + ',';
  const headerChunk = stringToChunk(row);
  request.completedRegularChunks.push(headerChunk, textChunk);
  return serializeByValueID(textId);
}

function serializeMap(
  request: Request,
  map: Map<ReactClientValue, ReactClientValue>,
): string {
  const entries = Array.from(map);
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i][0];
    if (typeof key === 'object' && key !== null) {
      const writtenObjects = request.writtenObjects;
      const existingId = writtenObjects.get(key);
      if (existingId === undefined) {
        // Mark all object keys as seen so that they're always outlined.
        writtenObjects.set(key, -1);
      }
    }
  }
  const id = outlineModel(request, entries);
  return '$Q' + id.toString(16);
}

function serializeSet(request: Request, set: Set<ReactClientValue>): string {
  const entries = Array.from(set);
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i];
    if (typeof key === 'object' && key !== null) {
      const writtenObjects = request.writtenObjects;
      const existingId = writtenObjects.get(key);
      if (existingId === undefined) {
        // Mark all object keys as seen so that they're always outlined.
        writtenObjects.set(key, -1);
      }
    }
  }
  const id = outlineModel(request, entries);
  return '$W' + id.toString(16);
}

function serializeTypedArray(
  request: Request,
  tag: string,
  typedArray: $ArrayBufferView,
): string {
  if (enableTaint) {
    if (TaintRegistryByteLengths.has(typedArray.byteLength)) {
      // If we have had any tainted values of this length, we check
      // to see if these bytes matches any entries in the registry.
      const tainted = TaintRegistryValues.get(
        binaryToComparableString(typedArray),
      );
      if (tainted !== undefined) {
        throwTaintViolation(tainted.message);
      }
    }
  }
  request.pendingChunks += 2;
  const bufferId = request.nextChunkId++;
  // TODO: Convert to little endian if that's not the server default.
  const binaryChunk = typedArrayToBinaryChunk(typedArray);
  const binaryLength = byteLengthOfBinaryChunk(binaryChunk);
  const row =
    bufferId.toString(16) + ':' + tag + binaryLength.toString(16) + ',';
  const headerChunk = stringToChunk(row);
  request.completedRegularChunks.push(headerChunk, binaryChunk);
  return serializeByValueID(bufferId);
}

function escapeStringValue(value: string): string {
  if (value[0] === '$') {
    // We need to escape $ prefixed strings since we use those to encode
    // references to IDs and as special symbol values.
    return '$' + value;
  } else {
    return value;
  }
}

let modelRoot: null | ReactClientValue = false;

function renderModel(
  request: Request,
  task: Task,
  parent:
    | {+[key: string | number]: ReactClientValue}
    | $ReadOnlyArray<ReactClientValue>,
  key: string,
  value: ReactClientValue,
): ReactJSONValue {
  const prevKeyPath = task.keyPath;
  const prevImplicitSlot = task.implicitSlot;
  try {
    return renderModelDestructive(request, task, parent, key, value);
  } catch (thrownValue) {
    const x =
      thrownValue === SuspenseException
        ? // This is a special type of exception used for Suspense. For historical
          // reasons, the rest of the Suspense implementation expects the thrown
          // value to be a thenable, because before `use` existed that was the
          // (unstable) API for suspending. This implementation detail can change
          // later, once we deprecate the old API in favor of `use`.
          getSuspendedThenable()
        : thrownValue;
    // If the suspended/errored value was an element or lazy it can be reduced
    // to a lazy reference, so that it doesn't error the parent.
    const model = task.model;
    const wasReactNode =
      typeof model === 'object' &&
      model !== null &&
      ((model: any).$$typeof === REACT_ELEMENT_TYPE ||
        (model: any).$$typeof === REACT_LAZY_TYPE);
    if (typeof x === 'object' && x !== null) {
      // $FlowFixMe[method-unbinding]
      if (typeof x.then === 'function') {
        // Something suspended, we'll need to create a new task and resolve it later.
        const newTask = createTask(
          request,
          task.model,
          task.keyPath,
          task.implicitSlot,
          request.abortableTasks,
        );
        const ping = newTask.ping;
        (x: any).then(ping, ping);
        newTask.thenableState = getThenableStateAfterSuspending();

        // Restore the context. We assume that this will be restored by the inner
        // functions in case nothing throws so we don't use "finally" here.
        task.keyPath = prevKeyPath;
        task.implicitSlot = prevImplicitSlot;

        if (wasReactNode) {
          return serializeLazyID(newTask.id);
        }
        return serializeByValueID(newTask.id);
      } else if (enablePostpone && x.$$typeof === REACT_POSTPONE_TYPE) {
        // Something postponed. We'll still send everything we have up until this point.
        // We'll replace this element with a lazy reference that postpones on the client.
        const postponeInstance: Postpone = (x: any);
        request.pendingChunks++;
        const postponeId = request.nextChunkId++;
        logPostpone(request, postponeInstance.message);
        emitPostponeChunk(request, postponeId, postponeInstance);

        // Restore the context. We assume that this will be restored by the inner
        // functions in case nothing throws so we don't use "finally" here.
        task.keyPath = prevKeyPath;
        task.implicitSlot = prevImplicitSlot;

        if (wasReactNode) {
          return serializeLazyID(postponeId);
        }
        return serializeByValueID(postponeId);
      }
    }

    // Restore the context. We assume that this will be restored by the inner
    // functions in case nothing throws so we don't use "finally" here.
    task.keyPath = prevKeyPath;
    task.implicitSlot = prevImplicitSlot;

    if (wasReactNode) {
      // Something errored. We'll still send everything we have up until this point.
      // We'll replace this element with a lazy reference that throws on the client
      // once it gets rendered.
      request.pendingChunks++;
      const errorId = request.nextChunkId++;
      const digest = logRecoverableError(request, x);
      emitErrorChunk(request, errorId, digest, x);
      return serializeLazyID(errorId);
    }
    // Something errored but it was not in a React Node. There's no need to serialize
    // it by value because it'll just error the whole parent row anyway so we can
    // just stop any siblings and error the whole parent row.
    throw x;
  }
}

function renderModelDestructive(
  request: Request,
  task: Task,
  parent:
    | {+[propertyName: string | number]: ReactClientValue}
    | $ReadOnlyArray<ReactClientValue>,
  parentPropertyName: string,
  value: ReactClientValue,
): ReactJSONValue {
  // Set the currently rendering model
  task.model = value;

  // Special Symbol, that's very common.
  if (value === REACT_ELEMENT_TYPE) {
    return '$';
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'object') {
    switch ((value: any).$$typeof) {
      case REACT_ELEMENT_TYPE: {
        const writtenObjects = request.writtenObjects;
        const existingId = writtenObjects.get(value);
        if (existingId !== undefined) {
          if (
            enableServerComponentKeys &&
            (task.keyPath !== null || task.implicitSlot)
          ) {
            // If we're in some kind of context we can't reuse the result of this render or
            // previous renders of this element. We only reuse elements if they're not wrapped
            // by another Server Component.
          } else if (modelRoot === value) {
            // This is the ID we're currently emitting so we need to write it
            // once but if we discover it again, we refer to it by id.
            modelRoot = null;
          } else if (existingId === -1) {
            // Seen but not yet outlined.
            // TODO: If we throw here we can treat this as suspending which causes an outline
            // but that is able to reuse the same task if we're already in one but then that
            // will be a lazy future value rather than guaranteed to exist but maybe that's good.
            const newId = outlineModel(request, (value: any));
            return serializeByValueID(newId);
          } else {
            // We've already emitted this as an outlined object, so we can refer to that by its
            // existing ID. TODO: We should use a lazy reference since, unlike plain objects,
            // elements might suspend so it might not have emitted yet even if we have the ID for
            // it. However, this creates an extra wrapper when it's not needed. We should really
            // detect whether this already was emitted and synchronously available. In that
            // case we can refer to it synchronously and only make it lazy otherwise.
            // We currently don't have a data structure that lets us see that though.
            return serializeByValueID(existingId);
          }
        } else {
          // This is the first time we've seen this object. We may never see it again
          // so we'll inline it. Mark it as seen. If we see it again, we'll outline.
          writtenObjects.set(value, -1);
        }

        const element: React$Element<any> = (value: any);

        if (__DEV__) {
          const debugInfo: ?ReactDebugInfo = (value: any)._debugInfo;
          if (debugInfo) {
            // If this came from Flight, forward any debug info into this new row.
            if (debugID === null) {
              // We don't have a chunk to assign debug info. We need to outline this
              // component to assign it an ID.
              return outlineTask(request, task);
            } else {
              // Forward any debug info we have the first time we see it.
              forwardDebugInfo(request, debugID, debugInfo);
            }
          }
        }

        const props = element.props;
        let ref;
        if (enableRefAsProp) {
          // TODO: This is a temporary, intermediate step. Once the feature
          // flag is removed, we should get the ref off the props object right
          // before using it.
          const refProp = props.ref;
          ref = refProp !== undefined ? refProp : null;
        } else {
          ref = element.ref;
        }

        // Attempt to render the Server Component.
        return renderElement(
          request,
          task,
          element.type,
          // $FlowFixMe[incompatible-call] the key of an element is null | string
          element.key,
          ref,
          props,
        );
      }
      case REACT_LAZY_TYPE: {
        // Reset the task's thenable state before continuing. If there was one, it was
        // from suspending the lazy before.
        task.thenableState = null;

        const lazy: LazyComponent<any, any> = (value: any);
        const payload = lazy._payload;
        const init = lazy._init;
        const resolvedModel = init(payload);
        if (__DEV__) {
          const debugInfo: ?ReactDebugInfo = lazy._debugInfo;
          if (debugInfo) {
            // If this came from Flight, forward any debug info into this new row.
            if (debugID === null) {
              // We don't have a chunk to assign debug info. We need to outline this
              // component to assign it an ID.
              return outlineTask(request, task);
            } else {
              // Forward any debug info we have the first time we see it.
              // We do this after init so that we have received all the debug info
              // from the server by the time we emit it.
              forwardDebugInfo(request, debugID, debugInfo);
            }
          }
        }
        return renderModelDestructive(
          request,
          task,
          emptyRoot,
          '',
          resolvedModel,
        );
      }
    }

    if (isClientReference(value)) {
      return serializeClientReference(
        request,
        parent,
        parentPropertyName,
        (value: any),
      );
    }

    if (enableTaint) {
      const tainted = TaintRegistryObjects.get(value);
      if (tainted !== undefined) {
        throwTaintViolation(tainted);
      }
    }

    const writtenObjects = request.writtenObjects;
    const existingId = writtenObjects.get(value);
    // $FlowFixMe[method-unbinding]
    if (typeof value.then === 'function') {
      if (existingId !== undefined) {
        if (
          enableServerComponentKeys &&
          (task.keyPath !== null || task.implicitSlot)
        ) {
          // If we're in some kind of context we can't reuse the result of this render or
          // previous renders of this element. We only reuse Promises if they're not wrapped
          // by another Server Component.
          const promiseId = serializeThenable(request, task, (value: any));
          return serializePromiseID(promiseId);
        } else if (modelRoot === value) {
          // This is the ID we're currently emitting so we need to write it
          // once but if we discover it again, we refer to it by id.
          modelRoot = null;
        } else {
          // We've seen this promise before, so we can just refer to the same result.
          return serializePromiseID(existingId);
        }
      }
      // We assume that any object with a .then property is a "Thenable" type,
      // or a Promise type. Either of which can be represented by a Promise.
      const promiseId = serializeThenable(request, task, (value: any));
      writtenObjects.set(value, promiseId);
      return serializePromiseID(promiseId);
    }

    if (existingId !== undefined) {
      if (modelRoot === value) {
        // This is the ID we're currently emitting so we need to write it
        // once but if we discover it again, we refer to it by id.
        modelRoot = null;
      } else if (existingId === -1) {
        // Seen but not yet outlined.
        const newId = outlineModel(request, (value: any));
        return serializeByValueID(newId);
      } else {
        // We've already emitted this as an outlined object, so we can
        // just refer to that by its existing ID.
        return serializeByValueID(existingId);
      }
    } else {
      // This is the first time we've seen this object. We may never see it again
      // so we'll inline it. Mark it as seen. If we see it again, we'll outline.
      writtenObjects.set(value, -1);
    }

    if (isArray(value)) {
      return renderFragment(request, task, value);
    }

    if (value instanceof Map) {
      return serializeMap(request, value);
    }
    if (value instanceof Set) {
      return serializeSet(request, value);
    }

    if (enableBinaryFlight) {
      if (value instanceof ArrayBuffer) {
        return serializeTypedArray(request, 'A', new Uint8Array(value));
      }
      if (value instanceof Int8Array) {
        // char
        return serializeTypedArray(request, 'C', value);
      }
      if (value instanceof Uint8Array) {
        // unsigned char
        return serializeTypedArray(request, 'c', value);
      }
      if (value instanceof Uint8ClampedArray) {
        // unsigned clamped char
        return serializeTypedArray(request, 'U', value);
      }
      if (value instanceof Int16Array) {
        // sort
        return serializeTypedArray(request, 'S', value);
      }
      if (value instanceof Uint16Array) {
        // unsigned short
        return serializeTypedArray(request, 's', value);
      }
      if (value instanceof Int32Array) {
        // long
        return serializeTypedArray(request, 'L', value);
      }
      if (value instanceof Uint32Array) {
        // unsigned long
        return serializeTypedArray(request, 'l', value);
      }
      if (value instanceof Float32Array) {
        // float
        return serializeTypedArray(request, 'F', value);
      }
      if (value instanceof Float64Array) {
        // double
        return serializeTypedArray(request, 'd', value);
      }
      if (value instanceof BigInt64Array) {
        // number
        return serializeTypedArray(request, 'N', value);
      }
      if (value instanceof BigUint64Array) {
        // unsigned number
        // We use "m" instead of "n" since JSON can start with "null"
        return serializeTypedArray(request, 'm', value);
      }
      if (value instanceof DataView) {
        return serializeTypedArray(request, 'V', value);
      }
    }

    const iteratorFn = getIteratorFn(value);
    if (iteratorFn) {
      return renderFragment(request, task, Array.from((value: any)));
    }

    // Verify that this is a simple plain object.
    const proto = getPrototypeOf(value);
    if (
      proto !== ObjectPrototype &&
      (proto === null || getPrototypeOf(proto) !== null)
    ) {
      throw new Error(
        'Only plain objects, and a few built-ins, can be passed to Client Components ' +
          'from Server Components. Classes or null prototypes are not supported.',
      );
    }
    if (__DEV__) {
      if (objectName(value) !== 'Object') {
        console.error(
          'Only plain objects can be passed to Client Components from Server Components. ' +
            '%s objects are not supported.%s',
          objectName(value),
          describeObjectForErrorMessage(parent, parentPropertyName),
        );
      } else if (!isSimpleObject(value)) {
        console.error(
          'Only plain objects can be passed to Client Components from Server Components. ' +
            'Classes or other objects with methods are not supported.%s',
          describeObjectForErrorMessage(parent, parentPropertyName),
        );
      } else if (Object.getOwnPropertySymbols) {
        const symbols = Object.getOwnPropertySymbols(value);
        if (symbols.length > 0) {
          console.error(
            'Only plain objects can be passed to Client Components from Server Components. ' +
              'Objects with symbol properties like %s are not supported.%s',
            symbols[0].description,
            describeObjectForErrorMessage(parent, parentPropertyName),
          );
        }
      }
    }

    // $FlowFixMe[incompatible-return]
    return value;
  }

  if (typeof value === 'string') {
    if (enableTaint) {
      const tainted = TaintRegistryValues.get(value);
      if (tainted !== undefined) {
        throwTaintViolation(tainted.message);
      }
    }
    // TODO: Maybe too clever. If we support URL there's no similar trick.
    if (value[value.length - 1] === 'Z') {
      // Possibly a Date, whose toJSON automatically calls toISOString
      // $FlowFixMe[incompatible-use]
      const originalValue = parent[parentPropertyName];
      if (originalValue instanceof Date) {
        return serializeDateFromDateJSON(value);
      }
    }
    if (value.length >= 1024) {
      // For large strings, we encode them outside the JSON payload so that we
      // don't have to double encode and double parse the strings. This can also
      // be more compact in case the string has a lot of escaped characters.
      return serializeLargeTextString(request, value);
    }
    return escapeStringValue(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return serializeNumber(value);
  }

  if (typeof value === 'undefined') {
    return serializeUndefined();
  }

  if (typeof value === 'function') {
    if (isClientReference(value)) {
      return serializeClientReference(
        request,
        parent,
        parentPropertyName,
        (value: any),
      );
    }
    if (isServerReference(value)) {
      return serializeServerReference(request, (value: any));
    }
    if (isTemporaryReference(value)) {
      return serializeTemporaryReference(request, (value: any));
    }

    if (enableTaint) {
      const tainted = TaintRegistryObjects.get(value);
      if (tainted !== undefined) {
        throwTaintViolation(tainted);
      }
    }

    if (/^on[A-Z]/.test(parentPropertyName)) {
      throw new Error(
        'Event handlers cannot be passed to Client Component props.' +
          describeObjectForErrorMessage(parent, parentPropertyName) +
          '\nIf you need interactivity, consider converting part of this to a Client Component.',
      );
    } else if (
      __DEV__ &&
      (jsxChildrenParents.has(parent) ||
        (jsxPropsParents.has(parent) && parentPropertyName === 'children'))
    ) {
      const componentName = value.displayName || value.name || 'Component';
      throw new Error(
        'Functions are not valid as a child of Client Components. This may happen if ' +
          'you return ' +
          componentName +
          ' instead of <' +
          componentName +
          ' /> from render. ' +
          'Or maybe you meant to call this function rather than return it.' +
          describeObjectForErrorMessage(parent, parentPropertyName),
      );
    } else {
      throw new Error(
        'Functions cannot be passed directly to Client Components ' +
          'unless you explicitly expose it by marking it with "use server". ' +
          'Or maybe you meant to call this function rather than return it.' +
          describeObjectForErrorMessage(parent, parentPropertyName),
      );
    }
  }

  if (typeof value === 'symbol') {
    const writtenSymbols = request.writtenSymbols;
    const existingId = writtenSymbols.get(value);
    if (existingId !== undefined) {
      return serializeByValueID(existingId);
    }
    // $FlowFixMe[incompatible-type] `description` might be undefined
    const name: string = value.description;

    if (Symbol.for(name) !== value) {
      throw new Error(
        'Only global symbols received from Symbol.for(...) can be passed to Client Components. ' +
          `The symbol Symbol.for(${
            // $FlowFixMe[incompatible-type] `description` might be undefined
            value.description
          }) cannot be found among global symbols.` +
          describeObjectForErrorMessage(parent, parentPropertyName),
      );
    }

    request.pendingChunks++;
    const symbolId = request.nextChunkId++;
    emitSymbolChunk(request, symbolId, name);
    writtenSymbols.set(value, symbolId);
    return serializeByValueID(symbolId);
  }

  if (typeof value === 'bigint') {
    if (enableTaint) {
      const tainted = TaintRegistryValues.get(value);
      if (tainted !== undefined) {
        throwTaintViolation(tainted.message);
      }
    }
    return serializeBigInt(value);
  }

  throw new Error(
    `Type ${typeof value} is not supported in Client Component props.` +
      describeObjectForErrorMessage(parent, parentPropertyName),
  );
}

function logPostpone(request: Request, reason: string): void {
  const prevRequest = currentRequest;
  currentRequest = null;
  try {
    const onPostpone = request.onPostpone;
    if (supportsRequestStorage) {
      // Exit the request context while running callbacks.
      requestStorage.run(undefined, onPostpone, reason);
    } else {
      onPostpone(reason);
    }
  } finally {
    currentRequest = prevRequest;
  }
}

function logRecoverableError(request: Request, error: mixed): string {
  const prevRequest = currentRequest;
  currentRequest = null;
  let errorDigest;
  try {
    const onError = request.onError;
    if (supportsRequestStorage) {
      // Exit the request context while running callbacks.
      errorDigest = requestStorage.run(undefined, onError, error);
    } else {
      errorDigest = onError(error);
    }
  } finally {
    currentRequest = prevRequest;
  }
  if (errorDigest != null && typeof errorDigest !== 'string') {
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      `onError returned something with a type other than "string". onError should return a string and may return null or undefined but must not return anything else. It received something of type "${typeof errorDigest}" instead`,
    );
  }
  return errorDigest || '';
}

function fatalError(request: Request, error: mixed): void {
  if (enableTaint) {
    cleanupTaintQueue(request);
  }
  // This is called outside error handling code such as if an error happens in React internals.
  if (request.destination !== null) {
    request.status = CLOSED;
    closeWithError(request.destination, error);
  } else {
    request.status = CLOSING;
    request.fatalError = error;
  }
}

function emitPostponeChunk(
  request: Request,
  id: number,
  postponeInstance: Postpone,
): void {
  let row;
  if (__DEV__) {
    let reason = '';
    let stack = '';
    try {
      // eslint-disable-next-line react-internal/safe-string-coercion
      reason = String(postponeInstance.message);
      // eslint-disable-next-line react-internal/safe-string-coercion
      stack = String(postponeInstance.stack);
    } catch (x) {}
    row = serializeRowHeader('P', id) + stringify({reason, stack}) + '\n';
  } else {
    // No reason included in prod.
    row = serializeRowHeader('P', id) + '\n';
  }
  const processedChunk = stringToChunk(row);
  request.completedErrorChunks.push(processedChunk);
}

function emitErrorChunk(
  request: Request,
  id: number,
  digest: string,
  error: mixed,
): void {
  let errorInfo: any;
  if (__DEV__) {
    let message;
    let stack = '';
    try {
      if (error instanceof Error) {
        // eslint-disable-next-line react-internal/safe-string-coercion
        message = String(error.message);
        // eslint-disable-next-line react-internal/safe-string-coercion
        stack = String(error.stack);
      } else if (typeof error === 'object' && error !== null) {
        message = describeObjectForErrorMessage(error);
      } else {
        // eslint-disable-next-line react-internal/safe-string-coercion
        message = String(error);
      }
    } catch (x) {
      message = 'An error occurred but serializing the error message failed.';
    }
    errorInfo = {digest, message, stack};
  } else {
    errorInfo = {digest};
  }
  const row = serializeRowHeader('E', id) + stringify(errorInfo) + '\n';
  const processedChunk = stringToChunk(row);
  request.completedErrorChunks.push(processedChunk);
}

function emitImportChunk(
  request: Request,
  id: number,
  clientReferenceMetadata: ClientReferenceMetadata,
): void {
  // $FlowFixMe[incompatible-type] stringify can return null
  const json: string = stringify(clientReferenceMetadata);
  const row = serializeRowHeader('I', id) + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedImportChunks.push(processedChunk);
}

function emitHintChunk<Code: HintCode>(
  request: Request,
  code: Code,
  model: HintModel<Code>,
): void {
  const json: string = stringify(model);
  const id = request.nextChunkId++;
  const row = serializeRowHeader('H' + code, id) + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedHintChunks.push(processedChunk);
}

function emitSymbolChunk(request: Request, id: number, name: string): void {
  const symbolReference = serializeSymbolReference(name);
  const processedChunk = encodeReferenceChunk(request, id, symbolReference);
  request.completedImportChunks.push(processedChunk);
}

function emitModelChunk(request: Request, id: number, json: string): void {
  const row = id.toString(16) + ':' + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedRegularChunks.push(processedChunk);
}

function emitDebugChunk(
  request: Request,
  id: number,
  debugInfo: ReactComponentInfo | ReactAsyncInfo,
): void {
  if (!__DEV__) {
    // These errors should never make it into a build so we don't need to encode them in codes.json
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'emitDebugChunk should never be called in production mode. This is a bug in React.',
    );
  }

  // $FlowFixMe[incompatible-type] stringify can return null
  const json: string = stringify(debugInfo);
  const row = serializeRowHeader('D', id) + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedRegularChunks.push(processedChunk);
}

function serializeEval(source: string): string {
  if (!__DEV__) {
    // These errors should never make it into a build so we don't need to encode them in codes.json
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'serializeEval should never be called in production mode. This is a bug in React.',
    );
  }
  return '$E' + source;
}

// This is a forked version of renderModel which should never error, never suspend and is limited
// in the depth it can encode.
function renderConsoleValue(
  request: Request,
  counter: {objectCount: number},
  parent:
    | {+[propertyName: string | number]: ReactClientValue}
    | $ReadOnlyArray<ReactClientValue>,
  parentPropertyName: string,
  value: ReactClientValue,
): ReactJSONValue {
  // Make sure that `parent[parentPropertyName]` wasn't JSONified before `value` was passed to us
  // $FlowFixMe[incompatible-use]
  const originalValue = parent[parentPropertyName];
  if (
    typeof originalValue === 'object' &&
    originalValue !== value &&
    !(originalValue instanceof Date)
  ) {
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'object') {
    if (isClientReference(value)) {
      // We actually have this value on the client so we could import it.
      // This might be confusing though because on the Server it won't actually
      // be this value, so if you're debugging client references maybe you'd be
      // better with a place holder.
      return serializeClientReference(
        request,
        parent,
        parentPropertyName,
        (value: any),
      );
    }

    if (counter.objectCount > 20) {
      // We've reached our max number of objects to serialize across the wire so we serialize this
      // object but no properties inside of it, as a place holder.
      return Array.isArray(value) ? [] : {};
    }

    counter.objectCount++;

    const writtenObjects = request.writtenObjects;
    const existingId = writtenObjects.get(value);
    // $FlowFixMe[method-unbinding]
    if (typeof value.then === 'function') {
      if (existingId !== undefined) {
        // We've seen this promise before, so we can just refer to the same result.
        return serializePromiseID(existingId);
      }

      const thenable: Thenable<any> = (value: any);
      switch (thenable.status) {
        case 'fulfilled': {
          return serializePromiseID(
            outlineConsoleValue(request, counter, thenable.value),
          );
        }
        case 'rejected': {
          const x = thenable.reason;
          request.pendingChunks++;
          const errorId = request.nextChunkId++;
          if (
            enablePostpone &&
            typeof x === 'object' &&
            x !== null &&
            (x: any).$$typeof === REACT_POSTPONE_TYPE
          ) {
            const postponeInstance: Postpone = (x: any);
            // We don't log this postpone.
            emitPostponeChunk(request, errorId, postponeInstance);
          } else {
            // We don't log these errors since they didn't actually throw into Flight.
            const digest = '';
            emitErrorChunk(request, errorId, digest, x);
          }
          return serializePromiseID(errorId);
        }
      }
      // If it hasn't already resolved (and been instrumented) we just encode an infinite
      // promise that will never resolve.
      return serializeInfinitePromise();
    }

    if (existingId !== undefined && existingId !== -1) {
      // We've already emitted this as a real object, so we can
      // just refer to that by its existing ID.
      return serializeByValueID(existingId);
    }

    if (isArray(value)) {
      return value;
    }

    if (value instanceof Map) {
      return serializeMap(request, value);
    }
    if (value instanceof Set) {
      return serializeSet(request, value);
    }

    if (enableBinaryFlight) {
      if (value instanceof ArrayBuffer) {
        return serializeTypedArray(request, 'A', new Uint8Array(value));
      }
      if (value instanceof Int8Array) {
        // char
        return serializeTypedArray(request, 'C', value);
      }
      if (value instanceof Uint8Array) {
        // unsigned char
        return serializeTypedArray(request, 'c', value);
      }
      if (value instanceof Uint8ClampedArray) {
        // unsigned clamped char
        return serializeTypedArray(request, 'U', value);
      }
      if (value instanceof Int16Array) {
        // sort
        return serializeTypedArray(request, 'S', value);
      }
      if (value instanceof Uint16Array) {
        // unsigned short
        return serializeTypedArray(request, 's', value);
      }
      if (value instanceof Int32Array) {
        // long
        return serializeTypedArray(request, 'L', value);
      }
      if (value instanceof Uint32Array) {
        // unsigned long
        return serializeTypedArray(request, 'l', value);
      }
      if (value instanceof Float32Array) {
        // float
        return serializeTypedArray(request, 'F', value);
      }
      if (value instanceof Float64Array) {
        // double
        return serializeTypedArray(request, 'd', value);
      }
      if (value instanceof BigInt64Array) {
        // number
        return serializeTypedArray(request, 'N', value);
      }
      if (value instanceof BigUint64Array) {
        // unsigned number
        // We use "m" instead of "n" since JSON can start with "null"
        return serializeTypedArray(request, 'm', value);
      }
      if (value instanceof DataView) {
        return serializeTypedArray(request, 'V', value);
      }
    }

    const iteratorFn = getIteratorFn(value);
    if (iteratorFn) {
      return Array.from((value: any));
    }

    // $FlowFixMe[incompatible-return]
    return value;
  }

  if (typeof value === 'string') {
    if (value[value.length - 1] === 'Z') {
      // Possibly a Date, whose toJSON automatically calls toISOString
      if (originalValue instanceof Date) {
        return serializeDateFromDateJSON(value);
      }
    }
    if (value.length >= 1024) {
      // For large strings, we encode them outside the JSON payload so that we
      // don't have to double encode and double parse the strings. This can also
      // be more compact in case the string has a lot of escaped characters.
      return serializeLargeTextString(request, value);
    }
    return escapeStringValue(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return serializeNumber(value);
  }

  if (typeof value === 'undefined') {
    return serializeUndefined();
  }

  if (typeof value === 'function') {
    if (isClientReference(value)) {
      return serializeClientReference(
        request,
        parent,
        parentPropertyName,
        (value: any),
      );
    }
    if (isTemporaryReference(value)) {
      return serializeTemporaryReference(request, (value: any));
    }

    // Serialize the body of the function as an eval so it can be printed.
    // $FlowFixMe[method-unbinding]
    return serializeEval('(' + Function.prototype.toString.call(value) + ')');
  }

  if (typeof value === 'symbol') {
    const writtenSymbols = request.writtenSymbols;
    const existingId = writtenSymbols.get(value);
    if (existingId !== undefined) {
      return serializeByValueID(existingId);
    }
    // $FlowFixMe[incompatible-type] `description` might be undefined
    const name: string = value.description;
    // We use the Symbol.for version if it's not a global symbol. Close enough.
    request.pendingChunks++;
    const symbolId = request.nextChunkId++;
    emitSymbolChunk(request, symbolId, name);
    return serializeByValueID(symbolId);
  }

  if (typeof value === 'bigint') {
    return serializeBigInt(value);
  }

  return 'unknown type ' + typeof value;
}

function outlineConsoleValue(
  request: Request,
  counter: {objectCount: number},
  model: ReactClientValue,
): number {
  if (!__DEV__) {
    // These errors should never make it into a build so we don't need to encode them in codes.json
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'outlineConsoleValue should never be called in production mode. This is a bug in React.',
    );
  }

  function replacer(
    this:
      | {+[key: string | number]: ReactClientValue}
      | $ReadOnlyArray<ReactClientValue>,
    parentPropertyName: string,
    value: ReactClientValue,
  ): ReactJSONValue {
    try {
      return renderConsoleValue(
        request,
        counter,
        this,
        parentPropertyName,
        value,
      );
    } catch (x) {
      return 'unknown value';
    }
  }

  // $FlowFixMe[incompatible-type] stringify can return null
  const json: string = stringify(model, replacer);

  request.pendingChunks++;
  const id = request.nextChunkId++;
  const row = id.toString(16) + ':' + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedRegularChunks.push(processedChunk);
  return id;
}

function emitConsoleChunk(
  request: Request,
  id: number,
  methodName: string,
  stackTrace: string,
  args: Array<any>,
): void {
  if (!__DEV__) {
    // These errors should never make it into a build so we don't need to encode them in codes.json
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'emitConsoleChunk should never be called in production mode. This is a bug in React.',
    );
  }

  const counter = {objectCount: 0};
  function replacer(
    this:
      | {+[key: string | number]: ReactClientValue}
      | $ReadOnlyArray<ReactClientValue>,
    parentPropertyName: string,
    value: ReactClientValue,
  ): ReactJSONValue {
    try {
      return renderConsoleValue(
        request,
        counter,
        this,
        parentPropertyName,
        value,
      );
    } catch (x) {
      return 'unknown value';
    }
  }

  // TODO: Don't double badge if this log came from another Flight Client.
  const env = request.environmentName;
  const payload = [methodName, stackTrace, env];
  // $FlowFixMe[method-unbinding]
  payload.push.apply(payload, args);
  // $FlowFixMe[incompatible-type] stringify can return null
  const json: string = stringify(payload, replacer);
  const row = serializeRowHeader('W', id) + json + '\n';
  const processedChunk = stringToChunk(row);
  request.completedRegularChunks.push(processedChunk);
}

function forwardDebugInfo(
  request: Request,
  id: number,
  debugInfo: ReactDebugInfo,
) {
  for (let i = 0; i < debugInfo.length; i++) {
    request.pendingChunks++;
    emitDebugChunk(request, id, debugInfo[i]);
  }
}

const emptyRoot = {};

function retryTask(request: Request, task: Task): void {
  if (task.status !== PENDING) {
    // We completed this by other means before we had a chance to retry it.
    return;
  }

  const prevDebugID = debugID;

  try {
    // Track the root so we know that we have to emit this object even though it
    // already has an ID. This is needed because we might see this object twice
    // in the same toJSON if it is cyclic.
    modelRoot = task.model;

    if (__DEV__) {
      // Track the ID of the current task so we can assign debug info to this id.
      debugID = task.id;
    }

    // We call the destructive form that mutates this task. That way if something
    // suspends again, we can reuse the same task instead of spawning a new one.
    const resolvedModel = renderModelDestructive(
      request,
      task,
      emptyRoot,
      '',
      task.model,
    );

    if (__DEV__) {
      // We're now past rendering this task and future renders will spawn new tasks for their
      // debug info.
      debugID = null;
    }

    // Track the root again for the resolved object.
    modelRoot = resolvedModel;

    // The keyPath resets at any terminal child node.
    task.keyPath = null;
    task.implicitSlot = false;

    let json: string;
    if (typeof resolvedModel === 'object' && resolvedModel !== null) {
      // Object might contain unresolved values like additional elements.
      // This is simulating what the JSON loop would do if this was part of it.
      // $FlowFixMe[incompatible-type] stringify can return null for undefined but we never do
      json = stringify(resolvedModel, task.toJSON);
    } else {
      // If the value is a string, it means it's a terminal value and we already escaped it
      // We don't need to escape it again so it's not passed the toJSON replacer.
      // $FlowFixMe[incompatible-type] stringify can return null for undefined but we never do
      json = stringify(resolvedModel);
    }
    emitModelChunk(request, task.id, json);

    request.abortableTasks.delete(task);
    task.status = COMPLETED;
  } catch (thrownValue) {
    const x =
      thrownValue === SuspenseException
        ? // This is a special type of exception used for Suspense. For historical
          // reasons, the rest of the Suspense implementation expects the thrown
          // value to be a thenable, because before `use` existed that was the
          // (unstable) API for suspending. This implementation detail can change
          // later, once we deprecate the old API in favor of `use`.
          getSuspendedThenable()
        : thrownValue;
    if (typeof x === 'object' && x !== null) {
      // $FlowFixMe[method-unbinding]
      if (typeof x.then === 'function') {
        // Something suspended again, let's pick it back up later.
        const ping = task.ping;
        x.then(ping, ping);
        task.thenableState = getThenableStateAfterSuspending();
        return;
      } else if (enablePostpone && x.$$typeof === REACT_POSTPONE_TYPE) {
        request.abortableTasks.delete(task);
        task.status = ERRORED;
        const postponeInstance: Postpone = (x: any);
        logPostpone(request, postponeInstance.message);
        emitPostponeChunk(request, task.id, postponeInstance);
        return;
      }
    }
    request.abortableTasks.delete(task);
    task.status = ERRORED;
    const digest = logRecoverableError(request, x);
    emitErrorChunk(request, task.id, digest, x);
  } finally {
    if (__DEV__) {
      debugID = prevDebugID;
    }
  }
}

function performWork(request: Request): void {
  const prevDispatcher = ReactCurrentDispatcher.current;
  ReactCurrentDispatcher.current = HooksDispatcher;
  const prevRequest = currentRequest;
  currentRequest = request;
  prepareToUseHooksForRequest(request);

  try {
    const pingedTasks = request.pingedTasks;
    request.pingedTasks = [];
    for (let i = 0; i < pingedTasks.length; i++) {
      const task = pingedTasks[i];
      retryTask(request, task);
    }
    if (request.destination !== null) {
      flushCompletedChunks(request, request.destination);
    }
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  } finally {
    ReactCurrentDispatcher.current = prevDispatcher;
    resetHooksForRequest();
    currentRequest = prevRequest;
  }
}

function abortTask(task: Task, request: Request, errorId: number): void {
  task.status = ABORTED;
  // Instead of emitting an error per task.id, we emit a model that only
  // has a single value referencing the error.
  const ref = serializeByValueID(errorId);
  const processedChunk = encodeReferenceChunk(request, task.id, ref);
  request.completedErrorChunks.push(processedChunk);
}

function flushCompletedChunks(
  request: Request,
  destination: Destination,
): void {
  beginWriting(destination);
  try {
    // We emit module chunks first in the stream so that
    // they can be preloaded as early as possible.
    const importsChunks = request.completedImportChunks;
    let i = 0;
    for (; i < importsChunks.length; i++) {
      request.pendingChunks--;
      const chunk = importsChunks[i];
      const keepWriting: boolean = writeChunkAndReturn(destination, chunk);
      if (!keepWriting) {
        request.destination = null;
        i++;
        break;
      }
    }
    importsChunks.splice(0, i);

    // Next comes hints.
    const hintChunks = request.completedHintChunks;
    i = 0;
    for (; i < hintChunks.length; i++) {
      const chunk = hintChunks[i];
      const keepWriting: boolean = writeChunkAndReturn(destination, chunk);
      if (!keepWriting) {
        request.destination = null;
        i++;
        break;
      }
    }
    hintChunks.splice(0, i);

    // Next comes model data.
    const regularChunks = request.completedRegularChunks;
    i = 0;
    for (; i < regularChunks.length; i++) {
      request.pendingChunks--;
      const chunk = regularChunks[i];
      const keepWriting: boolean = writeChunkAndReturn(destination, chunk);
      if (!keepWriting) {
        request.destination = null;
        i++;
        break;
      }
    }
    regularChunks.splice(0, i);

    // Finally, errors are sent. The idea is that it's ok to delay
    // any error messages and prioritize display of other parts of
    // the page.
    const errorChunks = request.completedErrorChunks;
    i = 0;
    for (; i < errorChunks.length; i++) {
      request.pendingChunks--;
      const chunk = errorChunks[i];
      const keepWriting: boolean = writeChunkAndReturn(destination, chunk);
      if (!keepWriting) {
        request.destination = null;
        i++;
        break;
      }
    }
    errorChunks.splice(0, i);
  } finally {
    request.flushScheduled = false;
    completeWriting(destination);
  }
  flushBuffered(destination);
  if (request.pendingChunks === 0) {
    // We're done.
    if (enableTaint) {
      cleanupTaintQueue(request);
    }
    close(destination);
  }
}

export function startWork(request: Request): void {
  request.flushScheduled = request.destination !== null;
  if (supportsRequestStorage) {
    scheduleWork(() => requestStorage.run(request, performWork, request));
  } else {
    scheduleWork(() => performWork(request));
  }
}

function enqueueFlush(request: Request): void {
  if (
    request.flushScheduled === false &&
    // If there are pinged tasks we are going to flush anyway after work completes
    request.pingedTasks.length === 0 &&
    // If there is no destination there is nothing we can flush to. A flush will
    // happen when we start flowing again
    request.destination !== null
  ) {
    const destination = request.destination;
    request.flushScheduled = true;
    scheduleWork(() => flushCompletedChunks(request, destination));
  }
}

export function startFlowing(request: Request, destination: Destination): void {
  if (request.status === CLOSING) {
    request.status = CLOSED;
    closeWithError(destination, request.fatalError);
    return;
  }
  if (request.status === CLOSED) {
    return;
  }
  if (request.destination !== null) {
    // We're already flowing.
    return;
  }
  request.destination = destination;
  try {
    flushCompletedChunks(request, destination);
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  }
}

export function stopFlowing(request: Request): void {
  request.destination = null;
}

// This is called to early terminate a request. It creates an error at all pending tasks.
export function abort(request: Request, reason: mixed): void {
  try {
    const abortableTasks = request.abortableTasks;
    if (abortableTasks.size > 0) {
      // We have tasks to abort. We'll emit one error row and then emit a reference
      // to that row from every row that's still remaining.
      request.pendingChunks++;
      const errorId = request.nextChunkId++;
      if (
        enablePostpone &&
        typeof reason === 'object' &&
        reason !== null &&
        (reason: any).$$typeof === REACT_POSTPONE_TYPE
      ) {
        const postponeInstance: Postpone = (reason: any);
        logPostpone(request, postponeInstance.message);
        emitPostponeChunk(request, errorId, postponeInstance);
      } else {
        const error =
          reason === undefined
            ? new Error(
                'The render was aborted by the server without a reason.',
              )
            : reason;
        const digest = logRecoverableError(request, error);
        emitErrorChunk(request, errorId, digest, error);
      }
      abortableTasks.forEach(task => abortTask(task, request, errorId));
      abortableTasks.clear();
    }
    if (request.destination !== null) {
      flushCompletedChunks(request, request.destination);
    }
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  }
}
