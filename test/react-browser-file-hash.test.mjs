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
