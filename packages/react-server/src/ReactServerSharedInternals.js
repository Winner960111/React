/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as React from 'react';

const ReactSharedServerInternals =
  // $FlowFixMe: It's defined in the one we resolve to.
  React.__SECRET_SERVER_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

if (!ReactSharedServerInternals) {
  throw new Error(
    'The "react" package in this environment is not configured correctly. ' +
      'The "react-server" condition must be enabled in any environment that ' +
      'runs React Server Components.',
  );
}

export default ReactSharedServerInternals;
