/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

// This test doesn't really have a good home yet. I'm leaving it here since this
// behavior belongs to the old propTypes system yet is currently implemented
// in the core ReactCompositeComponent. It should technically live in core's
// test suite but I'll leave it here to indicate that this is an issue that
// needs to be fixed.

'use strict';

let PropTypes;
let React;
let ReactDOMClient;
let act;

describe('ReactContextValidator', () => {
  beforeEach(() => {
    jest.resetModules();

    PropTypes = require('prop-types');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  // TODO: This behavior creates a runtime dependency on propTypes. We should
  // ensure that this is not required for ES6 classes with Flow.

  // @gate !disableLegacyContext
  it('should filter out context not in contextTypes', async () => {
    class Component extends React.Component {
      render() {
        return <div />;
      }
    }
    Component.contextTypes = {
      foo: PropTypes.string,
    };

    class ComponentInFooBarContext extends React.Component {
      childRef = React.createRef();

      getChildContext() {
        return {
          foo: 'abc',
          bar: 123,
        };
      }

      render() {
        return <Component ref={this.childRef} />;
      }
    }
    ComponentInFooBarContext.childContextTypes = {
      foo: PropTypes.string,
      bar: PropTypes.number,
    };

    let instance;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentInFooBarContext ref={current => (instance = current)} />,
      );
    });
    expect(instance.childRef.current.context).toEqual({foo: 'abc'});
  });

  // @gate !disableLegacyContext
  it('should pass next context to lifecycles', async () => {
    let componentDidMountContext;
    let componentDidUpdateContext;
    let componentWillReceivePropsContext;
    let componentWillReceivePropsNextContext;
    let componentWillUpdateContext;
    let componentWillUpdateNextContext;
    let constructorContext;
    let renderContext;
    let shouldComponentUpdateContext;
    let shouldComponentUpdateNextContext;

    class Parent extends React.Component {
      getChildContext() {
        return {
          foo: this.props.foo,
          bar: 'bar',
        };
      }
      render() {
        return <Component />;
      }
    }
    Parent.childContextTypes = {
      foo: PropTypes.string.isRequired,
      bar: PropTypes.string.isRequired,
    };

    class Component extends React.Component {
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateContext = this.context;
        shouldComponentUpdateNextContext = nextContext;
        return true;
      }
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      render() {
        renderContext = this.context;
        return <div />;
      }
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      componentDidUpdate() {
        componentDidUpdateContext = this.context;
      }
    }
    Component.contextTypes = {
      foo: PropTypes.string,
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent foo="abc" />);
    });

    expect(constructorContext).toEqual({foo: 'abc'});
    expect(renderContext).toEqual({foo: 'abc'});
    expect(componentDidMountContext).toEqual({foo: 'abc'});
    await act(() => {
      root.render(<Parent foo="def" />);
    });

    expect(componentWillReceivePropsContext).toEqual({foo: 'abc'});
    expect(componentWillReceivePropsNextContext).toEqual({foo: 'def'});
    expect(shouldComponentUpdateContext).toEqual({foo: 'abc'});
    expect(shouldComponentUpdateNextContext).toEqual({foo: 'def'});
    expect(componentWillUpdateContext).toEqual({foo: 'abc'});
    expect(componentWillUpdateNextContext).toEqual({foo: 'def'});
    expect(renderContext).toEqual({foo: 'def'});
    expect(componentDidUpdateContext).toEqual({foo: 'def'});
  });

  // TODO (bvaughn) Remove this test and the associated behavior in the future.
  // It has only been added in Fiber to match the (unintentional) behavior in Stack.
  // @gate !disableLegacyContext || !__DEV__
  it('should warn (but not error) if getChildContext method is missing', async () => {
    class ComponentA extends React.Component {
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      render() {
        return <div />;
      }
    }
    class ComponentB extends React.Component {
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      render() {
        return <div />;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentA />);
      });
    }).toErrorDev(
      'Warning: ComponentA.childContextTypes is specified but there is no ' +
        'getChildContext() method on the instance. You can either define ' +
        'getChildContext() on ComponentA or remove childContextTypes from it.',
    );

    // Warnings should be deduped by component type
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentA />);
    });

    await expect(async () => {
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentB />);
      });
    }).toErrorDev(
      'Warning: ComponentB.childContextTypes is specified but there is no ' +
        'getChildContext() method on the instance. You can either define ' +
        'getChildContext() on ComponentB or remove childContextTypes from it.',
    );
  });

  // TODO (bvaughn) Remove this test and the associated behavior in the future.
  // It has only been added in Fiber to match the (unintentional) behavior in Stack.
  // @gate !disableLegacyContext
  it('should pass parent context if getChildContext method is missing', async () => {
    class ParentContextProvider extends React.Component {
      static childContextTypes = {
        foo: PropTypes.string,
      };
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      render() {
        return <MiddleMissingContext />;
      }
    }

    class MiddleMissingContext extends React.Component {
      static childContextTypes = {
        bar: PropTypes.string.isRequired,
      };
      render() {
        return <ChildContextConsumer />;
      }
    }

    let childContext;
    class ChildContextConsumer extends React.Component {
      render() {
        childContext = this.context;
        return <div />;
      }
    }
    ChildContextConsumer.contextTypes = {
      bar: PropTypes.string.isRequired,
      foo: PropTypes.string.isRequired,
    };

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ParentContextProvider />);
      });
    }).toErrorDev([
      'Warning: MiddleMissingContext.childContextTypes is specified but there is no ' +
        'getChildContext() method on the instance. You can either define getChildContext() ' +
        'on MiddleMissingContext or remove childContextTypes from it.',
    ]);
    expect(childContext.bar).toBeUndefined();
    expect(childContext.foo).toBe('FOO');
  });

  it('should pass next context to lifecycles', async () => {
    let componentDidMountContext;
    let componentDidUpdateContext;
    let componentWillReceivePropsContext;
    let componentWillReceivePropsNextContext;
    let componentWillUpdateContext;
    let componentWillUpdateNextContext;
    let constructorContext;
    let renderContext;
    let shouldComponentUpdateWasCalled = false;

    const Context = React.createContext();

    class Component extends React.Component {
      static contextType = Context;
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateWasCalled = true;
        return true;
      }
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      render() {
        renderContext = this.context;
        return <div />;
      }
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      componentDidUpdate() {
        componentDidUpdateContext = this.context;
      }
    }

    const firstContext = {foo: 123};
    const secondContext = {bar: 456};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Context.Provider value={firstContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(constructorContext).toBe(firstContext);
    expect(renderContext).toBe(firstContext);
    expect(componentDidMountContext).toBe(firstContext);
    await act(() => {
      root.render(
        <Context.Provider value={secondContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(componentWillReceivePropsContext).toBe(firstContext);
    expect(componentWillReceivePropsNextContext).toBe(secondContext);
    expect(componentWillUpdateContext).toBe(firstContext);
    expect(componentWillUpdateNextContext).toBe(secondContext);
    expect(renderContext).toBe(secondContext);
    expect(componentDidUpdateContext).toBe(secondContext);

    if (gate(flags => flags.enableLazyContextPropagation)) {
      expect(shouldComponentUpdateWasCalled).toBe(true);
    } else {
      // sCU is not called in this case because React force updates when a provider re-renders
      expect(shouldComponentUpdateWasCalled).toBe(false);
    }
  });

  it('should re-render PureComponents when context Provider updates', async () => {
    let renderedContext;

    const Context = React.createContext();

    class Component extends React.PureComponent {
      static contextType = Context;
      render() {
        renderedContext = this.context;
        return <div />;
      }
    }

    const firstContext = {foo: 123};
    const secondContext = {bar: 456};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Context.Provider value={firstContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(renderedContext).toBe(firstContext);
    await act(() => {
      root.render(
        <Context.Provider value={secondContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(renderedContext).toBe(secondContext);
  });

  // @gate !disableLegacyContext || !__DEV__
  it('should warn if both contextType and contextTypes are defined', async () => {
    const Context = React.createContext();

    class ParentContextProvider extends React.Component {
      static childContextTypes = {
        foo: PropTypes.string,
      };
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      render() {
        return this.props.children;
      }
    }

    class ComponentA extends React.Component {
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      static contextType = Context;
      render() {
        return <div />;
      }
    }
    class ComponentB extends React.Component {
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      static contextType = Context;
      render() {
        return <div />;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <ParentContextProvider>
            <ComponentA />
          </ParentContextProvider>,
        );
      });
    }).toErrorDev(
      'Warning: ComponentA declares both contextTypes and contextType static properties. ' +
        'The legacy contextTypes property will be ignored.',
    );

    // Warnings should be deduped by component type
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ParentContextProvider>
          <ComponentA />
        </ParentContextProvider>,
      );
    });

    await expect(async () => {
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <ParentContextProvider>
            <ComponentB />
          </ParentContextProvider>,
        );
      });
    }).toErrorDev(
      'Warning: ComponentB declares both contextTypes and contextType static properties. ' +
        'The legacy contextTypes property will be ignored.',
    );
  });

  // @gate enableRenderableContext || !__DEV__
  it('should warn if an invalid contextType is defined', async () => {
    const Context = React.createContext();
    class ComponentA extends React.Component {
      static contextType = Context.Consumer;
      render() {
        return <div />;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentA />);
      });
    }).toErrorDev(
      'Warning: ComponentA defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'Did you accidentally pass the Context.Consumer instead?',
    );

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentA />);
    });

    class ComponentB extends React.Component {
      static contextType = Context.Provider;
      render() {
        return <div />;
      }
    }
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentB />);
    });
  });

  it('should not warn when class contextType is null', async () => {
    class Foo extends React.Component {
      static contextType = null; // Handy for conditional declaration
      render() {
        return this.context.hello.world;
      }
    }
    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrow("Cannot read properties of undefined (reading 'world')");
  });

  it('should warn when class contextType is undefined', async () => {
    class Foo extends React.Component {
      // This commonly happens with circular deps
      // https://github.com/facebook/react/issues/13969
      static contextType = undefined;
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      await expect(async () => {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<Foo />);
        });
      }).rejects.toThrow(
        "Cannot read properties of undefined (reading 'world')",
      );
    }).toErrorDev(
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to undefined. ' +
        'This can be caused by a typo or by mixing up named and default imports. ' +
        'This can also happen due to a circular dependency, ' +
        'so try moving the createContext() call to a separate file.',
    );
  });

  it('should warn when class contextType is an object', async () => {
    class Foo extends React.Component {
      // Can happen due to a typo
      static contextType = {
        x: 42,
        y: 'hello',
      };
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      await expect(async () => {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<Foo />);
        });
      }).rejects.toThrow(
        "Cannot read properties of undefined (reading 'hello')",
      );
    }).toErrorDev(
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to an object with keys {x, y}.',
    );
  });

  it('should warn when class contextType is a primitive', async () => {
    class Foo extends React.Component {
      static contextType = 'foo';
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      await expect(async () => {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<Foo />);
        });
      }).rejects.toThrow(
        "Cannot read properties of undefined (reading 'world')",
      );
    }).toErrorDev(
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to a string.',
    );
  });

  it('should warn if you define contextType on a function component', async () => {
    const Context = React.createContext();

    function ComponentA() {
      return <div />;
    }
    ComponentA.contextType = Context;

    function ComponentB() {
      return <div />;
    }
    ComponentB.contextType = Context;

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentA />);
      });
    }).toErrorDev(
      'Warning: ComponentA: Function components do not support contextType.',
    );

    // Warnings should be deduped by component type
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentA />);
    });

    await expect(async () => {
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentB />);
      });
    }).toErrorDev(
      'Warning: ComponentB: Function components do not support contextType.',
    );
  });
});
