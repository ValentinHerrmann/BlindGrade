/**
 * Client-side LaTeX Compiler.
 *
 * Compiles LaTeX source to PDF bytes.
 * Falls back to server POST /api/v1/compile/latex if WASM compiler is unavailable.
 */

import { api } from '$lib/api/client';

export interface CompileResult {
  pdfBytes: Uint8Array;
  usedFallback: boolean;
  engineUsed: 'server' | 'local';
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

const POOL_SIZE = 2;
const pool: WorkerSlot[] = [];
let msgIdCounter = 0;

function acquireWorker(): WorkerSlot {
  let slot = pool.find(s => !s.busy);
  if (!slot) {
    if (pool.length < POOL_SIZE) {
      const w = new Worker(new URL('./compiler.worker.ts', import.meta.url), {
        type: 'module'
      });
      slot = { worker: w, busy: false };
      pool.push(slot);
    } else {
      slot = pool[msgIdCounter % pool.length];
    }
  }
  return slot;
}

async function compileLocalWasm(latexSource: string, onStatus?: (status: string) => void): Promise<CompileResult> {
  const slot = acquireWorker();
  const w = slot.worker;
  slot.busy = true;
  const id = ++msgIdCounter;
  
  return new Promise<CompileResult>((resolve, reject) => {
    const listener = (e: MessageEvent) => {
      if (e.data.id === id) {
        if (e.data.status) {
          if (onStatus) {
            onStatus(e.data.status);
          }
        } else {
          w.removeEventListener('message', listener);
          slot.busy = false;
          if (e.data.success) {
            resolve({
              pdfBytes: e.data.pdfBytes,
              usedFallback: false,
              engineUsed: 'local'
            });
          } else {
            reject(new Error(e.data.error || "Local compilation failed"));
          }
        }
      }
    };
    w.addEventListener('message', listener);
    w.postMessage({ id, latexSource });
  }).finally(() => {
    slot.busy = false;
  });
}

/**
 * Compile LaTeX string to PDF Uint8Array.
 *
 * @param latexSource Full LaTeX document source string.
 * @param useLocal Whether to compile locally using WebAssembly.
 */
export async function compileLatex(
  latexSource: string,
  useLocal = false,
  onStatus?: (status: string) => void,
  promptFallback = true
): Promise<CompileResult> {
  if (useLocal) {
    try {
      return await compileLocalWasm(latexSource, onStatus);
    } catch (err: any) {
      if (promptFallback && typeof window !== 'undefined' && window.confirm("Local LaTeX compilation failed. Do you want to try compiling on the server?")) {
        const result = await compileOnServer(latexSource);
        return { ...result, usedFallback: true };
      }
      throw err;
    }
  }
  return compileOnServer(latexSource);
}

async function compileOnServer(latexSource: string): Promise<CompileResult> {
  try {
    const pdfBuffer = await api.postJsonForBinary(
      '/compile/latex',
      { latex: latexSource }
    );
    return {
      pdfBytes: new Uint8Array(pdfBuffer),
      usedFallback: false,
      engineUsed: 'server',
    };
  } catch (err: any) {
    throw new Error(`LaTeX Compilation failed: ${err.message || 'Unknown error'}`);
  }
}

