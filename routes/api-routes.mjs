import { handleAppShellApiRequest } from "./app-shell-routes.mjs";
import { handleMatterWorkflowApiRequest } from "./matter-workflow-routes.mjs";
import { handleSkillFactoryApiRequest } from "./skill-factory-routes.mjs";
import { dispatchRouteGroups } from "./route-dispatcher.mjs";

const apiRouteGroups = [
  handleMatterWorkflowApiRequest,
  handleAppShellApiRequest,
  handleSkillFactoryApiRequest,
];

export async function handleApiRequest({ request, requestUrl, response, services }) {
  return dispatchRouteGroups({ request, requestUrl, response, services }, apiRouteGroups);
}
