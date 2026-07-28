import fs from 'fs';
import path from 'path';

const wasmPath = path.resolve('build/core/busytex/busytex.wasm');

if (fs.existsSync(wasmPath)) {
    console.log('Splitting busytex.wasm...');
    const buffer = fs.readFileSync(wasmPath);
    const half = Math.ceil(buffer.length / 2);
    
    fs.writeFileSync(wasmPath + '.part1', buffer.subarray(0, half));
    fs.writeFileSync(wasmPath + '.part2', buffer.subarray(half));
    
    fs.unlinkSync(wasmPath);
    console.log('Split busytex.wasm successfully and deleted original.');
} else {
    console.log('busytex.wasm not found at', wasmPath);
}
