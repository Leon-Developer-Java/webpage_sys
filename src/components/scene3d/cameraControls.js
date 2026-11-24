// Keep the terrain point grabbed by the left mouse button under the cursor.
// Cesium's globe rotation can change its pivot near the horizon or detailed DEM
// tiles; a fixed local tangent plane avoids those jumps during a pan gesture.
export function installCameraControls(C,viewer){
  const {scene,camera}=viewer;
  const controls=scene.screenSpaceCameraController;
  controls.rotateEventTypes=[];
  controls.tiltEventTypes=[C.CameraEventType.RIGHT_DRAG,C.CameraEventType.MIDDLE_DRAG,
    {eventType:C.CameraEventType.LEFT_DRAG,modifier:C.KeyboardEventModifier.CTRL}];
  controls.zoomEventTypes=[C.CameraEventType.WHEEL,C.CameraEventType.PINCH];
  controls.lookEventTypes=[];
  controls.inertiaSpin=0;
  controls.inertiaTranslate=0;
  controls.inertiaTilt=0;
  controls.enableCollisionDetection=true;

  const handler=new C.ScreenSpaceEventHandler(scene.canvas);
  let gesture=null;
  const finish=()=>{gesture=null;};
  handler.setInputAction(({position})=>{
    finish();
    if(!controls.enableInputs)return;
    camera.cancelFlight();
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    const ray=camera.getPickRay(position);
    const point=ray&&scene.globe.pick(ray,scene);
    if(!point)return;
    const normal=scene.globe.ellipsoid.geodeticSurfaceNormal(point,new C.Cartesian3());
    gesture={anchor:C.Cartesian3.clone(point),plane:C.Plane.fromPointNormal(point,normal)};
  },C.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(({endPosition})=>{
    if(!gesture||!controls.enableInputs)return;
    const ray=camera.getPickRay(endPosition);
    const point=ray&&C.IntersectionTests.rayPlane(ray,gesture.plane,new C.Cartesian3());
    if(!point)return;
    const delta=C.Cartesian3.subtract(gesture.anchor,point,new C.Cartesian3());
    // Do not turn a near-parallel sky ray into a huge translation.
    const distance=C.Cartesian3.distance(camera.positionWC,gesture.anchor);
    if(C.Cartesian3.magnitude(delta)>Math.max(50,distance*.5))return;
    const destination=C.Cartesian3.add(camera.positionWC,delta,new C.Cartesian3());
    camera.setView({destination,orientation:{
      direction:C.Cartesian3.clone(camera.directionWC),up:C.Cartesian3.clone(camera.upWC),
    }});
    scene.requestRender();
  },C.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(finish,C.ScreenSpaceEventType.LEFT_UP);
  const preventContextMenu=event=>event.preventDefault();
  scene.canvas.addEventListener('contextmenu',preventContextMenu);
  window.addEventListener('pointerup',finish);
  window.addEventListener('blur',finish);
  return {
    cancel:finish,
    destroy(){finish();handler.destroy();scene.canvas.removeEventListener('contextmenu',preventContextMenu);
      window.removeEventListener('pointerup',finish);window.removeEventListener('blur',finish);},
  };
}
