import { adaptTree } from '../api/client';
import type { ActiveMatter, WorkspaceApiResponse } from '../types';

export function activeMatterFromWorkspace(
  workspace: WorkspaceApiResponse,
  fallbackName = '',
): ActiveMatter {
  const folderName = workspace.folderName || fallbackName || workspace.metadata?.matterName || '';
  const name = folderName || workspace.metadata?.matterName || fallbackName;
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
