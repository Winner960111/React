'use strict';

jest.mock('shared/ReactFeatureFlags', () => {
  jest.mock(
    'ReactFeatureFlags',
    () => jest.requireActual('shared/forks/ReactFeatureFlags.www-dynamic'),
    {virtual: true}
  );
  const actual = jest.requireActual('shared/forks/ReactFeatureFlags.www');

  // This flag is only used by tests, it should never be set elsewhere.
  actual.forceConcurrentByDefaultForTesting = !__VARIANT__;

  return actual;
});

jest.mock('scheduler/src/SchedulerFeatureFlags', () => {
  const schedulerSrcPath = process.cwd() + '/packages/scheduler';
  jest.mock(
    'SchedulerFeatureFlags',
    () =>
      jest.requireActual(
        schedulerSrcPath + '/src/forks/SchedulerFeatureFlags.www-dynamic'
      ),
    {virtual: true}
  );
  const actual = jest.requireActual(
    schedulerSrcPath + '/src/forks/SchedulerFeatureFlags.www'
  );

  // These flags are not a dynamic on www, but we still want to run
  // tests in both versions.
  actual.enableSchedulerDebugging = __VARIANT__;

  return actual;
});

global.__WWW__ = true;
