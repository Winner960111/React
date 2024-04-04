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
let ReactDOM;
let ReactDOMFizzServer;

describe('react-dom-server-rendering-stub', () => {
  beforeEach(() => {
    jest.mock('react-dom', () => require('react-dom/server-rendering-stub'));

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMFizzServer = require('react-dom/server');
  });

  it('exports a version', () => {
    expect(ReactDOM.version).toBeTruthy();
  });

  it('exports that are expected to be client only in the future are not exported', () => {
    expect(ReactDOM.createRoot).toBe(undefined);
    expect(ReactDOM.hydrateRoot).toBe(undefined);
    expect(ReactDOM.findDOMNode).toBe(undefined);
    expect(ReactDOM.hydrate).toBe(undefined);
    expect(ReactDOM.render).toBe(undefined);
    expect(ReactDOM.unmountComponentAtNode).toBe(undefined);
    expect(ReactDOM.unstable_createEventHandle).toBe(undefined);
    expect(ReactDOM.unstable_renderSubtreeIntoContainer).toBe(undefined);
    expect(ReactDOM.unstable_runWithPriority).toBe(undefined);
  });

  // @gate enableFloat
  it('provides preload, preloadModule, preinit, and preinitModule exports', async () => {
    function App() {
      ReactDOM.preload('foo', {as: 'style'});
      ReactDOM.preloadModule('foomodule');
      ReactDOM.preinit('bar', {as: 'style'});
      ReactDOM.preinitModule('barmodule');
      return <div>foo</div>;
    }
    const html = ReactDOMFizzServer.renderToString(<App />);
    expect(html).toEqual(
      '<link rel="stylesheet" href="bar" data-precedence="default"/><script src="barmodule" type="module" async=""></script><link rel="preload" href="foo" as="style"/><link rel="modulepreload" href="foomodule"/><div>foo</div>',
    );
  });

  it('provides preconnect and prefetchDNS exports', async () => {
    function App() {
      ReactDOM.preconnect('foo', {crossOrigin: 'use-credentials'});
      ReactDOM.prefetchDNS('bar');
      return <div>foo</div>;
    }
    const html = ReactDOMFizzServer.renderToString(<App />);
    expect(html).toEqual(
      '<link rel="preconnect" href="foo" crossorigin="use-credentials"/><link href="bar" rel="dns-prefetch"/><div>foo</div>',
    );
  });

  it('provides a stub for createPortal', async () => {
    expect(() => {
      ReactDOM.createPortal();
    }).toThrow(
      'createPortal was called on the server. Portals are not currently supported on the server. Update your program to conditionally call createPortal on the client only.',
    );
  });

  it('provides a stub for flushSync', async () => {
    let x = false;
    expect(() => {
      ReactDOM.flushSync(() => (x = true));
    }).toThrow(
      'flushSync was called on the server. This is likely caused by a function being called during render or in module scope that was intended to be called from an effect or event handler. Update your to not call flushSync no the server.',
    );
    expect(x).toBe(false);
  });

  // @gate enableFormActions
  // @gate enableAsyncActions
  it('exports useFormStatus', async () => {
    function App() {
      const {pending} = ReactDOM.useFormStatus();
      return 'Pending: ' + pending;
    }

    const result = await ReactDOMFizzServer.renderToStaticMarkup(<App />);
    expect(result).toEqual('Pending: false');
  });
});
