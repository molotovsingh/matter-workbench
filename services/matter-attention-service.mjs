import path from "node:path";
import { buildChronologyAttentionItems } from "./matter-attention-chronology.mjs";
import { buildCommandFailureAttentionItems } from "./matter-attention-command-failures.mjs";
import { buildCustomSkillRunAttentionItems } from "./matter-attention-custom-runs.mjs";
import { normalizeText } from "./matter-attention-helpers.mjs";
import { buildIntakeAttentionItems } from "./matter-attention-intake.mjs";
import {
  normalizeAttentionItem,
  sortAttentionItems,
  summarizeAttentionItems,
} from "./matter-attention-items.mjs";
import { buildSourceLabelAttentionItems } from "./matter-attention-source-labels.mjs";

export const MATTER_ATTENTION_SCHEMA_VERSION = "matter-attention/v1";

export function createMatterAttentionService({
  matterStore,
  matterStatusService = null,
  configurableSkillRunsService = null,
  commandInteractionLogService = null,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterAttention(root = matterStore.ensureMatterRoot(), options = {}) {
    const matterName = normalizeText(options.matterName)
      || matterStore.activeMatterNameWithinHome?.()
      || path.basename(root);
    const items = [];
    const context = {
      root,
      matterName,
      items,
      status: await readMatterStatus(root),
    };

    await collectIntakeAttention(context);
    await collectSourceIndexAttention(context);
    await collectChronologyAttention(context);
    await collectCustomSkillRunAttention(context);
    await collectCommandFailureAttention(context);

    const orderedItems = sortAttentionItems(items);
    return {
      schema_version: MATTER_ATTENTION_SCHEMA_VERSION,
      generated_at: now().toISOString(),
      matterName,
      matterRoot: root,
      summary: summarizeAttentionItems(orderedItems),
      items: orderedItems,
    };
  }

  async function readMatterStatus(root) {
    if (!matterStatusService?.readMatterStatus) return null;
    try {
      return await matterStatusService.readMatterStatus(root);
    } catch (error) {
      return {
        read_error: error?.message || "Unable to read matter status.",
      };
    }
  }

  async function collectIntakeAttention(context) {
    const intakeItems = await buildIntakeAttentionItems({
      root: context.root,
      matterStore,
    });
    for (const item of intakeItems) addItem(context.items, item);
  }

  async function collectSourceIndexAttention(context) {
    const sourceItems = await buildSourceLabelAttentionItems({
      root: context.root,
      status: context.status,
    });
    for (const item of sourceItems) addItem(context.items, item);
  }

  async function collectChronologyAttention(context) {
    const chronologyItems = await buildChronologyAttentionItems({
      root: context.root,
      status: context.status,
    });
    for (const item of chronologyItems) addItem(context.items, item);
  }

  async function collectCustomSkillRunAttention({ matterName, items }) {
    const customRunItems = await buildCustomSkillRunAttentionItems({
      configurableSkillRunsService,
      matterName,
    });
    for (const item of customRunItems) addItem(items, item);
  }

  async function collectCommandFailureAttention({ matterName, items }) {
    const commandItems = await buildCommandFailureAttentionItems({
      commandInteractionLogService,
      matterName,
    });
    for (const item of commandItems) addItem(items, item);
  }

  return { readMatterAttention };
}

function addItem(items, item) {
  items.push(normalizeAttentionItem(item));
}
