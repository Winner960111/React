/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import typeof * as FeatureFlagsType from 'shared/ReactFeatureFlags';
import typeof * as ExportsType from './ReactFeatureFlags.www';
import typeof * as DynamicFeatureFlags from './ReactFeatureFlags.www-dynamic';

// Re-export dynamic flags from the www version.
const dynamicFeatureFlags: DynamicFeatureFlags = require('ReactFeatureFlags');

export const {
  disableInputAttributeSyncing,
  disableIEWorkarounds,
  enableTrustedTypesIntegration,
  enableLegacyFBSupport,
  enableDebugTracing,
  enableUseRefAccessWarning,
  enableLazyContextPropagation,
  enableUnifiedSyncLane,
  enableRetryLaneExpiration,
  enableTransitionTracing,
  enableDeferRootSchedulingToMicrotask,
  alwaysThrottleDisappearingFallbacks,
  alwaysThrottleRetries,
  enableDO_NOT_USE_disableStrictPassiveEffect,
  disableSchedulerTimeoutInWorkLoop,
  enableUseDeferredValueInitialArg,
  retryLaneExpirationMs,
  syncLaneExpirationMs,
  transitionLaneExpirationMs,
  enableInfiniteRenderLoopDetection,
  enableRenderableContext,
  useModernStrictMode,
  enableRefAsProp,
  enableNewBooleanProps,
  enableClientRenderFallbackOnTextMismatch,
} = dynamicFeatureFlags;

// On WWW, __EXPERIMENTAL__ is used for a new modern build.
// It's not used anywhere in production yet.

export const debugRenderPhaseSideEffectsForStrictMode = __DEV__;
export const enableProfilerTimer = __PROFILE__;
export const enableProfilerCommitHooks = __PROFILE__;
export const enableProfilerNestedUpdatePhase = __PROFILE__;
export const enableUpdaterTracking = __PROFILE__;

export const enableSuspenseAvoidThisFallback = true;
export const enableSuspenseAvoidThisFallbackFizz = false;

export const enableCustomElementPropertySupport = true;
export const enableCPUSuspense = true;
export const enableFloat = true;
export const enableUseMemoCacheHook = true;
export const enableUseEffectEventHook = true;
export const enableFilterEmptyStringAttributesDOM = true;
export const enableFormActions = true;
export const enableAsyncActions = true;

// Logs additional User Timing API marks for use with an experimental profiling tool.
export const enableSchedulingProfiler: boolean =
  __PROFILE__ && dynamicFeatureFlags.enableSchedulingProfiler;

export const disableLegacyContext = __EXPERIMENTAL__;
export const enableGetInspectorDataForInstanceInProduction = false;

export const enableCache = true;
export const enableLegacyCache = true;
export const enableCacheElement = true;
export const enableFetchInstrumentation = false;

export const enableBinaryFlight = false;
export const enableTaint = false;

export const enablePostpone = false;

export const disableJavaScriptURLs = true;

// TODO: www currently relies on this feature. It's disabled in open source.
// Need to remove it.
export const disableCommentsAsDOMContainers = false;

export const disableModulePatternComponents = true;

export const enableCreateEventHandleAPI = true;

export const enableScopeAPI = true;

export const enableSuspenseCallback = true;

export const enableLegacyHidden = true;

export const enableComponentStackLocations = true;

export const disableTextareaChildren = __EXPERIMENTAL__;

export const allowConcurrentByDefault = true;

export const consoleManagedByDevToolsDuringStrictMode = true;

export const enableFizzExternalRuntime = true;

export const forceConcurrentByDefaultForTesting = false;

export const passChildrenWhenCloningPersistedNodes = false;

export const enableAsyncDebugInfo = false;
export const disableClientCache = true;

export const enableServerComponentKeys = true;
export const enableServerComponentLogs = true;

export const enableReactTestRendererWarning = false;

export const enableBigIntSupport = false;

// TODO: Roll out with GK. Don't keep as dynamic flag for too long, though,
// because JSX is an extremely hot path.
export const disableStringRefs = false;

export const disableLegacyMode = false;

// Flow magic to verify the exports of this file match the original version.
((((null: any): ExportsType): FeatureFlagsType): ExportsType);
