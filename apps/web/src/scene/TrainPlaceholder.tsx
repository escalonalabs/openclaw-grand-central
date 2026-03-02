import { Html } from '@react-three/drei';
import type { SceneLodLevel, TrainNode } from './sceneModel';

type TrainLayerProps = {
  trains: TrainNode[];
  lod: SceneLodLevel;
  showLabels: boolean;
  selectedLaneId: string;
  selectedSessionId: string;
  onSelectSession: (laneId: string, sessionId: string) => void;
};

export const TrainPlaceholder = ({
  trains,
  lod,
  showLabels,
  selectedLaneId,
  selectedSessionId,
  onSelectSession
}: TrainLayerProps): JSX.Element => {
  return (
    <group>
      {trains.map((train) => {
        const laneFocused = selectedLaneId !== 'all' && train.laneId === selectedLaneId;
        const sessionFocused = selectedSessionId !== 'all' && train.sessionId === selectedSessionId;
        const focused = selectedSessionId !== 'all' ? sessionFocused : laneFocused;
        const dimmed = selectedSessionId !== 'all'
          ? !sessionFocused
          : selectedLaneId !== 'all'
            ? !laneFocused
            : false;

        return (
          <group key={train.agentId} position={train.position}>
            <mesh castShadow onClick={() => onSelectSession(train.laneId, train.sessionId)} scale={focused ? 1.14 : 1}>
              {lod === 'low' ? <sphereGeometry args={[0.16, 8, 8]} /> : <boxGeometry args={[0.68, 0.3, 0.3]} />}
              <meshStandardMaterial
                color={focused ? '#f8fafc' : train.color}
                emissive={focused ? '#22d3ee' : train.color}
                emissiveIntensity={focused ? 0.55 : lod === 'high' ? 0.2 : 0.1}
                transparent={dimmed}
                opacity={dimmed ? 0.2 : 1}
              />
            </mesh>
            {showLabels || focused ? (
              <Html position={[0, 0.42, 0]} center>
                <span className="scene-label">
                  {train.agentId}
                  {focused ? ` • ${train.sessionId}` : ''}
                </span>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
};
