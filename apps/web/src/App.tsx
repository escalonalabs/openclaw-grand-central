import { useEventSocket } from './hooks/useEventSocket';
import { SceneShell } from './scene/SceneShell';
import { useEventStore } from './store/eventStore';

const App = (): JSX.Element => {
  useEventSocket();

  const connectionState = useEventStore((state) => state.connectionState);
  const eventCount = useEventStore((state) => state.events.length);
  const clearEvents = useEventStore((state) => state.clearEvents);

  return (
    <div className="app-root">
      <header className="hud">
        <h1>Grand Central</h1>
        <p>
          Connection: <span data-state={connectionState}>{connectionState}</span>
        </p>
        <p>Incoming events: {eventCount}</p>
        <button type="button" onClick={clearEvents}>
          Clear events
        </button>
      </header>
      <SceneShell />
    </div>
  );
};

export default App;
