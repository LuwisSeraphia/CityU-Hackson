import * as THREE from 'three';

/** Waypoints keep the rear-left station away from the middle desk. */
export function walkingRoute(home, destination) {
  const rearLeft = home.x < -1.5 && home.z < 0;
  const side = home.clone().add(new THREE.Vector3(rearLeft ? -0.95 : 0.95, 0, 0.3));
  const exit = side.clone();
  exit.z = rearLeft ? 4.05 : home.z + 0.9;
  if (destination.x < -3.5) {
    const leftAisle = new THREE.Vector3(destination.x, 0, rearLeft ? side.z : exit.z);
    return rearLeft ? [side, leftAisle, destination.clone()] : [side, exit, leftAisle, destination.clone()];
  }
  const aisle = new THREE.Vector3(4, 0, exit.z);
  const approach = new THREE.Vector3(4, 0, destination.z);
  return [side, exit, aisle, approach, destination.clone()];
}
