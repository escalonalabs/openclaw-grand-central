import type { TrackNode } from './sceneModel';

type TrackLayerProps = {
  tracks: TrackNode[];
  selectedLaneId: string;
  onSelectLane: (laneId: string) => void;
};

export const TrackPlaceholder = ({
  tracks,
  selectedLaneId,
  onSelectLane
}: TrackLayerProps): JSX.Element => {
  return (
    <group>
      {tracks.map((track) => {
        const focused = selectedLaneId !== 'all' && track.laneId === selectedLaneId;
        const dimmed = selectedLaneId !== 'all' && !focused;
        return (
          <mesh
            key={track.laneId}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[track.position[0], 0.04, track.position[2]]}
            receiveShadow
            onClick={() => onSelectLane(track.laneId)}
          >
            <ringGeometry args={[track.radius, track.radius + 0.07, 48]} />
            <meshStandardMaterial
              color={focused ? '#22d3ee' : track.color}
              emissive={focused ? '#0284c7' : '#000000'}
              emissiveIntensity={focused ? 0.45 : 0}
              metalness={0.1}
              roughness={0.9}
              transparent={dimmed}
              opacity={dimmed ? 0.25 : 1}
            />
          </mesh>
        );
      })}
    </group>
  );
};
