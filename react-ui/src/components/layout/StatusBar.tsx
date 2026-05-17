import { useApp } from '../../store/AppContext';

export default function StatusBar() {
  const { state } = useApp();

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span>Matter Workbench</span>
        <span>Activity</span>
      </div>
      <div className="status-right">
        <span>{state.statusBar}</span>
      </div>
    </footer>
  );
}
