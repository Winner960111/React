/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Thenable, ReactCustomFormAction} from 'shared/ReactTypes.js';

import type {Response as FlightResponse} from 'react-client/src/ReactFlightClient';

import type {ReactServerValue} from 'react-client/src/ReactFlightReplyClient';

import type {
  SSRModuleMap,
  ModuleLoading,
} from 'react-client/src/ReactFlightClientConfig';

type SSRManifest = {
  moduleMap: SSRModuleMap,
  moduleLoading: ModuleLoading,
};

import {
  createResponse,
  getRoot,
  reportGlobalError,
  processBinaryChunk,
  close,
} from 'react-client/src/ReactFlightClient';

import {
  processReply,
  createServerReference as createServerReferenceImpl,
} from 'react-client/src/ReactFlightReplyClient';

import type {TemporaryReferenceSet} from 'react-client/src/ReactFlightTemporaryReferences';

export {createTemporaryReferenceSet} from 'react-client/src/ReactFlightTemporaryReferences';

export type {TemporaryReferenceSet};

function noServerCall() {
  throw new Error(
    'Server Functions cannot be called during initial render. ' +
      'This would create a fetch waterfall. Try to use a Server Component ' +
      'to pass data to Client Components instead.',
  );
}

export function createServerReference<A: Iterable<any>, T>(
  id: any,
  callServer: any,
): (...A) => Promise<T> {
  return createServerReferenceImpl(id, noServerCall);
}

type EncodeFormActionCallback = <A>(
  id: any,
  args: Promise<A>,
) => ReactCustomFormAction;

export type Options = {
  ssrManifest: SSRManifest,
  nonce?: string,
  encodeFormAction?: EncodeFormActionCallback,
  temporaryReferences?: TemporaryReferenceSet,
};

function createResponseFromOptions(options: Options) {
  return createResponse(
    options.ssrManifest.moduleMap,
    options.ssrManifest.moduleLoading,
    noServerCall,
    options.encodeFormAction,
    typeof options.nonce === 'string' ? options.nonce : undefined,
    options && options.temporaryReferences
      ? options.temporaryReferences
      : undefined,
  );
}

function startReadingFromStream(
  response: FlightResponse,
  stream: ReadableStream,
): void {
  const reader = stream.getReader();
  function progress({
    done,
    value,
  }: {
    done: boolean,
    value: ?any,
    ...
  }): void | Promise<void> {
    if (done) {
      close(response);
      return;
    }
    const buffer: Uint8Array = (value: any);
    processBinaryChunk(response, buffer);
    return reader.read().then(progress).catch(error);
  }
  function error(e: any) {
    reportGlobalError(response, e);
  }
  reader.read().then(progress).catch(error);
}

function createFromReadableStream<T>(
  stream: ReadableStream,
  options: Options,
): Thenable<T> {
  const response: FlightResponse = createResponseFromOptions(options);
  startReadingFromStream(response, stream);
  return getRoot(response);
}

function createFromFetch<T>(
  promiseForResponse: Promise<Response>,
  options: Options,
): Thenable<T> {
  const response: FlightResponse = createResponseFromOptions(options);
  promiseForResponse.then(
    function (r) {
      startReadingFromStream(response, (r.body: any));
    },
    function (e) {
      reportGlobalError(response, e);
    },
  );
  return getRoot(response);
}

function encodeReply(
  value: ReactServerValue,
  options?: {temporaryReferences?: TemporaryReferenceSet},
): Promise<
  string | URLSearchParams | FormData,
> /* We don't use URLSearchParams yet but maybe */ {
  return new Promise((resolve, reject) => {
    processReply(
      value,
      '',
      options && options.temporaryReferences
        ? options.temporaryReferences
        : undefined,
      resolve,
      reject,
    );
  });
}

export {createFromFetch, createFromReadableStream, encodeReply};
