export default {
  hash: async () => {
    throw new Error('Argon2 WASM not available in node test environment');
  },
};
