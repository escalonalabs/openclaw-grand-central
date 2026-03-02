import { Html } from '@react-three/drei';
import type { StationNode } from './sceneModel';

type StationLayerProps = {
  stations: StationNode[];
  showLabels: boolean;
};

export const StationPlaceholder = ({ stations, showLabels }: StationLayerProps): JSX.Element => {
  return (
    <group>
      {stations.map((station) => (
        <group key={station.workspaceId} position={station.position}>
          <mesh castShadow>
            <cylinderGeometry args={[0.9, 1.05, 0.8, 16]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.3, 0.16, 0.8]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          {showLabels ? (
            <Html position={[0, 0.95, 0]} center>
              <span className="scene-label">{station.workspaceId}</span>
            </Html>
          ) : null}
        </group>
      ))}
    </group>
  );
};
