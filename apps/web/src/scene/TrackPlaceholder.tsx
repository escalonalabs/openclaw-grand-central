export const TrackPlaceholder = (): JSX.Element => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <ringGeometry args={[2.4, 3.1, 64]} />
      <meshStandardMaterial color="#334155" metalness={0.1} roughness={0.9} />
    </mesh>
  );
};
