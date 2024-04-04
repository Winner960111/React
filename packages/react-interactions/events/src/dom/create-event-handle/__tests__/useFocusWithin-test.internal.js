/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {createEventTarget, setPointerEvent} from 'dom-event-testing-library';

let React;
let ReactFeatureFlags;
let ReactDOMClient;
let useFocusWithin;
let act;

function initializeModules(hasPointerEvents) {
  setPointerEvent(hasPointerEvents);
  jest.resetModules();
  ReactFeatureFlags = require('shared/ReactFeatureFlags');
  ReactFeatureFlags.enableScopeAPI = true;
  ReactFeatureFlags.enableCreateEventHandleAPI = true;
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  act = require('internal-test-utils').act;

  // TODO: This import throws outside of experimental mode. Figure out better
  // strategy for gated imports.
  if (__EXPERIMENTAL__ || global.__WWW__) {
    useFocusWithin = require('react-interactions/events/focus').useFocusWithin;
  }
}

const forcePointerEvents = true;
const table = [[forcePointerEvents], [!forcePointerEvents]];

describe.each(table)(`useFocus`, hasPointerEvents => {
  let container;
  let container2;
  let root;

  beforeEach(() => {
    initializeModules(hasPointerEvents);
    container = document.createElement('div');
    document.body.appendChild(container);
    container2 = document.createElement('div');
    document.body.appendChild(container2);
    root = ReactDOMClient.createRoot(container);
  });

  afterEach(async () => {
    await act(() => {
      root.render(null);
    });

    document.body.removeChild(container);
    document.body.removeChild(container2);
    container = null;
    container2 = null;
  });

  describe('disabled', () => {
    let onFocusWithinChange, onFocusWithinVisibleChange, ref;

    const componentInit = async () => {
      onFocusWithinChange = jest.fn();
      onFocusWithinVisibleChange = jest.fn();
      ref = React.createRef();
      const Component = () => {
        const focusWithinRef = useFocusWithin(ref, {
          disabled: true,
          onFocusWithinChange,
          onFocusWithinVisibleChange,
        });
        return <div ref={focusWithinRef} />;
      };
      await act(() => {
        root.render(<Component />);
      });
    };

    // @gate www
    it('prevents custom events being dispatched', async () => {
      await componentInit();
      const target = createEventTarget(ref.current);
      target.focus();
      target.blur();
      expect(onFocusWithinChange).not.toBeCalled();
      expect(onFocusWithinVisibleChange).not.toBeCalled();
    });
  });

  describe('onFocusWithinChange', () => {
    let onFocusWithinChange, ref, innerRef, innerRef2;

    const Component = ({show}) => {
      const focusWithinRef = useFocusWithin(ref, {
        onFocusWithinChange,
      });
      return (
        <div ref={focusWithinRef}>
          {show && <input ref={innerRef} />}
          <div ref={innerRef2} />
        </div>
      );
    };

    const componentInit = async () => {
      onFocusWithinChange = jest.fn();
      ref = React.createRef();
      innerRef = React.createRef();
      innerRef2 = React.createRef();
      await act(() => {
        root.render(<Component show={true} />);
      });
    };

    // @gate www
    it('is called after "blur" and "focus" events on focus target', async () => {
      await componentInit();
      const target = createEventTarget(ref.current);
      target.focus();
      expect(onFocusWithinChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinChange).toHaveBeenCalledWith(true);
      target.blur({relatedTarget: container});
      expect(onFocusWithinChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinChange).toHaveBeenCalledWith(false);
    });

    // @gate www
    it('is called after "blur" and "focus" events on descendants', async () => {
      await componentInit();
      const target = createEventTarget(innerRef.current);
      target.focus();
      expect(onFocusWithinChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinChange).toHaveBeenCalledWith(true);
      target.blur({relatedTarget: container});
      expect(onFocusWithinChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinChange).toHaveBeenCalledWith(false);
    });

    // @gate www
    it('is only called once when focus moves within and outside the subtree', async () => {
      await componentInit();
      const node = ref.current;
      const innerNode1 = innerRef.current;
      const innerNode2 = innerRef.current;
      const target = createEventTarget(node);
      const innerTarget1 = createEventTarget(innerNode1);
      const innerTarget2 = createEventTarget(innerNode2);

      // focus shifts into subtree
      innerTarget1.focus();
      expect(onFocusWithinChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinChange).toHaveBeenCalledWith(true);
      // focus moves around subtree
      innerTarget1.blur({relatedTarget: innerNode2});
      innerTarget2.focus();
      innerTarget2.blur({relatedTarget: node});
      target.focus();
      target.blur({relatedTarget: innerNode1});
      expect(onFocusWithinChange).toHaveBeenCalledTimes(1);
      // focus shifts outside subtree
      innerTarget1.blur({relatedTarget: container});
      expect(onFocusWithinChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinChange).toHaveBeenCalledWith(false);
    });
  });

  describe('onFocusWithinVisibleChange', () => {
    let onFocusWithinVisibleChange, ref, innerRef, innerRef2;

    const Component = ({show}) => {
      const focusWithinRef = useFocusWithin(ref, {
        onFocusWithinVisibleChange,
      });
      return (
        <div ref={focusWithinRef}>
          {show && <input ref={innerRef} />}
          <div ref={innerRef2} />
        </div>
      );
    };

    const componentInit = async () => {
      onFocusWithinVisibleChange = jest.fn();
      ref = React.createRef();
      innerRef = React.createRef();
      innerRef2 = React.createRef();
      await act(() => {
        root.render(<Component show={true} />);
      });
    };

    // @gate www
    it('is called after "focus" and "blur" on focus target if keyboard was used', async () => {
      await componentInit();
      const target = createEventTarget(ref.current);
      const containerTarget = createEventTarget(container);
      // use keyboard first
      containerTarget.keydown({key: 'Tab'});
      target.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(true);
      target.blur({relatedTarget: container});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(false);
    });

    // @gate www
    it('is called after "focus" and "blur" on descendants if keyboard was used', async () => {
      await componentInit();
      const innerTarget = createEventTarget(innerRef.current);
      const containerTarget = createEventTarget(container);
      // use keyboard first
      containerTarget.keydown({key: 'Tab'});
      innerTarget.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(true);
      innerTarget.blur({relatedTarget: container});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(false);
    });

    // @gate www
    it('is called if non-keyboard event is dispatched on target previously focused with keyboard', async () => {
      await componentInit();
      const node = ref.current;
      const innerNode1 = innerRef.current;
      const innerNode2 = innerRef2.current;

      const target = createEventTarget(node);
      const innerTarget1 = createEventTarget(innerNode1);
      const innerTarget2 = createEventTarget(innerNode2);
      // use keyboard first
      target.focus();
      target.keydown({key: 'Tab'});
      target.blur({relatedTarget: innerNode1});
      innerTarget1.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(true);
      // then use pointer on the next target, focus should no longer be visible
      innerTarget2.pointerdown();
      innerTarget1.blur({relatedTarget: innerNode2});
      innerTarget2.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(false);
      // then use keyboard again
      innerTarget2.keydown({key: 'Tab', shiftKey: true});
      innerTarget2.blur({relatedTarget: innerNode1});
      innerTarget1.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(3);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(true);
      // then use pointer on the target, focus should no longer be visible
      innerTarget1.pointerdown();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(4);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(false);
      // onFocusVisibleChange should not be called again
      innerTarget1.blur({relatedTarget: container});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(4);
    });

    // @gate www
    it('is not called after "focus" and "blur" events without keyboard', async () => {
      await componentInit();
      const innerTarget = createEventTarget(innerRef.current);
      innerTarget.pointerdown();
      innerTarget.pointerup();
      innerTarget.blur({relatedTarget: container});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(0);
    });

    // @gate www
    it('is only called once when focus moves within and outside the subtree', async () => {
      await componentInit();
      const node = ref.current;
      const innerNode1 = innerRef.current;
      const innerNode2 = innerRef2.current;
      const target = createEventTarget(node);
      const innerTarget1 = createEventTarget(innerNode1);
      const innerTarget2 = createEventTarget(innerNode2);

      // focus shifts into subtree
      innerTarget1.focus();
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(1);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(true);
      // focus moves around subtree
      innerTarget1.blur({relatedTarget: innerNode2});
      innerTarget2.focus();
      innerTarget2.blur({relatedTarget: node});
      target.focus();
      target.blur({relatedTarget: innerNode1});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(1);
      // focus shifts outside subtree
      innerTarget1.blur({relatedTarget: container});
      expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(2);
      expect(onFocusWithinVisibleChange).toHaveBeenCalledWith(false);
    });
  });

  // @gate www
  it('should correctly handle focus visibility when typing into an input', async () => {
    const onFocusWithinVisibleChange = jest.fn();
    const ref = React.createRef();
    const inputRef = React.createRef();
    const Component = () => {
      const focusWithinRef = useFocusWithin(ref, {
        onFocusWithinVisibleChange,
      });
      return (
        <div ref={focusWithinRef}>
          <input ref={inputRef} type="text" />
        </div>
      );
    };
    await act(() => {
      root.render(<Component />);
    });

    const target = createEventTarget(inputRef.current);
    // focus the target
    target.pointerdown();
    target.focus();
    target.keydown({key: 'a'});
    expect(onFocusWithinVisibleChange).toHaveBeenCalledTimes(0);
  });

  describe('onBeforeBlurWithin', () => {
    let onBeforeBlurWithin, onAfterBlurWithin, ref, innerRef, innerRef2;

    beforeEach(() => {
      onBeforeBlurWithin = jest.fn();
      onAfterBlurWithin = jest.fn(e => {
        e.persist();
      });
      ref = React.createRef();
      innerRef = React.createRef();
      innerRef2 = React.createRef();
    });

    // @gate www
    it('is called after a focused element is unmounted', async () => {
      const Component = ({show}) => {
        const focusWithinRef = useFocusWithin(ref, {
          onBeforeBlurWithin,
          onAfterBlurWithin,
        });
        return (
          <div ref={focusWithinRef}>
            {show && <input ref={innerRef} />}
            <div ref={innerRef2} />
          </div>
        );
      };

      await act(() => {
        root.render(<Component show={true} />);
      });

      const inner = innerRef.current;
      const target = createEventTarget(inner);
      target.keydown({key: 'Tab'});
      target.focus();
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);
      await act(() => {
        root.render(<Component show={false} />);
      });

      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledWith(
        expect.objectContaining({relatedTarget: inner}),
      );
    });

    // @gate www
    it('is called after a nested focused element is unmounted', async () => {
      const Component = ({show}) => {
        const focusWithinRef = useFocusWithin(ref, {
          onBeforeBlurWithin,
          onAfterBlurWithin,
        });
        return (
          <div ref={focusWithinRef}>
            {show && (
              <div>
                <input ref={innerRef} />
              </div>
            )}
            <div ref={innerRef2} />
          </div>
        );
      };

      await act(() => {
        root.render(<Component show={true} />);
      });

      const inner = innerRef.current;
      const target = createEventTarget(inner);
      target.keydown({key: 'Tab'});
      target.focus();
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);

      await act(() => {
        root.render(<Component show={false} />);
      });

      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledWith(
        expect.objectContaining({relatedTarget: inner}),
      );
    });

    // @gate www
    it('is called after many elements are unmounted', async () => {
      const buttonRef = React.createRef();
      const inputRef = React.createRef();

      const Component = ({show}) => {
        const focusWithinRef = useFocusWithin(ref, {
          onBeforeBlurWithin,
          onAfterBlurWithin,
        });
        return (
          <div ref={focusWithinRef}>
            {show && <button>Press me!</button>}
            {show && <button>Press me!</button>}
            {show && <input ref={inputRef} />}
            {show && <button>Press me!</button>}
            {!show && <button ref={buttonRef}>Press me!</button>}
            {show && <button>Press me!</button>}
            <button>Press me!</button>
            <button>Press me!</button>
          </div>
        );
      };

      await act(() => {
        root.render(<Component show={true} />);
      });

      inputRef.current.focus();
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);
      await act(() => {
        root.render(<Component show={false} />);
      });

      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(1);
    });

    // @gate www
    it('is called after a nested focused element is unmounted (with scope query)', async () => {
      const TestScope = React.unstable_Scope;
      const testScopeQuery = (type, props) => true;
      let targetNodes;
      let targetNode;

      const Component = ({show}) => {
        const scopeRef = React.useRef(null);
        const focusWithinRef = useFocusWithin(scopeRef, {
          onBeforeBlurWithin(event) {
            const scope = scopeRef.current;
            targetNode = innerRef.current;
            targetNodes = scope.DO_NOT_USE_queryAllNodes(testScopeQuery);
          },
        });

        return (
          <TestScope ref={focusWithinRef}>
            {show && <input ref={innerRef} />}
          </TestScope>
        );
      };

      await act(() => {
        root.render(<Component show={true} />);
      });

      const inner = innerRef.current;
      const target = createEventTarget(inner);
      target.keydown({key: 'Tab'});
      target.focus();
      await act(() => {
        root.render(<Component show={false} />);
      });
      expect(targetNodes).toEqual([targetNode]);
    });

    // @gate www
    it('is called after a focused suspended element is hidden', async () => {
      const Suspense = React.Suspense;
      let suspend = false;
      let resolve;
      const promise = new Promise(resolvePromise => (resolve = resolvePromise));

      function Child() {
        if (suspend) {
          throw promise;
        } else {
          return <input ref={innerRef} />;
        }
      }

      const Component = ({show}) => {
        const focusWithinRef = useFocusWithin(ref, {
          onBeforeBlurWithin,
          onAfterBlurWithin,
        });

        return (
          <div ref={focusWithinRef}>
            <Suspense fallback="Loading...">
              <Child />
            </Suspense>
          </div>
        );
      };

      const root2 = ReactDOMClient.createRoot(container2);

      await act(() => {
        root2.render(<Component />);
      });
      expect(container2.innerHTML).toBe('<div><input></div>');

      const inner = innerRef.current;
      const target = createEventTarget(inner);
      target.keydown({key: 'Tab'});
      target.focus();
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);

      suspend = true;
      await act(() => {
        root2.render(<Component />);
      });
      expect(container2.innerHTML).toBe(
        '<div><input style="display: none;">Loading...</div>',
      );
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(1);
      await act(() => {
        suspend = false;
        resolve();
      });
      expect(container2.innerHTML).toBe('<div><input style=""></div>');
    });

    // @gate www
    it('is called after a focused suspended element is hidden then shown', async () => {
      const Suspense = React.Suspense;
      let suspend = false;
      let resolve;
      const promise = new Promise(resolvePromise => (resolve = resolvePromise));
      const buttonRef = React.createRef();

      function Child() {
        if (suspend) {
          throw promise;
        } else {
          return <input ref={innerRef} />;
        }
      }

      const Component = ({show}) => {
        const focusWithinRef = useFocusWithin(ref, {
          onBeforeBlurWithin,
          onAfterBlurWithin,
        });

        return (
          <div ref={focusWithinRef}>
            <Suspense fallback={<button ref={buttonRef}>Loading...</button>}>
              <Child />
            </Suspense>
          </div>
        );
      };

      const root2 = ReactDOMClient.createRoot(container2);

      await act(() => {
        root2.render(<Component />);
      });

      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);

      suspend = true;
      await act(() => {
        root2.render(<Component />);
      });
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);

      await act(() => {
        root2.render(<Component />);
      });
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(0);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(0);

      buttonRef.current.focus();
      suspend = false;
      await act(() => {
        root2.render(<Component />);
      });
      expect(onBeforeBlurWithin).toHaveBeenCalledTimes(1);
      expect(onAfterBlurWithin).toHaveBeenCalledTimes(1);

      await act(() => {
        suspend = false;
        resolve();
      });
      expect(container2.innerHTML).toBe('<div><input style=""></div>');
    });
  });
});
