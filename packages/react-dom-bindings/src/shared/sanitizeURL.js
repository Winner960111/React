/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {disableJavaScriptURLs} from 'shared/ReactFeatureFlags';

// A javascript: URL can contain leading C0 control or \u0020 SPACE,
// and any newline or tab are filtered out as if they're not part of the URL.
// https://url.spec.whatwg.org/#url-parsing
// Tab or newline are defined as \r\n\t:
// https://infra.spec.whatwg.org/#ascii-tab-or-newline
// A C0 control is a code point in the range \u0000 NULL to \u001F
// INFORMATION SEPARATOR ONE, inclusive:
// https://infra.spec.whatwg.org/#c0-control-or-space

/* eslint-disable max-len */
const isJavaScriptProtocol =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*\:/i;

let didWarn = false;

function sanitizeURL<T>(url: T): T | string {
  // We should never have symbols here because they get filtered out elsewhere.
  // eslint-disable-next-line react-internal/safe-string-coercion
  const stringifiedURL = '' + (url: any);
  if (disableJavaScriptURLs) {
    if (isJavaScriptProtocol.test(stringifiedURL)) {
      // Return a different javascript: url that doesn't cause any side-effects and just
      // throws if ever visited.
      // eslint-disable-next-line no-script-url
      return "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";
    }
  } else if (__DEV__) {
    if (!didWarn && isJavaScriptProtocol.test(stringifiedURL)) {
      didWarn = true;
      console.error(
        'A future version of React will block javascript: URLs as a security precaution. ' +
          'Use event handlers instead if you can. If you need to generate unsafe HTML try ' +
          'using dangerouslySetInnerHTML instead. React was passed %s.',
        JSON.stringify(stringifiedURL),
      );
    }
  }
  return url;
}

export default sanitizeURL;
