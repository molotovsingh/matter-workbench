import { handleAppShellApiRequest } from "./app-shell-routes.mjs";
import { handleMatterWorkflowApiRequest } from "./matter-workflow-routes.mjs";
import { handleSkillFactoryApiRequest } from "./skill-factory-routes.mjs";

export async function handleApiRequest({ request, requestUrl, response, services }) {
  if (await handleMatterWorkflowApiRequest({ request, requestUrl, response, services })) {
    return true;
  }

  if (await handleAppShellApiRequest({ request, requestUrl, response, services })) {
    return true;
  }

  if (await handleSkillFactoryApiRequest({ request, requestUrl, response, services })) {
    return true;
  }

  return false;
}
