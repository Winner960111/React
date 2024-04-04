/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {HostDispatcher} from './shared/ReactDOMTypes';

type InternalsType = {
  usingClientEntryPoint: boolean,
  Events: [any, any, any, any, any, any],
  ReactDOMCurrentDispatcher: {
    current: HostDispatcher,
  },
};

function noop() {}

const DefaultDispatcher: HostDispatcher = {
  prefetchDNS: noop,
  preconnect: noop,
  preload: noop,
  preloadModule: noop,
  preinitScript: noop,
  preinitStyle: noop,
  preinitModuleScript: noop,
};

const Internals: InternalsType = ({
  usingClientEntryPoint: false,
  Events: null,
  ReactDOMCurrentDispatcher: {
    current: DefaultDispatcher,
  },
}: any);

export default Internals;
