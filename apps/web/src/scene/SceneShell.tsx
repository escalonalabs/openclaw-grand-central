import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import type { IncomingEvent } from '../store/eventStore';
import { StationPlaceholder } from './StationPlaceholder';
import { TrackPlaceholder } from './TrackPlaceholder';
import { TrainPlaceholder } from './TrainPlaceholder';
import {
  buildSceneModel,
  getSceneLodBudget,
  resolveSceneLod,
  type SceneLodPreference
} from './sceneModel';

type SceneShellProps = {
  events: IncomingEvent[];
  lodPreference: SceneLodPreference;
  selectedLaneId: string;
  selectedSessionId: string;
  onSelectLane: (laneId: string) => void;
  onSelectSession: (laneId: string, sessionId: string) => void;
};

export const SceneShell = ({
  events,
  lodPreference,
  selectedLaneId,
  selectedSessionId,
  onSelectLane,
  onSelectSession
}: SceneShellProps): JSX.Element => {
  const lod = resolveSceneLod(lodPreference, events.length);
  const budget = getSceneLodBudget(lod);
  const model = useMemo(() => buildSceneModel(events, lod), [events, lod]);

  return (
    <div className="scene-shell">
      <Canvas shadows camera={{ position: [6, 5, 6], fov: 45 }}>
        <color attach="background" args={['#040b18']} />
        <ambientLight intensity={0.5} />
        <directionalLight castShadow intensity={1} position={[4, 6, 2]} />
        <directionalLight intensity={0.35} position={[-5, 8, -4]} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>

        <TrackPlaceholder
          tracks={model.tracks}
          selectedLaneId={selectedLaneId}
          onSelectLane={onSelectLane}
        />
        <StationPlaceholder stations={model.stations} showLabels={budget.showLabels} />
        <TrainPlaceholder
          trains={model.trains}
          lod={lod}
          showLabels={budget.showLabels}
          selectedLaneId={selectedLaneId}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
        />

        <OrbitControls enablePan enableZoom minDistance={4} maxDistance={16} />
      </Canvas>
      <div className="scene-stats">
        <span>LOD: {lod}</span>
        <span>Stations: {model.stations.length}</span>
        <span>Tracks: {model.tracks.length}</span>
        <span>Trains: {model.trains.length}</span>
        <span>Lane focus: {selectedLaneId}</span>
        <span>Session focus: {selectedSessionId}</span>
      </div>
    </div>
  );
};
