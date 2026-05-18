import { adaptTree } from '../api/client';
import type { ActiveMatter, WorkspaceApiResponse } from '../types';

export function activeMatterFromWorkspace(
  workspace: WorkspaceApiResponse,
  fallbackName = '',
): ActiveMatter {
  const name = workspace.metadata?.matterName || workspace.folderName || fallbackName;
  const folderName = workspace.folderName || fallbackName || name;
  return {
    name,
    folderName,
    folderPath: workspace.inputLabel || '',
    clientName: workspace.metadata?.clientName,
    matterType: workspace.metadata?.matterType,
    workspace: adaptTree(workspace.tree),
    metadata: workspace.metadata,
    fileCount: workspace.fileCount,
    directoryCount: workspace.directoryCount,
  };
}
