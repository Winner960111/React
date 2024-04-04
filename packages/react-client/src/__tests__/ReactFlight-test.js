/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

function normalizeCodeLocInfo(str) {
  return (
    str &&
    str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
      return '\n    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
    })
  );
}

const heldValues = [];
let finalizationCallback;
function FinalizationRegistryMock(callback) {
  finalizationCallback = callback;
}
FinalizationRegistryMock.prototype.register = function (target, heldValue) {
  heldValues.push(heldValue);
};
global.FinalizationRegistry = FinalizationRegistryMock;

function gc() {
  for (let i = 0; i < heldValues.length; i++) {
    finalizationCallback(heldValues[i]);
  }
  heldValues.length = 0;
}

let act;
let use;
let startTransition;
let React;
let ReactServer;
let ReactNoop;
let ReactNoopFlightServer;
let ReactNoopFlightClient;
let ErrorBoundary;
let NoErrorExpected;
let Scheduler;
let assertLog;

describe('ReactFlight', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('react', () => require('react/react.react-server'));
    ReactServer = require('react');
    ReactNoopFlightServer = require('react-noop-renderer/flight-server');
    // This stores the state so we need to preserve it
    const flightModules = require('react-noop-renderer/flight-modules');
    __unmockReact();
    jest.resetModules();
    jest.mock('react-noop-renderer/flight-modules', () => flightModules);
    React = require('react');
    startTransition = React.startTransition;
    use = React.use;
    ReactNoop = require('react-noop-renderer');
    ReactNoopFlightClient = require('react-noop-renderer/flight-client');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    ErrorBoundary = class extends React.Component {
      state = {hasError: false, error: null};
      static getDerivedStateFromError(error) {
        return {
          hasError: true,
          error,
        };
      }
      componentDidCatch(error, errorInfo) {
        expect(error).toBe(this.state.error);
        if (this.props.expectedStack !== undefined) {
          expect(normalizeCodeLocInfo(errorInfo.componentStack)).toBe(
            this.props.expectedStack,
          );
        }
      }
      componentDidMount() {
        expect(this.state.hasError).toBe(true);
        expect(this.state.error).toBeTruthy();
        if (__DEV__) {
          expect(this.state.error.message).toContain(
            this.props.expectedMessage,
          );
          expect(this.state.error.digest).toBe('a dev digest');
        } else {
          expect(this.state.error.message).toBe(
            'An error occurred in the Server Components render. The specific message is omitted in production' +
              ' builds to avoid leaking sensitive details. A digest property is included on this error instance which' +
              ' may provide additional details about the nature of the error.',
          );
          let expectedDigest = this.props.expectedMessage;
          if (
            expectedDigest.startsWith('{') ||
            expectedDigest.startsWith('<')
          ) {
            expectedDigest = '{}';
          } else if (expectedDigest.startsWith('[')) {
            expectedDigest = '[]';
          }
          expect(this.state.error.digest).toContain(expectedDigest);
          expect(this.state.error.stack).toBe(
            'Error: ' + this.state.error.message,
          );
        }
      }
      render() {
        if (this.state.hasError) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    };

    NoErrorExpected = class extends React.Component {
      state = {hasError: false, error: null};
      static getDerivedStateFromError(error) {
        return {
          hasError: true,
          error,
        };
      }
      componentDidMount() {
        expect(this.state.error).toBe(null);
        expect(this.state.hasError).toBe(false);
      }
      render() {
        if (this.state.hasError) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function clientReference(value) {
    return Object.defineProperties(
      function () {
        throw new Error('Cannot call a client function from the server.');
      },
      {
        $$typeof: {value: Symbol.for('react.client.reference')},
        value: {value: value},
      },
    );
  }

  it('can render a Server Component', async () => {
    function Bar({text}) {
      return text.toUpperCase();
    }
    function Foo() {
      return {
        bar: (
          <div>
            <Bar text="a" />, <Bar text="b" />
          </div>
        ),
      };
    }
    const transport = ReactNoopFlightServer.render({
      foo: <Foo />,
    });
    const model = await ReactNoopFlightClient.read(transport);
    expect(model).toEqual({
      foo: {
        bar: (
          <div>
            {'A'}
            {', '}
            {'B'}
          </div>
        ),
      },
    });
  });

  it('can render a Client Component using a module reference and render there', async () => {
    function UserClient(props) {
      return (
        <span>
          {props.greeting}, {props.name}
        </span>
      );
    }
    const User = clientReference(UserClient);

    function Greeting({firstName, lastName}) {
      return <User greeting="Hello" name={firstName + ' ' + lastName} />;
    }

    const model = {
      greeting: <Greeting firstName="Seb" lastName="Smith" />,
    };

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      const greeting = rootModel.greeting;
      expect(greeting._debugInfo).toEqual(
        __DEV__ ? [{name: 'Greeting', env: 'Server'}] : undefined,
      );
      ReactNoop.render(greeting);
    });

    expect(ReactNoop).toMatchRenderedOutput(<span>Hello, Seb Smith</span>);
  });

  it('can render a shared forwardRef Component', async () => {
    const Greeting = React.forwardRef(function Greeting(
      {firstName, lastName},
      ref,
    ) {
      return (
        <span ref={ref}>
          Hello, {firstName} {lastName}
        </span>
      );
    });

    const root = <Greeting firstName="Seb" lastName="Smith" />;

    const transport = ReactNoopFlightServer.render(root);

    await act(async () => {
      const promise = ReactNoopFlightClient.read(transport);
      expect(promise._debugInfo).toEqual(
        __DEV__ ? [{name: 'Greeting', env: 'Server'}] : undefined,
      );
      ReactNoop.render(await promise);
    });

    expect(ReactNoop).toMatchRenderedOutput(<span>Hello, Seb Smith</span>);
  });

  it('can render an iterable as an array', async () => {
    function ItemListClient(props) {
      return <span>{props.items}</span>;
    }
    const ItemList = clientReference(ItemListClient);

    function Items() {
      const iterable = {
        [Symbol.iterator]: function* () {
          yield 'A';
          yield 'B';
          yield 'C';
        },
      };
      return <ItemList items={iterable} />;
    }

    const model = <Items />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(<span>ABC</span>);
  });

  it('can render undefined', async () => {
    function Undefined() {
      return undefined;
    }

    const model = <Undefined />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  // @gate FIXME
  it('should transport undefined object values', async () => {
    function ServerComponent(props) {
      return 'prop' in props
        ? `\`prop\` in props as '${props.prop}'`
        : '`prop` not in props';
    }
    const ClientComponent = clientReference(ServerComponent);

    const model = (
      <>
        <div>
          Server: <ServerComponent prop={undefined} />
        </div>
        <div>
          Client: <ClientComponent prop={undefined} />
        </div>
      </>
    );

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Server: `prop` in props as 'undefined'</div>
        <div>Client: `prop` in props as 'undefined'</div>
      </>,
    );
  });

  it('can render an empty fragment', async () => {
    function Empty() {
      return <React.Fragment />;
    }

    const model = <Empty />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  it('can transport weird numbers', async () => {
    const nums = [0, -0, Infinity, -Infinity, NaN];
    function ComponentClient({prop}) {
      expect(prop).not.toBe(nums);
      expect(prop).toEqual(nums);
      expect(prop.every((p, i) => Object.is(p, nums[i]))).toBe(true);
      return `prop: ${prop}`;
    }
    const Component = clientReference(ComponentClient);

    const model = <Component prop={nums} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      // already checked -0 with expects above
      'prop: 0,0,Infinity,-Infinity,NaN',
    );
  });

  it('can transport BigInt', async () => {
    function ComponentClient({prop}) {
      return `prop: ${prop} (${typeof prop})`;
    }
    const Component = clientReference(ComponentClient);

    const model = <Component prop={90071992547409910000n} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      'prop: 90071992547409910000 (bigint)',
    );
  });

  it('can transport Date', async () => {
    function ComponentClient({prop}) {
      return `prop: ${prop.toISOString()}`;
    }
    const Component = clientReference(ComponentClient);

    const model = <Component prop={new Date(1234567890123)} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput('prop: 2009-02-13T23:31:30.123Z');
  });

  it('can transport Map', async () => {
    function ComponentClient({prop, selected}) {
      return `
        map: ${prop instanceof Map}
        size: ${prop.size}
        greet: ${prop.get('hi').greet}
        content: ${JSON.stringify(Array.from(prop))}
        selected: ${prop.get(selected)}
      `;
    }
    const Component = clientReference(ComponentClient);

    const objKey = {obj: 'key'};
    const map = new Map([
      ['hi', {greet: 'world'}],
      [objKey, 123],
    ]);
    const model = <Component prop={map} selected={objKey} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(`
        map: true
        size: 2
        greet: world
        content: [["hi",{"greet":"world"}],[{"obj":"key"},123]]
        selected: 123
      `);
  });

  it('can transport Set', async () => {
    function ComponentClient({prop, selected}) {
      return `
        set: ${prop instanceof Set}
        size: ${prop.size}
        hi: ${prop.has('hi')}
        content: ${JSON.stringify(Array.from(prop))}
        selected: ${prop.has(selected)}
      `;
    }
    const Component = clientReference(ComponentClient);

    const objKey = {obj: 'key'};
    const set = new Set(['hi', objKey]);
    const model = <Component prop={set} selected={objKey} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(`
        set: true
        size: 2
        hi: true
        content: ["hi",{"obj":"key"}]
        selected: true
      `);
  });

  it('can transport cyclic objects', async () => {
    function ComponentClient({prop}) {
      expect(prop.obj.obj.obj).toBe(prop.obj.obj);
    }
    const Component = clientReference(ComponentClient);

    const cyclic = {obj: null};
    cyclic.obj = cyclic;
    const model = <Component prop={cyclic} />;

    const transport = ReactNoopFlightServer.render(model);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });
  });

  it('can render a lazy component as a shared component on the server', async () => {
    function SharedComponent({text}) {
      return (
        <div>
          shared<span>{text}</span>
        </div>
      );
    }

    let load = null;
    const loadSharedComponent = () => {
      return new Promise(res => {
        load = () => res({default: SharedComponent});
      });
    };

    const LazySharedComponent = React.lazy(loadSharedComponent);

    function ServerComponent() {
      return (
        <React.Suspense fallback={'Loading...'}>
          <LazySharedComponent text={'a'} />
        </React.Suspense>
      );
    }

    const transport = ReactNoopFlightServer.render(<ServerComponent />);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput('Loading...');
    await load();

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        shared<span>a</span>
      </div>,
    );
  });

  it('errors on a Lazy element being used in Component position', async () => {
    function SharedComponent({text}) {
      return (
        <div>
          shared<span>{text}</span>
        </div>
      );
    }

    let load = null;

    const LazyElementDisguisedAsComponent = React.lazy(() => {
      return new Promise(res => {
        load = () => res({default: <SharedComponent text={'a'} />});
      });
    });

    function ServerComponent() {
      return (
        <React.Suspense fallback={'Loading...'}>
          <LazyElementDisguisedAsComponent text={'b'} />
        </React.Suspense>
      );
    }

    const transport = ReactNoopFlightServer.render(<ServerComponent />);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput('Loading...');
    spyOnDevAndProd(console, 'error').mockImplementation(() => {});
    await load();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('can render a lazy element', async () => {
    function SharedComponent({text}) {
      return (
        <div>
          shared<span>{text}</span>
        </div>
      );
    }

    let load = null;

    const lazySharedElement = React.lazy(() => {
      return new Promise(res => {
        load = () => res({default: <SharedComponent text={'a'} />});
      });
    });

    function ServerComponent() {
      return (
        <React.Suspense fallback={'Loading...'}>
          {lazySharedElement}
        </React.Suspense>
      );
    }

    const transport = ReactNoopFlightServer.render(<ServerComponent />);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput('Loading...');
    await load();

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        shared<span>a</span>
      </div>,
    );
  });

  it('errors with lazy value in element position that resolves to Component', async () => {
    function SharedComponent({text}) {
      return (
        <div>
          shared<span>{text}</span>
        </div>
      );
    }

    let load = null;

    const componentDisguisedAsElement = React.lazy(() => {
      return new Promise(res => {
        load = () => res({default: SharedComponent});
      });
    });

    function ServerComponent() {
      return (
        <React.Suspense fallback={'Loading...'}>
          {componentDisguisedAsElement}
        </React.Suspense>
      );
    }

    const transport = ReactNoopFlightServer.render(<ServerComponent />);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput('Loading...');
    spyOnDevAndProd(console, 'error').mockImplementation(() => {});
    await load();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('can render a lazy module reference', async () => {
    function ClientComponent() {
      return <div>I am client</div>;
    }

    const ClientComponentReference = clientReference(ClientComponent);

    let load = null;
    const loadClientComponentReference = () => {
      return new Promise(res => {
        load = () => res({default: ClientComponentReference});
      });
    };

    const LazyClientComponentReference = React.lazy(
      loadClientComponentReference,
    );

    function ServerComponent() {
      return (
        <React.Suspense fallback={'Loading...'}>
          <LazyClientComponentReference />
        </React.Suspense>
      );
    }

    const transport = ReactNoopFlightServer.render(<ServerComponent />);

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput('Loading...');
    await load();

    await act(async () => {
      const rootModel = await ReactNoopFlightClient.read(transport);
      ReactNoop.render(rootModel);
    });
    expect(ReactNoop).toMatchRenderedOutput(<div>I am client</div>);
  });

  it('should error if a non-serializable value is passed to a host component', async () => {
    function ClientImpl({children}) {
      return children;
    }
    const Client = clientReference(ClientImpl);

    function EventHandlerProp() {
      return (
        <div className="foo" onClick={function () {}}>
          Test
        </div>
      );
    }
    function FunctionProp() {
      return <div>{function fn() {}}</div>;
    }
    function SymbolProp() {
      return <div foo={Symbol('foo')} />;
    }

    const ref = React.createRef();
    function RefProp() {
      return <div ref={ref} />;
    }

    function EventHandlerPropClient() {
      return (
        <Client className="foo" onClick={function () {}}>
          Test
        </Client>
      );
    }
    function FunctionChildrenClient() {
      return <Client>{function Component() {}}</Client>;
    }
    function FunctionPropClient() {
      return <Client foo={() => {}} />;
    }
    function SymbolPropClient() {
      return <Client foo={Symbol('foo')} />;
    }

    function RefPropClient() {
      return <Client ref={ref} />;
    }

    const options = {
      onError(x) {
        return __DEV__ ? 'a dev digest' : `digest("${x.message}")`;
      },
    };
    const event = ReactNoopFlightServer.render(<EventHandlerProp />, options);
    const fn = ReactNoopFlightServer.render(<FunctionProp />, options);
    const symbol = ReactNoopFlightServer.render(<SymbolProp />, options);
    const refs = ReactNoopFlightServer.render(<RefProp />, options);
    const eventClient = ReactNoopFlightServer.render(
      <EventHandlerPropClient />,
      options,
    );
    const fnChildrenClient = ReactNoopFlightServer.render(
      <FunctionChildrenClient />,
      options,
    );
    const fnClient = ReactNoopFlightServer.render(
      <FunctionPropClient />,
      options,
    );
    const symbolClient = ReactNoopFlightServer.render(
      <SymbolPropClient />,
      options,
    );
    const refsClient = ReactNoopFlightServer.render(<RefPropClient />, options);

    function Render({promise}) {
      return use(promise);
    }

    await act(() => {
      startTransition(() => {
        ReactNoop.render(
          <>
            <ErrorBoundary expectedMessage="Event handlers cannot be passed to Client Component props.">
              <Render promise={ReactNoopFlightClient.read(event)} />
            </ErrorBoundary>
            <ErrorBoundary
              expectedMessage={
                __DEV__
                  ? 'Functions are not valid as a child of Client Components. This may happen if you return fn instead of <fn /> from render. Or maybe you meant to call this function rather than return it.'
                  : 'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".'
              }>
              <Render promise={ReactNoopFlightClient.read(fn)} />
            </ErrorBoundary>
            <ErrorBoundary expectedMessage="Only global symbols received from Symbol.for(...) can be passed to Client Components.">
              <Render promise={ReactNoopFlightClient.read(symbol)} />
            </ErrorBoundary>
            <ErrorBoundary expectedMessage="Refs cannot be used in Server Components, nor passed to Client Components.">
              <Render promise={ReactNoopFlightClient.read(refs)} />
            </ErrorBoundary>
            <ErrorBoundary expectedMessage="Event handlers cannot be passed to Client Component props.">
              <Render promise={ReactNoopFlightClient.read(eventClient)} />
            </ErrorBoundary>
            <ErrorBoundary
              expectedMessage={
                __DEV__
                  ? 'Functions are not valid as a child of Client Components. This may happen if you return Component instead of <Component /> from render. Or maybe you meant to call this function rather than return it.'
                  : 'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".'
              }>
              <Render promise={ReactNoopFlightClient.read(fnChildrenClient)} />
            </ErrorBoundary>
            <ErrorBoundary
              expectedMessage={
                'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".'
              }>
              <Render promise={ReactNoopFlightClient.read(fnClient)} />
            </ErrorBoundary>
            <ErrorBoundary expectedMessage="Only global symbols received from Symbol.for(...) can be passed to Client Components.">
              <Render promise={ReactNoopFlightClient.read(symbolClient)} />
            </ErrorBoundary>
            <ErrorBoundary expectedMessage="Refs cannot be used in Server Components, nor passed to Client Components.">
              <Render promise={ReactNoopFlightClient.read(refsClient)} />
            </ErrorBoundary>
          </>,
        );
      });
    });
  });

  it('should emit descriptions of errors in dev', async () => {
    const ClientErrorBoundary = clientReference(ErrorBoundary);

    function Throw({value}) {
      throw value;
    }

    const testCases = (
      <>
        <ClientErrorBoundary expectedMessage="This is a real Error.">
          <div>
            <Throw value={new TypeError('This is a real Error.')} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="This is a string error.">
          <div>
            <Throw value="This is a string error." />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="{message: ..., extra: ..., nested: ...}">
          <div>
            <Throw
              value={{
                message: 'This is a long message',
                extra: 'properties',
                nested: {more: 'prop'},
              }}
            />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary
          expectedMessage={'{message: "Short", extra: ..., nested: ...}'}>
          <div>
            <Throw
              value={{
                message: 'Short',
                extra: 'properties',
                nested: {more: 'prop'},
              }}
            />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="Symbol(hello)">
          <div>
            <Throw value={Symbol('hello')} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="123">
          <div>
            <Throw value={123} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="undefined">
          <div>
            <Throw value={undefined} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="<div/>">
          <div>
            <Throw value={<div />} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage="function Foo() {}">
          <div>
            <Throw value={function Foo() {}} />
          </div>
        </ClientErrorBoundary>
        <ClientErrorBoundary expectedMessage={'["array"]'}>
          <div>
            <Throw value={['array']} />
          </div>
        </ClientErrorBoundary>
      </>
    );

    const transport = ReactNoopFlightServer.render(testCases, {
      onError(x) {
        if (__DEV__) {
          return 'a dev digest';
        }
        if (x instanceof Error) {
          return `digest("${x.message}")`;
        } else if (Array.isArray(x)) {
          return `digest([])`;
        } else if (typeof x === 'object' && x !== null) {
          return `digest({})`;
        }
        return `digest(${String(x)})`;
      },
    });

    await act(() => {
      startTransition(() => {
        ReactNoop.render(ReactNoopFlightClient.read(transport));
      });
    });
  });

  it('should include server components in error boundary stacks in dev', async () => {
    const ClientErrorBoundary = clientReference(ErrorBoundary);

    function Throw({value}) {
      throw value;
    }

    const expectedStack = __DEV__
      ? // TODO: This should include Throw but it doesn't have a Fiber.
        '\n    in div' + '\n    in ErrorBoundary (at **)' + '\n    in App'
      : '\n    in div' + '\n    in ErrorBoundary (at **)';

    function App() {
      return (
        <ClientErrorBoundary
          expectedMessage="This is a real Error."
          expectedStack={expectedStack}>
          <div>
            <Throw value={new TypeError('This is a real Error.')} />
          </div>
        </ClientErrorBoundary>
      );
    }

    const transport = ReactNoopFlightServer.render(<App />, {
      onError(x) {
        if (__DEV__) {
          return 'a dev digest';
        }
        if (x instanceof Error) {
          return `digest("${x.message}")`;
        } else if (Array.isArray(x)) {
          return `digest([])`;
        } else if (typeof x === 'object' && x !== null) {
          return `digest({})`;
        }
        return `digest(${String(x)})`;
      },
    });

    await act(() => {
      startTransition(() => {
        ReactNoop.render(ReactNoopFlightClient.read(transport));
      });
    });
  });

  it('should include server components in warning stacks', async () => {
    function Component() {
      // Trigger key warning
      return <div>{[<span />]}</div>;
    }
    const ClientComponent = clientReference(Component);

    function Indirection({children}) {
      return children;
    }

    function App() {
      return (
        <Indirection>
          <ClientComponent />
        </Indirection>
      );
    }

    const transport = ReactNoopFlightServer.render(<App />);

    await expect(async () => {
      await act(() => {
        startTransition(() => {
          ReactNoop.render(ReactNoopFlightClient.read(transport));
        });
      });
    }).toErrorDev(
      'Each child in a list should have a unique "key" prop.\n' +
        '\n' +
        'Check the render method of `Component`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Component (at **)\n' +
        '    in Indirection (at **)\n' +
        '    in App (at **)',
    );
  });

  it('should trigger the inner most error boundary inside a Client Component', async () => {
    function ServerComponent() {
      throw new Error('This was thrown in the Server Component.');
    }

    function ClientComponent({children}) {
      // This should catch the error thrown by the Server Component, even though it has already happened.
      // We currently need to wrap it in a div because as it's set up right now, a lazy reference will
      // throw during reconciliation which will trigger the parent of the error boundary.
      // This is similar to how these will suspend the parent if it's a direct child of a Suspense boundary.
      // That's a bug.
      return (
        <ErrorBoundary expectedMessage="This was thrown in the Server Component.">
          <div>{children}</div>
        </ErrorBoundary>
      );
    }

    const ClientComponentReference = clientReference(ClientComponent);

    function Server() {
      return (
        <ClientComponentReference>
          <ServerComponent />
        </ClientComponentReference>
      );
    }

    const data = ReactNoopFlightServer.render(<Server />, {
      onError(x) {
        // ignore
      },
    });

    function Client({promise}) {
      return use(promise);
    }

    await act(() => {
      startTransition(() => {
        ReactNoop.render(
          <NoErrorExpected>
            <Client promise={ReactNoopFlightClient.read(data)} />
          </NoErrorExpected>,
        );
      });
    });
  });

  it('should warn in DEV if a toJSON instance is passed to a host component', () => {
    const obj = {
      toJSON() {
        return 123;
      },
    };
    expect(() => {
      const transport = ReactNoopFlightServer.render(<input value={obj} />);
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Objects with toJSON methods are not supported. ' +
        'Convert it manually to a simple value before passing it to props.\n' +
        '  <input value={{toJSON: ...}}>\n' +
        '               ^^^^^^^^^^^^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a toJSON instance is passed to a host component child', () => {
    class MyError extends Error {
      toJSON() {
        return 123;
      }
    }
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <div>Womp womp: {new MyError('spaghetti')}</div>,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Error objects cannot be rendered as text children. Try formatting it using toString().\n' +
        '  <div>Womp womp: {Error}</div>\n' +
        '                  ^^^^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a special object is passed to a host component', () => {
    expect(() => {
      const transport = ReactNoopFlightServer.render(<input value={Math} />);
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Math objects are not supported.\n' +
        '  <input value={Math}>\n' +
        '               ^^^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if an object with symbols is passed to a host component', () => {
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <input value={{[Symbol.iterator]: {}}} />,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Objects with symbol properties like Symbol.iterator are not supported.',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a toJSON instance is passed to a Client Component', () => {
    const obj = {
      toJSON() {
        return 123;
      },
    };
    function ClientImpl({value}) {
      return <div>{value}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(<Client value={obj} />);
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Objects with toJSON methods are not supported.',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a toJSON instance is passed to a Client Component child', () => {
    const obj = {
      toJSON() {
        return 123;
      },
    };
    function ClientImpl({children}) {
      return <div>{children}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <Client>Current date: {obj}</Client>,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Objects with toJSON methods are not supported. ' +
        'Convert it manually to a simple value before passing it to props.\n' +
        '  <>Current date: {{toJSON: ...}}</>\n' +
        '                  ^^^^^^^^^^^^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a special object is passed to a Client Component', () => {
    function ClientImpl({value}) {
      return <div>{value}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(<Client value={Math} />);
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Math objects are not supported.\n' +
        '  <... value={Math}>\n' +
        '             ^^^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if an object with symbols is passed to a Client Component', () => {
    function ClientImpl({value}) {
      return <div>{value}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <Client value={{[Symbol.iterator]: {}}} />,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Objects with symbol properties like Symbol.iterator are not supported.',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a special object is passed to a nested object in Client Component', () => {
    function ClientImpl({value}) {
      return <div>{value}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <Client value={{hello: Math, title: <h1>hi</h1>}} />,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Math objects are not supported.\n' +
        '  {hello: Math, title: <h1/>}\n' +
        '          ^^^^',
      {withoutStack: true},
    );
  });

  it('should warn in DEV if a special object is passed to a nested array in Client Component', () => {
    function ClientImpl({value}) {
      return <div>{value}</div>;
    }
    const Client = clientReference(ClientImpl);
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <Client
          value={['looooong string takes up noise', Math, <h1>hi</h1>]}
        />,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Only plain objects can be passed to Client Components from Server Components. ' +
        'Math objects are not supported.\n' +
        '  [..., Math, <h1/>]\n' +
        '        ^^^^',
      {withoutStack: true},
    );
  });

  it('should NOT warn in DEV for key getters', () => {
    const transport = ReactNoopFlightServer.render(<div key="a" />);
    ReactNoopFlightClient.read(transport);
  });

  it('should warn in DEV a child is missing keys', () => {
    function ParentClient({children}) {
      return children;
    }
    const Parent = clientReference(ParentClient);
    expect(() => {
      const transport = ReactNoopFlightServer.render(
        <Parent>{Array(6).fill(<div>no key</div>)}</Parent>,
      );
      ReactNoopFlightClient.read(transport);
    }).toErrorDev(
      'Each child in a list should have a unique "key" prop. ' +
        'See https://react.dev/link/warning-keys for more information.',
    );
  });

  it('should error if a class instance is passed to a host component', () => {
    class Foo {
      method() {}
    }
    const errors = [];
    ReactNoopFlightServer.render(<input value={new Foo()} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual([
      'Only plain objects, and a few built-ins, can be passed to Client Components ' +
        'from Server Components. Classes or null prototypes are not supported.',
    ]);
  });

  it('should error if useContext is called()', () => {
    function ServerComponent() {
      return ReactServer.useContext();
    }
    const errors = [];
    ReactNoopFlightServer.render(<ServerComponent />, {
      onError(x) {
        errors.push(x.message);
      },
    });
    expect(errors).toEqual(['ReactServer.useContext is not a function']);
  });

  it('should error if a context without a client reference is passed to use()', () => {
    const Context = React.createContext();
    function ServerComponent() {
      return ReactServer.use(Context);
    }
    const errors = [];
    ReactNoopFlightServer.render(<ServerComponent />, {
      onError(x) {
        errors.push(x.message);
      },
    });
    expect(errors).toEqual([
      'Cannot read a Client Context from a Server Component.',
    ]);
  });

  it('should error if a client reference is passed to use()', () => {
    const Context = React.createContext();
    const ClientContext = clientReference(Context);
    function ServerComponent() {
      return ReactServer.use(ClientContext);
    }
    const errors = [];
    ReactNoopFlightServer.render(<ServerComponent />, {
      onError(x) {
        errors.push(x.message);
      },
    });
    expect(errors).toEqual([
      'Cannot read a Client Context from a Server Component.',
    ]);
  });

  describe('Hooks', () => {
    function DivWithId({children}) {
      const id = ReactServer.useId();
      return <div prop={id}>{children}</div>;
    }

    it('should support useId', async () => {
      function App() {
        return (
          <>
            <DivWithId />
            <DivWithId />
          </>
        );
      }

      const transport = ReactNoopFlightServer.render(<App />);
      await act(async () => {
        ReactNoop.render(await ReactNoopFlightClient.read(transport));
      });
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div prop=":S1:" />
          <div prop=":S2:" />
        </>,
      );
    });

    it('accepts an identifier prefix that prefixes generated ids', async () => {
      function App() {
        return (
          <>
            <DivWithId />
            <DivWithId />
          </>
        );
      }

      const transport = ReactNoopFlightServer.render(<App />, {
        identifierPrefix: 'foo',
      });
      await act(async () => {
        ReactNoop.render(await ReactNoopFlightClient.read(transport));
      });
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div prop=":fooS1:" />
          <div prop=":fooS2:" />
        </>,
      );
    });

    it('[TODO] it does not warn if you render a server element passed to a client module reference twice on the client when using useId', async () => {
      // @TODO Today if you render a Server Component with useId and pass it to a Client Component and that Client Component renders the element in two or more
      // places the id used on the server will be duplicated in the client. This is a deviation from the guarantees useId makes for Fizz/Client and is a consequence
      // of the fact that the Server Component is actually rendered on the server and is reduced to a set of host elements before being passed to the Client component
      // so the output passed to the Client has no knowledge of the useId use. In the future we would like to add a DEV warning when this happens. For now
      // we just accept that it is a nuance of useId in Flight
      function App() {
        const id = ReactServer.useId();
        const div = <div prop={id}>{id}</div>;
        return <ClientDoublerModuleRef el={div} />;
      }

      function ClientDoubler({el}) {
        Scheduler.log('ClientDoubler');
        return (
          <>
            {el}
            {el}
          </>
        );
      }

      const ClientDoublerModuleRef = clientReference(ClientDoubler);

      const transport = ReactNoopFlightServer.render(<App />);
      assertLog([]);

      await act(async () => {
        ReactNoop.render(await ReactNoopFlightClient.read(transport));
      });

      assertLog(['ClientDoubler']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div prop=":S1:">:S1:</div>
          <div prop=":S1:">:S1:</div>
        </>,
      );
    });
  });

  // @gate enableTaint
  it('errors when a tainted object is serialized', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    const user = {
      name: 'Seb',
      age: 'rather not say',
    };
    ReactServer.experimental_taintObjectReference(
      "Don't pass the raw user object to the client",
      user,
    );
    const errors = [];
    ReactNoopFlightServer.render(<User user={user} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual(["Don't pass the raw user object to the client"]);
  });

  // @gate enableTaint
  it('errors with a specific message when a tainted function is serialized', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    function change() {}
    ReactServer.experimental_taintObjectReference(
      'A change handler cannot be passed to a client component',
      change,
    );
    const errors = [];
    ReactNoopFlightServer.render(<User onChange={change} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual([
      'A change handler cannot be passed to a client component',
    ]);
  });

  // @gate enableTaint
  it('errors when a tainted string is serialized', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    const process = {
      env: {
        SECRET: '3e971ecc1485fe78625598bf9b6f85db',
      },
    };
    ReactServer.experimental_taintUniqueValue(
      'Cannot pass a secret token to the client',
      process,
      process.env.SECRET,
    );

    const errors = [];
    ReactNoopFlightServer.render(<User token={process.env.SECRET} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual(['Cannot pass a secret token to the client']);

    // This just ensures the process object is kept alive for the life time of
    // the test since we're simulating a global as an example.
    expect(process.env.SECRET).toBe('3e971ecc1485fe78625598bf9b6f85db');
  });

  // @gate enableTaint
  it('errors when a tainted bigint is serialized', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    const currentUser = {
      name: 'Seb',
      token: BigInt('0x3e971ecc1485fe78625598bf9b6f85dc'),
    };
    ReactServer.experimental_taintUniqueValue(
      'Cannot pass a secret token to the client',
      currentUser,
      currentUser.token,
    );

    function App({user}) {
      return <User token={user.token} />;
    }

    const errors = [];
    ReactNoopFlightServer.render(<App user={currentUser} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual(['Cannot pass a secret token to the client']);
  });

  // @gate enableTaint && enableBinaryFlight
  it('errors when a tainted binary value is serialized', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    const currentUser = {
      name: 'Seb',
      token: new Uint32Array([0x3e971ecc, 0x1485fe78, 0x625598bf, 0x9b6f85dd]),
    };
    ReactServer.experimental_taintUniqueValue(
      'Cannot pass a secret token to the client',
      currentUser,
      currentUser.token,
    );

    function App({user}) {
      const clone = user.token.slice();
      return <User token={clone} />;
    }

    const errors = [];
    ReactNoopFlightServer.render(<App user={currentUser} />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual(['Cannot pass a secret token to the client']);
  });

  // @gate enableTaint
  it('keep a tainted value tainted until the end of any pending requests', async () => {
    function UserClient({user}) {
      return <span>{user.name}</span>;
    }
    const User = clientReference(UserClient);

    function getUser() {
      const user = {
        name: 'Seb',
        token: '3e971ecc1485fe78625598bf9b6f85db',
      };
      ReactServer.experimental_taintUniqueValue(
        'Cannot pass a secret token to the client',
        user,
        user.token,
      );
      return user;
    }

    function App() {
      const user = getUser();
      const derivedValue = {...user};
      // A garbage collection can happen at any time. Even before the end of
      // this request. This would clean up the user object.
      gc();
      // We should still block the tainted value.
      return <User user={derivedValue} />;
    }

    let errors = [];
    ReactNoopFlightServer.render(<App />, {
      onError(x) {
        errors.push(x.message);
      },
    });

    expect(errors).toEqual(['Cannot pass a secret token to the client']);

    // After the previous requests finishes, the token can be rendered again.

    errors = [];
    ReactNoopFlightServer.render(
      <User user={{token: '3e971ecc1485fe78625598bf9b6f85db'}} />,
      {
        onError(x) {
          errors.push(x.message);
        },
      },
    );

    expect(errors).toEqual([]);
  });

  // @gate enableServerComponentKeys
  it('preserves state when keying a server component', async () => {
    function StatefulClient({name}) {
      const [state] = React.useState(name.toLowerCase());
      return state;
    }
    const Stateful = clientReference(StatefulClient);

    function Item({item}) {
      return (
        <div>
          {item}
          <Stateful name={item} />
        </div>
      );
    }

    function Items({items}) {
      return items.map(item => {
        return <Item key={item} item={item} />;
      });
    }

    const transport = ReactNoopFlightServer.render(
      <Items items={['A', 'B', 'C']} />,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Aa</div>
        <div>Bb</div>
        <div>Cc</div>
      </>,
    );

    const transport2 = ReactNoopFlightServer.render(
      <Items items={['B', 'A', 'D', 'C']} />,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport2));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Bb</div>
        <div>Aa</div>
        <div>Dd</div>
        <div>Cc</div>
      </>,
    );
  });

  // @gate enableServerComponentKeys
  it('does not inherit keys of children inside a server component', async () => {
    function StatefulClient({name, initial}) {
      const [state] = React.useState(initial);
      return state;
    }
    const Stateful = clientReference(StatefulClient);

    function Item({item, initial}) {
      // This key is the key of the single item of this component.
      // It's NOT part of the key of the list the parent component is
      // in.
      return (
        <div key={item}>
          {item}
          <Stateful name={item} initial={initial} />
        </div>
      );
    }

    function IndirectItem({item, initial}) {
      // Even though we render two items with the same child key this key
      // should not conflict, because the key belongs to the parent slot.
      return <Item key="parent" item={item} initial={initial} />;
    }

    // These items don't have their own keys because they're in a fixed set
    const transport = ReactNoopFlightServer.render(
      <>
        <Item item="A" initial={1} />
        <Item item="B" initial={2} />
        <IndirectItem item="C" initial={5} />
        <IndirectItem item="C" initial={6} />
      </>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>A1</div>
        <div>B2</div>
        <div>C5</div>
        <div>C6</div>
      </>,
    );

    // This means that they shouldn't swap state when the properties update
    const transport2 = ReactNoopFlightServer.render(
      <>
        <Item item="B" initial={3} />
        <Item item="A" initial={4} />
        <IndirectItem item="C" initial={7} />
        <IndirectItem item="C" initial={8} />
      </>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport2));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>B3</div>
        <div>A4</div>
        <div>C5</div>
        <div>C6</div>
      </>,
    );
  });

  // @gate enableServerComponentKeys
  it('shares state between single return and array return in a parent', async () => {
    function StatefulClient({name, initial}) {
      const [state] = React.useState(initial);
      return state;
    }
    const Stateful = clientReference(StatefulClient);

    function Item({item, initial}) {
      // This key is the key of the single item of this component.
      // It's NOT part of the key of the list the parent component is
      // in.
      return (
        <span key={item}>
          {item}
          <Stateful name={item} initial={initial} />
        </span>
      );
    }

    function Condition({condition}) {
      if (condition) {
        return <Item item="A" initial={1} />;
      }
      // The first item in the fragment is the same as the single item.
      return (
        <>
          <Item item="A" initial={2} />
          <Item item="B" initial={3} />
        </>
      );
    }

    function ConditionPlain({condition}) {
      if (condition) {
        return (
          <span>
            C
            <Stateful name="C" initial={1} />
          </span>
        );
      }
      // The first item in the fragment is the same as the single item.
      return (
        <>
          <span>
            C
            <Stateful name="C" initial={2} />
          </span>
          <span>
            D
            <Stateful name="D" initial={3} />
          </span>
        </>
      );
    }

    const transport = ReactNoopFlightServer.render(
      // This two item wrapper ensures we're already one step inside an array.
      // A single item is not the same as a set when it's nested one level.
      <>
        <div>
          <Condition condition={true} />
        </div>
        <div>
          <ConditionPlain condition={true} />
        </div>
        <div key="keyed">
          <ConditionPlain condition={true} />
        </div>
      </>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>A1</span>
        </div>
        <div>
          <span>C1</span>
        </div>
        <div>
          <span>C1</span>
        </div>
      </>,
    );

    const transport2 = ReactNoopFlightServer.render(
      <>
        <div>
          <Condition condition={false} />
        </div>
        <div>
          <ConditionPlain condition={false} />
        </div>
        {null}
        <div key="keyed">
          <ConditionPlain condition={false} />
        </div>
      </>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport2));
    });

    // We're intentionally breaking from the semantics here for efficiency of the protocol.
    // In the case a Server Component inside a fragment is itself implicitly keyed but its
    // return value has a key, then we need a wrapper fragment. This means they can't
    // reconcile. To solve this we would need to add a wrapper fragment to every Server
    // Component just in case it returns a fragment later which is a lot.
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>A2{/* This should be A1 ideally */}</span>
          <span>B3</span>
        </div>
        <div>
          <span>C1</span>
          <span>D3</span>
        </div>
        <div>
          <span>C1</span>
          <span>D3</span>
        </div>
      </>,
    );
  });

  it('shares state between single return and array return in a set', async () => {
    function StatefulClient({name, initial}) {
      const [state] = React.useState(initial);
      return state;
    }
    const Stateful = clientReference(StatefulClient);

    function Item({item, initial}) {
      // This key is the key of the single item of this component.
      // It's NOT part of the key of the list the parent component is
      // in.
      return (
        <span key={item}>
          {item}
          <Stateful name={item} initial={initial} />
        </span>
      );
    }

    function Condition({condition}) {
      if (condition) {
        return <Item item="A" initial={1} />;
      }
      // The first item in the fragment is the same as the single item.
      return (
        <>
          <Item item="A" initial={2} />
          <Item item="B" initial={3} />
        </>
      );
    }

    function ConditionPlain({condition}) {
      if (condition) {
        return (
          <span>
            C
            <Stateful name="C" initial={1} />
          </span>
        );
      }
      // The first item in the fragment is the same as the single item.
      return (
        <>
          <span>
            C
            <Stateful name="C" initial={2} />
          </span>
          <span>
            D
            <Stateful name="D" initial={3} />
          </span>
        </>
      );
    }

    const transport = ReactNoopFlightServer.render(
      // This two item wrapper ensures we're already one step inside an array.
      // A single item is not the same as a set when it's nested one level.
      <div>
        <Condition condition={true} />
        <ConditionPlain condition={true} />
        <ConditionPlain key="keyed" condition={true} />
      </div>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>A1</span>
        <span>C1</span>
        <span>C1</span>
      </div>,
    );

    const transport2 = ReactNoopFlightServer.render(
      <div>
        <Condition condition={false} />
        <ConditionPlain condition={false} />
        {null}
        <ConditionPlain key="keyed" condition={false} />
      </div>,
    );

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport2));
    });

    // We're intentionally breaking from the semantics here for efficiency of the protocol.
    // The issue with this test scenario is that when the Server Component is in a set,
    // the next slot can't be conditionally a fragment or single. That would require wrapping
    // in an additional fragment for every single child just in case it every expands to a
    // fragment.
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>A2{/* Should be A1 */}</span>
        <span>B3</span>
        <span>C2{/* Should be C1 */}</span>
        <span>D3</span>
        <span>C2{/* Should be C1 */}</span>
        <span>D3</span>
      </div>,
    );
  });

  // @gate enableServerComponentKeys
  it('preserves state with keys split across async work', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));

    function StatefulClient({name}) {
      const [state] = React.useState(name.toLowerCase());
      return state;
    }
    const Stateful = clientReference(StatefulClient);

    function Item({name}) {
      if (name === 'A') {
        return promise.then(() => (
          <div>
            {name}
            <Stateful name={name} />
          </div>
        ));
      }
      return (
        <div>
          {name}
          <Stateful name={name} />
        </div>
      );
    }

    const transport = ReactNoopFlightServer.render([
      <Item key="a" name="A" />,
      null,
    ]);

    // Create a gap in the stream
    await resolve();

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport));
    });

    expect(ReactNoop).toMatchRenderedOutput(<div>Aa</div>);

    const transport2 = ReactNoopFlightServer.render([
      null,
      <Item key="a" name="B" />,
    ]);

    await act(async () => {
      ReactNoop.render(await ReactNoopFlightClient.read(transport2));
    });

    expect(ReactNoop).toMatchRenderedOutput(<div>Ba</div>);
  });

  it('preserves debug info for server-to-server pass through', async () => {
    function ThirdPartyLazyComponent() {
      return <span>!</span>;
    }

    const lazy = React.lazy(async () => ({
      default: <ThirdPartyLazyComponent />,
    }));

    function ThirdPartyComponent() {
      return <span>stranger</span>;
    }

    function ServerComponent({transport}) {
      // This is a Server Component that receives other Server Components from a third party.
      const children = ReactNoopFlightClient.read(transport);
      return <div>Hello, {children}</div>;
    }

    const promiseComponent = Promise.resolve(<ThirdPartyComponent />);

    const thirdPartyTransport = ReactNoopFlightServer.render(
      [promiseComponent, lazy],
      {
        environmentName: 'third-party',
      },
    );

    // Wait for the lazy component to initialize
    await 0;

    const transport = ReactNoopFlightServer.render(
      <ServerComponent transport={thirdPartyTransport} />,
    );

    await act(async () => {
      const promise = ReactNoopFlightClient.read(transport);
      expect(promise._debugInfo).toEqual(
        __DEV__ ? [{name: 'ServerComponent', env: 'Server'}] : undefined,
      );
      const result = await promise;
      const thirdPartyChildren = await result.props.children[1];
      // We expect the debug info to be transferred from the inner stream to the outer.
      expect(thirdPartyChildren[0]._debugInfo).toEqual(
        __DEV__
          ? [{name: 'ThirdPartyComponent', env: 'third-party'}]
          : undefined,
      );
      expect(thirdPartyChildren[1]._debugInfo).toEqual(
        __DEV__
          ? [{name: 'ThirdPartyLazyComponent', env: 'third-party'}]
          : undefined,
      );
      ReactNoop.render(result);
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        Hello, <span>stranger</span>
        <span>!</span>
      </div>,
    );
  });

  // @gate enableServerComponentLogs && __DEV__
  it('replays logs, but not onError logs', async () => {
    function foo() {
      return 'hello';
    }
    function ServerComponent() {
      console.log('hi', {prop: 123, fn: foo});
      throw new Error('err');
    }

    let transport;
    expect(() => {
      // Reset the modules so that we get a new overridden console on top of the
      // one installed by expect. This ensures that we still emit console.error
      // calls.
      jest.resetModules();
      jest.mock('react', () => require('react/react.react-server'));
      ReactServer = require('react');
      ReactNoopFlightServer = require('react-noop-renderer/flight-server');
      transport = ReactNoopFlightServer.render({root: <ServerComponent />});
    }).toErrorDev('err');

    const log = console.log;
    try {
      console.log = jest.fn();
      // The error should not actually get logged because we're not awaiting the root
      // so it's not thrown but the server log also shouldn't be replayed.
      await ReactNoopFlightClient.read(transport);

      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.log.mock.calls[0][0]).toBe('hi');
      expect(console.log.mock.calls[0][1].prop).toBe(123);
      const loggedFn = console.log.mock.calls[0][1].fn;
      expect(typeof loggedFn).toBe('function');
      expect(loggedFn).not.toBe(foo);
      expect(loggedFn.toString()).toBe(foo.toString());
    } finally {
      console.log = log;
    }
  });
});
