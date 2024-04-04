/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let Scheduler;
let ReactNoop;
let act;
let assertLog;

describe('ReactFiberRefs', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    ReactNoop = require('react-noop-renderer');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
  });

  test('ref is attached even if there are no other updates (class)', async () => {
    let component;
    class Component extends React.Component {
      shouldComponentUpdate() {
        // This component's output doesn't depend on any props or state
        return false;
      }
      render() {
        Scheduler.log('Render');
        component = this;
        return 'Hi';
      }
    }

    const ref1 = React.createRef();
    const ref2 = React.createRef();
    const root = ReactNoop.createRoot();

    // Mount with ref1 attached
    await act(() => root.render(<Component ref={ref1} />));
    assertLog(['Render']);
    expect(root).toMatchRenderedOutput('Hi');
    expect(ref1.current).toBe(component);
    // ref2 has no value
    expect(ref2.current).toBe(null);

    // Switch to ref2, but don't update anything else.
    await act(() => root.render(<Component ref={ref2} />));
    // The component did not re-render because no props changed.
    assertLog([]);
    expect(root).toMatchRenderedOutput('Hi');
    // But the refs still should have been swapped.
    expect(ref1.current).toBe(null);
    expect(ref2.current).toBe(component);
  });

  test('ref is attached even if there are no other updates (host component)', async () => {
    // This is kind of ailly test because host components never bail out if they
    // receive a new element, and there's no way to update a ref without also
    // updating the props, but adding it here anyway for symmetry with the
    // class case above.
    const ref1 = React.createRef();
    const ref2 = React.createRef();
    const root = ReactNoop.createRoot();

    // Mount with ref1 attached
    await act(() => root.render(<div ref={ref1}>Hi</div>));
    expect(root).toMatchRenderedOutput(<div>Hi</div>);
    expect(ref1.current).not.toBe(null);
    // ref2 has no value
    expect(ref2.current).toBe(null);

    // Switch to ref2, but don't update anything else.
    await act(() => root.render(<div ref={ref2}>Hi</div>));
    expect(root).toMatchRenderedOutput(<div>Hi</div>);
    // But the refs still should have been swapped.
    expect(ref1.current).toBe(null);
    expect(ref2.current).not.toBe(null);
  });

  // @gate enableRefAsProp
  // @gate !disableStringRefs
  test('string ref props are converted to function refs', async () => {
    let refProp;
    function Child({ref}) {
      refProp = ref;
      return <div ref={ref} />;
    }

    let owner;
    class Owner extends React.Component {
      render() {
        owner = this;
        return <Child ref="child" />;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<Owner />));

    // When string refs aren't disabled, and enableRefAsProp is on, string refs
    // the receiving component receives a callback ref, not the original string.
    // This behavior should never be shipped to open source; it's only here to
    // allow Meta to keep using string refs temporarily while they finish
    // migrating their codebase.
    expect(typeof refProp === 'function').toBe(true);
    expect(owner.refs.child.type).toBe('div');
  });

  // @gate disableStringRefs
  test('throw if a string ref is passed to a ref-receiving component', async () => {
    let refProp;
    function Child({ref}) {
      // This component renders successfully because the ref type check does not
      // occur until you pass it to a component that accepts refs.
      //
      // So the div will throw, but not Child.
      refProp = ref;
      return <div ref={ref} />;
    }

    class Owner extends React.Component {
      render() {
        return <Child ref="child" />;
      }
    }

    const root = ReactNoop.createRoot();
    await expect(act(() => root.render(<Owner />))).rejects.toThrow(
      'Expected ref to be a function',
    );
    expect(refProp).toBe('child');
  });
});
