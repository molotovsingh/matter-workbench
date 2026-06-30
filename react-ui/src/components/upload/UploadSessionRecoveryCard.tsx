import {
  selectedFilesMatchUploadSessionDraft,
  uploadSessionDraftSummary,
  type StoredUploadSessionDraft,
} from '../../lib/uploadSessions';
import type { CollectedUploadFile } from '../../lib/uploadFileCollection';

interface Props {
  draft: StoredUploadSessionDraft;
  selectedFiles: CollectedUploadFile[];
  onForget: () => void;
  onUseSavedDetails?: () => void;
}

export function UploadSessionRecoveryCard({
  draft,
  selectedFiles,
  onForget,
  onUseSavedDetails,
}: Props) {
  const hasSelectedFiles = selectedFiles.length > 0;
  const selectedFilesMatch = selectedFilesMatchUploadSessionDraft(draft, selectedFiles);

  return (
    <div className="form-info">
      <strong>Unfinished upload session found.</strong>
      <p>
        {uploadSessionDraftSummary(draft)}. Re-select the same files to resume from the files already received by the server.
      </p>
      {hasSelectedFiles && selectedFilesMatch && (
        <p>Selected files match this session. Submitting will resume instead of starting over.</p>
      )}
      {hasSelectedFiles && !selectedFilesMatch && (
        <p>The currently selected files do not match this saved session. You can forget it or select the original files again.</p>
      )}
      <div className="warning-actions" style={{ marginTop: 8 }}>
        {onUseSavedDetails && (
          <button type="button" className="secondary" onClick={onUseSavedDetails}>Use saved details</button>
        )}
        <button type="button" className="secondary" onClick={onForget}>Forget saved upload</button>
      </div>
    </div>
  );
}
