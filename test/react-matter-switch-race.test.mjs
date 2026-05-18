import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appContextPath = new URL("../react-ui/src/store/AppContext.tsx", import.meta.url);
const newMatterFormPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);

test("React matter switching serializes requests and ignores superseded switches", async () => {
  const source = await readFile(appContextPath, "utf8");

  assert.match(source, /class MatterSwitchSupersededError extends Error/);
  assert.match(source, /const matterSwitchSeqRef = useRef\(0\)/);
  assert.match(source, /const matterSwitchChainRef = useRef<Promise<unknown>>\(Promise\.resolve\(\)\)/);
  assert.match(source, /const switchSeq = matterSwitchSeqRef\.current \+ 1/);
  assert.match(source, /matterSwitchSeqRef\.current = switchSeq/);
  assert.match(source, /matterSwitchChainRef\.current\.catch\(\(\) => undefined\)\.then\(async \(\) =>/);
  assert.match(source, /if \(matterSwitchSeqRef\.current !== switchSeq\) \{\s*throw new MatterSwitchSupersededError\(name\);\s*\}/);
  assert.match(source, /const workspace = await api\.switchMatter\(name\);\s*if \(matterSwitchSeqRef\.current !== switchSeq\) \{/);
  assert.match(source, /matterSwitchChainRef\.current = task\.catch\(\(\) => undefined\)/);
});

test("React new matter flow treats superseded matter switch as a benign race", async () => {
  const source = await readFile(newMatterFormPath, "utf8");

  assert.match(source, /import \{ isMatterSwitchSupersededError, useApp \} from '\.\.\/store\/AppContext'/);
  assert.match(source, /catch \(err\) \{\s*if \(isMatterSwitchSupersededError\(err\)\) return;/);
});
