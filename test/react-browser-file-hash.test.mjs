import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/browserFileHash.ts", import.meta.url);

test("browser file hashing is explicitly unavailable without Web Crypto subtle digest", async () => {
  const { canHashFileSha256, hashFileSha256 } = await importHelper();
  const originalCrypto = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    assert.equal(canHashFileSha256(), false);
    await assert.rejects(
      () => hashFileSha256(fakeFile("hello")),
      /Browser SHA-256 hashing is unavailable/,
    );
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("browser file hashing degrades to unavailable when digest fails during duplicate pre-check", async () => {
  const { hashFilesSha256IfAvailable } = await importHelper("digest-failure");
  const originalCrypto = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          digest() {
            throw new TypeError("Cannot read properties of undefined (reading 'digest')");
          },
        },
      },
    });

    assert.equal(await hashFilesSha256IfAvailable([fakeFile("hello")]), null);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("browser file hashing degrades to unavailable when file reads exceed browser limits", async () => {
  const { hashFilesSha256IfAvailable } = await importHelper("range-failure");
  const originalCrypto = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          async digest(_algorithm, buffer) {
            return buffer;
          },
        },
      },
    });

    const result = await hashFilesSha256IfAvailable([{
      async arrayBuffer() {
        throw new RangeError("Cannot create a string longer than 0x1fffffe8 characters");
      },
    }]);

    assert.equal(result, null);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("browser file hashing skips very large selections before reading file bytes", async () => {
  const { hashFilesSha256IfAvailable } = await importHelper("large-files");
  const originalCrypto = globalThis.crypto;
  let readAttempted = false;

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          async digest() {
            throw new Error("digest should not run for oversized browser hash precheck");
          },
        },
      },
    });

    const result = await hashFilesSha256IfAvailable([{
      size: 1024 * 1024 * 1024,
      async arrayBuffer() {
        readAttempted = true;
        return new ArrayBuffer(0);
      },
    }]);

    assert.equal(result, null);
    assert.equal(readAttempted, false);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("browser file hashing reads selected files one at a time", async () => {
  const { hashFilesSha256IfAvailable } = await importHelper("sequential-reads");
  const originalCrypto = globalThis.crypto;
  let activeReads = 0;
  let maxActiveReads = 0;

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          async digest(_algorithm, buffer) {
            const input = new Uint8Array(buffer);
            const digest = new Uint8Array(32);
            digest[31] = input[0] ?? 0;
            return digest.buffer;
          },
        },
      },
    });

    const hashes = await hashFilesSha256IfAvailable(
      Array.from({ length: 4 }, (_, index) => ({
        async arrayBuffer() {
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeReads -= 1;
          return new Uint8Array([index + 1]).buffer;
        },
      })),
    );

    assert.equal(hashes?.length, 4);
    assert.equal(maxActiveReads, 1);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

async function importHelper(label = "default") {
  const source = await readFile(helperPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}#${label}`);
}

function fakeFile(text) {
  return {
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    },
  };
}
