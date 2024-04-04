/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const url = require('url');
const Module = require('module');

let webpackModuleIdx = 0;
const webpackServerModules = {};
const webpackClientModules = {};
const webpackErroredModules = {};
const webpackServerMap = {};
const webpackClientMap = {};
global.__webpack_require__ = function (id) {
  if (webpackErroredModules[id]) {
    throw webpackErroredModules[id];
  }
  return webpackClientModules[id] || webpackServerModules[id];
};

const previousCompile = Module.prototype._compile;

const register = require('react-server-dom-webpack/node-register');
// Register node compile
register();

const nodeCompile = Module.prototype._compile;

if (previousCompile === nodeCompile) {
  throw new Error(
    'Expected the Node loader to register the _compile extension',
  );
}

Module.prototype._compile = previousCompile;

exports.webpackMap = webpackClientMap;
exports.webpackModules = webpackClientModules;
exports.webpackServerMap = webpackServerMap;
exports.moduleLoading = {
  prefix: '/',
};

exports.clientModuleError = function clientModuleError(moduleError) {
  const idx = '' + webpackModuleIdx++;
  webpackErroredModules[idx] = moduleError;
  const path = url.pathToFileURL(idx).href;
  webpackClientMap[path] = {
    id: idx,
    chunks: [],
    name: '*',
  };
  const mod = {exports: {}};
  nodeCompile.call(mod, '"use client"', idx);
  return mod.exports;
};

exports.clientExports = function clientExports(
  moduleExports,
  chunkId,
  chunkFilename,
) {
  const chunks = [];
  if (chunkId) {
    chunks.push(chunkId, chunkFilename);
  }
  const idx = '' + webpackModuleIdx++;
  webpackClientModules[idx] = moduleExports;
  const path = url.pathToFileURL(idx).href;
  webpackClientMap[path] = {
    id: idx,
    chunks,
    name: '*',
  };
  // We only add this if this test is testing ESM compat.
  if ('__esModule' in moduleExports) {
    webpackClientMap[path + '#'] = {
      id: idx,
      chunks,
      name: '',
    };
  }
  if (typeof moduleExports.then === 'function') {
    moduleExports.then(
      asyncModuleExports => {
        for (const name in asyncModuleExports) {
          webpackClientMap[path + '#' + name] = {
            id: idx,
            chunks,
            name: name,
          };
        }
      },
      () => {},
    );
  }
  if ('split' in moduleExports) {
    // If we're testing module splitting, we encode this name in a separate module id.
    const splitIdx = '' + webpackModuleIdx++;
    webpackClientModules[splitIdx] = {
      s: moduleExports.split,
    };
    webpackClientMap[path + '#split'] = {
      id: splitIdx,
      chunks,
      name: 's',
    };
  }
  const mod = {exports: {}};
  nodeCompile.call(mod, '"use client"', idx);
  return mod.exports;
};

// This tests server to server references. There's another case of client to server references.
exports.serverExports = function serverExports(moduleExports) {
  const idx = '' + webpackModuleIdx++;
  webpackServerModules[idx] = moduleExports;
  const path = url.pathToFileURL(idx).href;
  webpackServerMap[path] = {
    id: idx,
    chunks: [],
    name: '*',
  };
  // We only add this if this test is testing ESM compat.
  if ('__esModule' in moduleExports) {
    webpackServerMap[path + '#'] = {
      id: idx,
      chunks: [],
      name: '',
    };
  }
  if ('split' in moduleExports) {
    // If we're testing module splitting, we encode this name in a separate module id.
    const splitIdx = '' + webpackModuleIdx++;
    webpackServerModules[splitIdx] = {
      s: moduleExports.split,
    };
    webpackServerMap[path + '#split'] = {
      id: splitIdx,
      chunks: [],
      name: 's',
    };
  }
  const mod = {exports: moduleExports};
  nodeCompile.call(mod, '"use server"', idx);
  return mod.exports;
};
