import assert from "node:assert/strict";
import test from "node:test";

import {
  matterIdentityFromCaption,
  matterMetadataFields,
  matterStorageCollisionKey,
  matterStorageNameFromCaption,
} from "../shared/matter-identity-policy.mjs";

test("matter identity policy separates legal captions from storage names", () => {
  assert.equal(matterStorageNameFromCaption("State/Rajesh Mehra"), "State - Rajesh Mehra");
  assert.equal(matterStorageNameFromCaption("State\\Rajesh Mehra"), "State - Rajesh Mehra");
  assert.equal(matterStorageNameFromCaption("State: Rajesh"), "State - Rajesh");

  const identity = matterIdentityFromCaption(" State/Rajesh Mehra ");
  assert.deepEqual(identity, {
    displayName: "State/Rajesh Mehra",
    storageName: "State - Rajesh Mehra",
    collisionKey: "state - rajesh mehra",
  });
});

test("matter identity policy rejects unusable captions and normalizes reserved storage names", () => {
  assert.equal(matterStorageNameFromCaption("CON"), "CON matter");
  assert.equal(matterStorageNameFromCaption("aux.txt"), "aux matter.txt");

  assert.throws(
    () => matterStorageNameFromCaption("///:::***"),
    (error) => error.statusCode === 400 && error.code === "upload.invalid_matter_name",
  );
});

test("matter identity policy exposes storage collision keys", () => {
  assert.equal(
    matterStorageCollisionKey(matterStorageNameFromCaption("State/Rajesh Mehra")),
    matterStorageCollisionKey(matterStorageNameFromCaption("State - Rajesh Mehra")),
  );
});

test("matter identity policy preserves explicit legal metadata captions", () => {
  assert.deepEqual(
    matterMetadataFields({
      metadata: { matterName: "Client caption", clientName: "Client A" },
      caption: "Uploaded caption",
      storageName: "Uploaded caption",
    }),
    { matterName: "Client caption", clientName: "Client A" },
  );

  assert.deepEqual(
    matterMetadataFields({
      metadata: { clientName: "Client A" },
      caption: "State/Rajesh Mehra",
      storageName: "State - Rajesh Mehra",
    }),
    { matterName: "State/Rajesh Mehra", clientName: "Client A" },
  );
});
