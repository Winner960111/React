/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import typeof * as FeatureFlagsType from 'shared/ReactFeatureFlags';
import typeof * as ExportsType from './ReactFeatureFlags.native-oss';

// -----------------------------------------------------------------------------
// Ready for next major.
//
// Alias __NEXT_MAJOR__ to false for easier skimming.
// -----------------------------------------------------------------------------
const __NEXT_MAJOR__ = false;

export const debugRenderPhaseSideEffectsForStrictMode = __DEV__;
export const enableDebugTracing = false;
export const enableAsyncDebugInfo = false;
export const enableSchedulingProfiler = false;
export const enableProfilerTimer = __PROFILE__;
export const enableProfilerCommitHooks = __PROFILE__;
export const enableProfilerNestedUpdatePhase = __PROFILE__;
export const enableUpdaterTracking = __PROFILE__;
export const enableCache = __NEXT_MAJOR__;
export const enableLegacyCache = false;
export const enableCacheElement = true;
export const enableFetchInstrumentation = false;
export const enableFormActions = true; // Doesn't affect Native
export const enableBinaryFlight = true;
export const enableTaint = true;
export const enablePostpone = false;
export const disableJavaScriptURLs = true;
export const disableCommentsAsDOMContainers = true;
export const disableInputAttributeSyncing = false;
export const disableIEWorkarounds = true;
export const enableScopeAPI = false;
export const enableCreateEventHandleAPI = false;
export const enableSuspenseCallback = false;
export const disableLegacyContext = true;
export const enableTrustedTypesIntegration = false;
export const disableTextareaChildren = false;
export const disableModulePatternComponents = false;
export const enableSuspenseAvoidThisFallback = false;
export const enableSuspenseAvoidThisFallbackFizz = false;
export const enableCPUSuspense = false;
export const enableUseMemoCacheHook = false;
export const enableUseEffectEventHook = false;
export const enableClientRenderFallbackOnTextMismatch = true;
export const enableComponentStackLocations = false;
export const enableLegacyFBSupport = false;
export const enableFilterEmptyStringAttributesDOM = true;
export const enableGetInspectorDataForInstanceInProduction = false;
export const enableRenderableContext = false;

export const enableRetryLaneExpiration = false;
export const retryLaneExpirationMs = 5000;
export const syncLaneExpirationMs = 250;
export const transitionLaneExpirationMs = 5000;

export const enableUseRefAccessWarning = false;

export const disableSchedulerTimeoutInWorkLoop = false;
export const enableLazyContextPropagation = false;
export const enableLegacyHidden = false;
export const forceConcurrentByDefaultForTesting = false;
export const enableUnifiedSyncLane = true;
export const allowConcurrentByDefault = false;
export const enableCustomElementPropertySupport = true;
export const enableNewBooleanProps = true;

export const consoleManagedByDevToolsDuringStrictMode = false;

export const enableTransitionTracing = false;

export const enableFloat = true;

export const useModernStrictMode = false;
export const enableDO_NOT_USE_disableStrictPassiveEffect = false;
export const enableFizzExternalRuntime = true;
export const enableDeferRootSchedulingToMicrotask = false;
export const enableInfiniteRenderLoopDetection = false;

export const enableAsyncActions = false;

export const alwaysThrottleDisappearingFallbacks = false;
export const alwaysThrottleRetries = false;

export const passChildrenWhenCloningPersistedNodes = false;
export const enableUseDeferredValueInitialArg = __EXPERIMENTAL__;
export const disableClientCache = true;

export const enableServerComponentKeys = true;
export const enableServerComponentLogs = true;

// TODO: Should turn this on in next "major" RN release.
export const enableRefAsProp = false;
export const disableStringRefs = false;

export const enableReactTestRendererWarning = false;

export const enableBigIntSupport = false;
export const disableLegacyMode = false;

// Flow magic to verify the exports of this file match the original version.
((((null: any): ExportsType): FeatureFlagsType): ExportsType);
