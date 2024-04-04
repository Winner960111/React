/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// Polyfills for test environment
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.Headers = require('node-fetch').Headers;
global.Request = require('node-fetch').Request;
global.Response = require('node-fetch').Response;

let fetchCount = 0;
async function fetchMock(resource, options) {
  fetchCount++;
  const request = new Request(resource, options);
  return new Response(
    request.method +
      ' ' +
      request.url +
      ' ' +
      JSON.stringify(Array.from(request.headers.entries())),
  );
}

let React;
let ReactServer;
let ReactServerDOMServer;
let ReactServerDOMClient;
let use;
let cache;

describe('ReactFetch', () => {
  beforeEach(() => {
    jest.resetModules();
    fetchCount = 0;
    global.fetch = fetchMock;

    jest.mock('react', () => require('react/react.react-server'));
    jest.mock('react-server-dom-webpack/server', () =>
      require('react-server-dom-webpack/server.browser'),
    );
    require('react-server-dom-webpack/src/__tests__/utils/WebpackMock');
    ReactServerDOMServer = require('react-server-dom-webpack/server');
    ReactServer = require('react');

    jest.resetModules();
    __unmockReact();
    jest.unmock('react-server-dom-webpack/server');
    ReactServerDOMClient = require('react-server-dom-webpack/client');
    React = require('react');
    use = ReactServer.use;
    cache = ReactServer.cache;
  });

  function render(Component) {
    const stream = ReactServerDOMServer.renderToReadableStream(<Component />);
    return ReactServerDOMClient.createFromReadableStream(stream);
  }

  it('can fetch duplicates outside of render', async () => {
    let response = await fetch('world');
    let text = await response.text();
    expect(text).toMatchInlineSnapshot(`"GET world []"`);
    response = await fetch('world');
    text = await response.text();
    expect(text).toMatchInlineSnapshot(`"GET world []"`);
    expect(fetchCount).toBe(2);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe fetches inside of render', async () => {
    function Component() {
      const response = use(fetch('world'));
      const text = use(response.text());
      return text;
    }
    const promise = render(Component);
    expect(await promise).toMatchInlineSnapshot(`"GET world []"`);
    expect(promise._debugInfo).toEqual(
      __DEV__ ? [{name: 'Component', env: 'Server'}] : undefined,
    );
    expect(fetchCount).toBe(1);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe fetches in micro tasks', async () => {
    async function getData() {
      const r1 = await fetch('hello');
      const t1 = await r1.text();
      const r2 = await fetch('world');
      const t2 = await r2.text();
      return t1 + ' ' + t2;
    }
    function Component() {
      return use(getData());
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET hello [] GET world []"`,
    );
    expect(fetchCount).toBe(2);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe cache in micro tasks', async () => {
    const cached = cache(async () => {
      fetchCount++;
      return 'world';
    });
    async function getData() {
      const r1 = await fetch('hello');
      const t1 = await r1.text();
      const t2 = await cached();
      return t1 + ' ' + t2;
    }
    function Component() {
      return use(getData());
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET hello [] world"`,
    );
    expect(fetchCount).toBe(2);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe fetches using Request and not', async () => {
    function Component() {
      const response = use(fetch('world'));
      const text = use(response.text());
      const sameRequest = new Request('world', {method: 'get'});
      const response2 = use(fetch(sameRequest));
      const text2 = use(response2.text());
      return text + ' ' + text2;
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET world [] GET world []"`,
    );
    expect(fetchCount).toBe(1);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe fetches using URL and not', async () => {
    const url = 'http://example.com/';
    function Component() {
      const response = use(fetch(url));
      const text = use(response.text());
      const response2 = use(fetch(new URL(url)));
      const text2 = use(response2.text());
      return text + ' ' + text2;
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET ${url} [] GET ${url} []"`,
    );
    expect(fetchCount).toBe(1);
  });

  it('can opt-out of deduping fetches inside of render with custom signal', async () => {
    const controller = new AbortController();
    function useCustomHook() {
      return use(
        fetch('world', {signal: controller.signal}).then(response =>
          response.text(),
        ),
      );
    }
    function Component() {
      return useCustomHook() + ' ' + useCustomHook();
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET world [] GET world []"`,
    );
    expect(fetchCount).not.toBe(1);
  });

  it('opts out of deduping for POST requests', async () => {
    function useCustomHook() {
      return use(
        fetch('world', {method: 'POST'}).then(response => response.text()),
      );
    }
    function Component() {
      return useCustomHook() + ' ' + useCustomHook();
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"POST world [] POST world []"`,
    );
    expect(fetchCount).not.toBe(1);
  });

  // @gate enableFetchInstrumentation && enableCache
  it('can dedupe fetches using same headers but not different', async () => {
    function Component() {
      const response = use(fetch('world', {headers: {a: 'A'}}));
      const text = use(response.text());
      const sameRequest = new Request('world', {
        headers: new Headers({b: 'B'}),
      });
      const response2 = use(fetch(sameRequest));
      const text2 = use(response2.text());
      return text + ' ' + text2;
    }
    expect(await render(Component)).toMatchInlineSnapshot(
      `"GET world [["a","A"]] GET world [["b","B"]]"`,
    );
    expect(fetchCount).toBe(2);
  });
});
