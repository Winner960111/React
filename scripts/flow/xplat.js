/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

declare module 'ReactNativeInternalFeatureFlags' {
  declare export var alwaysThrottleDisappearingFallbacks: boolean;
  declare export var alwaysThrottleRetries: boolean;
  declare export var consoleManagedByDevToolsDuringStrictMode: boolean;
  declare export var enableAsyncActions: boolean;
  declare export var enableComponentStackLocations: boolean;
  declare export var enableDeferRootSchedulingToMicrotask: boolean;
  declare export var enableInfiniteRenderLoopDetection: boolean;
  declare export var enableRenderableContext: boolean;
  declare export var enableUnifiedSyncLane: boolean;
  declare export var enableUseRefAccessWarning: boolean;
  declare export var passChildrenWhenCloningPersistedNodes: boolean;
  declare export var useModernStrictMode: boolean;
}
