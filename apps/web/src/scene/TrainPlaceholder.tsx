import { Html } from '@react-three/drei';

export const TrainPlaceholder = (): JSX.Element => {
  return (
    <group position={[2.7, 0.25, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.9, 0.45, 0.45]} />
        <meshStandardMaterial color="#0ea5e9" />
      </mesh>
      <Html position={[0, 0.45, 0]} center>
        <span className="scene-label">Train</span>
      </Html>
    </group>
  );
};
