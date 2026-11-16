// Runs src/render/worker.js under Node worker_threads: provides the `self` a browser worker has.
import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: (m, t) => parentPort.postMessage(m, t), set onmessage(fn) { parentPort.on('message', data => fn({ data })); } };
await import('../src/render/worker.js');
