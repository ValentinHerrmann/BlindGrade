declare module 'argon2-browser' {
  export interface Argon2Result {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
  }

  export function hash(options: {
    pass: string | Uint8Array;
    salt: string | Uint8Array;
    time?: number;
    mem?: number;
    hashLen?: number;
    parallelism?: number;
    type?: number;
  }): Promise<Argon2Result>;
}
