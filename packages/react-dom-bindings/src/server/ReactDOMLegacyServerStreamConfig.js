/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export interface Destination {
  push(chunk: string | null): boolean;
  destroy(error: Error): mixed;
}

export opaque type PrecomputedChunk = string;
export opaque type Chunk = string;
export opaque type BinaryChunk = string;

export function scheduleWork(callback: () => void) {
  callback();
}

export function flushBuffered(destination: Destination) {}

export function beginWriting(destination: Destination) {}

export function writeChunk(
  destination: Destination,
  chunk: Chunk | PrecomputedChunk | BinaryChunk,
): void {
  writeChunkAndReturn(destination, chunk);
}

export function writeChunkAndReturn(
  destination: Destination,
  chunk: Chunk | PrecomputedChunk | BinaryChunk,
): boolean {
  return destination.push(chunk);
}

export function completeWriting(destination: Destination) {}

export function close(destination: Destination) {
  destination.push(null);
}

export function stringToChunk(content: string): Chunk {
  return content;
}

export function stringToPrecomputedChunk(content: string): PrecomputedChunk {
  return content;
}

export function typedArrayToBinaryChunk(
  content: $ArrayBufferView,
): BinaryChunk {
  throw new Error('Not implemented.');
}

export function byteLengthOfChunk(chunk: Chunk | PrecomputedChunk): number {
  throw new Error('Not implemented.');
}

export function byteLengthOfBinaryChunk(chunk: BinaryChunk): number {
  throw new Error('Not implemented.');
}

export function closeWithError(destination: Destination, error: mixed): void {
  // $FlowFixMe[incompatible-call]: This is an Error object or the destination accepts other types.
  destination.destroy(error);
}

export {createFastHashJS as createFastHash} from 'react-server/src/createFastHashJS';
