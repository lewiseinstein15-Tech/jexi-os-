import WorkGraph from '../views/WorkGraph';
import ActiveAgents from '../views/ActiveAgents';
import ToolCalls from '../views/ToolCalls';

/* MissionsView — the default console view: work graph | active agents +
   recent tool calls, exactly as the approved preview. */
export default function MissionsView() {
  return (
    <div className="missions-body">
      <WorkGraph />
      <div className="col">
        <ActiveAgents />
        <ToolCalls />
      </div>
    </div>
  );
}
