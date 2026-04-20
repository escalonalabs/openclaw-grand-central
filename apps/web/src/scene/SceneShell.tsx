import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { StationPlaceholder } from './StationPlaceholder';
import { TrackPlaceholder } from './TrackPlaceholder';
import { TrainPlaceholder } from './TrainPlaceholder';

export const SceneShell = (): JSX.Element => {
  return (
    <div className="scene-shell">
      <Canvas shadows camera={{ position: [6, 5, 6], fov: 45 }}>
        <color attach="background" args={['#020617']} />
        <ambientLight intensity={0.5} />
        <directionalLight castShadow intensity={1} position={[4, 6, 2]} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#111827" />
        </mesh>

        <TrackPlaceholder />
        <StationPlaceholder />
        <TrainPlaceholder />

        <OrbitControls enablePan enableZoom minDistance={4} maxDistance={16} />
      </Canvas>
    </div>
  );
};
