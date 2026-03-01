import { Html } from '@react-three/drei';

export const StationPlaceholder = (): JSX.Element => {
  return (
    <group position={[0, 0.45, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.5, 0.9, 1.2]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <Html position={[0, 0.8, 0]} center>
        <span className="scene-label">Station</span>
      </Html>
    </group>
  );
};
