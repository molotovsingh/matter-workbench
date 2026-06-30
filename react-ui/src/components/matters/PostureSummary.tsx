import type { ProceduralPostureDiagnosisResult } from '../../types';

export function PostureSummary({ status }: { status: ProceduralPostureDiagnosisResult }) {
  const simpleCaseView = (status.simpleCaseView || '').trim();
  const recommendedRoute = status.recommendedRoute || null;
  const nextBestActions = Array.isArray(status.nextBestActions) ? status.nextBestActions.filter(Boolean).slice(0, 4) : [];
  const routeLabel = recommendedRoute?.route_number
    ? `Route ${recommendedRoute.route_number}: ${recommendedRoute.route_title || 'Recommended route'}`
    : (recommendedRoute?.route_title || 'Recommended route');

  if (simpleCaseView || recommendedRoute?.recommendation || nextBestActions.length > 0) {
    return (
      <div className="posture-summary-panel">
        {simpleCaseView && (
          <p><strong>Simple view:</strong> {simpleCaseView}</p>
        )}
        {(recommendedRoute?.recommendation || recommendedRoute?.reason || recommendedRoute?.next_step) && (
          <div className="posture-route-summary">
            <p><strong>Recommended route:</strong> {routeLabel}</p>
            {recommendedRoute?.recommendation && <p>{recommendedRoute.recommendation}</p>}
            {recommendedRoute?.reason && <p className="muted">Why: {recommendedRoute.reason}</p>}
            {recommendedRoute?.next_step && <p className="muted">Next step: {recommendedRoute.next_step}</p>}
          </div>
        )}
        {nextBestActions.length > 0 && (
          <div>
            <strong>Next best actions</strong>
            <ol className="posture-next-actions">
              {nextBestActions.map((action, index) => <li key={`${action}-${index}`}>{action}</li>)}
            </ol>
          </div>
        )}
        {status.artifactPath && <p className="muted">Full legal routes are saved in {status.artifactPath}.</p>}
      </div>
    );
  }

  return (
    <>
      {status.courtForum?.value && (
        <p><strong>Court / forum:</strong> {status.courtForum.value} <span className="muted">({status.courtForum.confidence || 'unknown'} confidence)</span></p>
      )}
      {status.proceduralPosture?.value && (
        <p><strong>Procedural posture:</strong> {status.proceduralPosture.value} <span className="muted">({status.proceduralPosture.confidence || 'unknown'} confidence)</span></p>
      )}
      {status.recommendedWorkingPath?.filing_or_remedy && (
        <p><strong>Working path:</strong> {status.recommendedWorkingPath.filing_or_remedy}</p>
      )}
    </>
  );
}
