/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import typeof * as ExportsType from './ReactFeatureFlags.native-fb-dynamic';
import typeof * as DynamicFlagsType from 'ReactNativeInternalFeatureFlags';

// In xplat, these flags are controlled by GKs. Because most GKs have some
// population running in either mode, we should run our tests that way, too,
//
// Use __VARIANT__ to simulate a GK. The tests will be run twice: once
// with the __VARIANT__ set to `true`, and once set to `false`.
//
// TODO: __VARIANT__ isn't supported for React Native flags yet. You can set the
// flag here but it won't be set to `true` in any of our test runs. Need to
// update the test configuration.

export const alwaysThrottleDisappearingFallbacks = __VARIANT__;
export const alwaysThrottleRetries = __VARIANT__;
export const consoleManagedByDevToolsDuringStrictMode = __VARIANT__;
export const enableAsyncActions = __VARIANT__;
export const enableComponentStackLocations = __VARIANT__;
export const enableDeferRootSchedulingToMicrotask = __VARIANT__;
export const enableInfiniteRenderLoopDetection = __VARIANT__;
export const enableRenderableContext = __VARIANT__;
export const enableUnifiedSyncLane = __VARIANT__;
export const enableUseRefAccessWarning = __VARIANT__;
export const passChildrenWhenCloningPersistedNodes = __VARIANT__;
export const useModernStrictMode = __VARIANT__;

// Flow magic to verify the exports of this file match the original version.
((((null: any): ExportsType): DynamicFlagsType): ExportsType);
