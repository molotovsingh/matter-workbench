import assert from "node:assert/strict";
import test from "node:test";

import {
  relativePathFromRuntimeObjectKey,
  runtimeObjectKeyCandidates,
  runtimeObjectKeyForMatterPath,
  validatedRelativePathFromRuntimeObjectKey,
} from "../services/runtime-db-object-key-policy.mjs";

test("runtime DB object key policy derives lookup candidates from storage and legal names", () => {
  assert.deepEqual(
    runtimeObjectKeyCandidates({
      matter: {
        name: "State - Rajesh Mehra",
        folderName: "State - Rajesh Mehra",
        matterName: "State/Rajesh Mehra",
      },
      relativePath: "10_Library/Case Timeline.md",
    }),
    [
      "State - Rajesh Mehra/10_Library/Case Timeline.md",
      "State/Rajesh Mehra/10_Library/Case Timeline.md",
    ],
  );
});

test("runtime DB object key policy strips matter prefix and validates stored relative paths", () => {
  assert.equal(
    relativePathFromRuntimeObjectKey(
      "State - Rajesh Mehra/10_Library/Case Timeline.md",
      "State - Rajesh Mehra",
    ),
    "10_Library/Case Timeline.md",
  );

  assert.equal(
    validatedRelativePathFromRuntimeObjectKey(
      "State - Rajesh Mehra/10_Library/Case Timeline.md",
      "State - Rajesh Mehra",
    ),
    "10_Library/Case Timeline.md",
  );

  assert.throws(
    () => validatedRelativePathFromRuntimeObjectKey("State - Rajesh Mehra/../secret.txt", "State - Rajesh Mehra"),
    (error) => error.statusCode === 409
      && error.code === "runtime_db.read.stored_path_outside_matter"
      && /outside the matter root/i.test(error.message),
  );
});

test("runtime DB object key policy builds materialized object keys safely", () => {
  assert.equal(
    runtimeObjectKeyForMatterPath({
      matter: { name: "State - Rajesh Mehra" },
      relativePath: "\\10_Library\\Source Index.json",
    }),
    "State - Rajesh Mehra/10_Library/Source Index.json",
  );
});
