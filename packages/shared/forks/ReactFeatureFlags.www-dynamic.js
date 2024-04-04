/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// In www, these flags are controlled by GKs. Because most GKs have some
// population running in either mode, we should run our tests that way, too,
//
// Use __VARIANT__ to simulate a GK. The tests will be run twice: once
// with the __VARIANT__ set to `true`, and once set to `false`.

export const disableInputAttributeSyncing = __VARIANT__;
export const disableIEWorkarounds = __VARIANT__;
export const enableLegacyFBSupport = __VARIANT__;
export const enableUseRefAccessWarning = __VARIANT__;
export const disableSchedulerTimeoutInWorkLoop = __VARIANT__;
export const enableLazyContextPropagation = __VARIANT__;
export const forceConcurrentByDefaultForTesting = __VARIANT__;
export const enableUnifiedSyncLane = __VARIANT__;
export const enableTransitionTracing = __VARIANT__;
export const enableDeferRootSchedulingToMicrotask = __VARIANT__;
export const alwaysThrottleDisappearingFallbacks = __VARIANT__;
export const alwaysThrottleRetries = __VARIANT__;
export const enableDO_NOT_USE_disableStrictPassiveEffect = __VARIANT__;
export const enableUseDeferredValueInitialArg = __VARIANT__;
export const enableRenderableContext = __VARIANT__;
export const useModernStrictMode = __VARIANT__;
export const enableRefAsProp = __VARIANT__;
export const enableClientRenderFallbackOnTextMismatch = __VARIANT__;
export const enableNewBooleanProps = __VARIANT__;
export const enableRetryLaneExpiration = __VARIANT__;
export const retryLaneExpirationMs = 5000;
export const syncLaneExpirationMs = 250;
export const transitionLaneExpirationMs = 5000;

// Enable this flag to help with concurrent mode debugging.
// It logs information to the console about React scheduling, rendering, and commit phases.
//
// NOTE: This feature will only work in DEV mode; all callsites are wrapped with __DEV__.
export const enableDebugTracing = __EXPERIMENTAL__;

export const enableSchedulingProfiler = __VARIANT__;

export const enableInfiniteRenderLoopDetection = __VARIANT__;

// TODO: These flags are hard-coded to the default values used in open source.
// Update the tests so that they pass in either mode, then set these
// to __VARIANT__.
export const enableTrustedTypesIntegration = false;
// You probably *don't* want to add more hardcoded ones.
// Instead, try to add them above with the __VARIANT__ value.
