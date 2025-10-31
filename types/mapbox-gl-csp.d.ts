declare module "mapbox-gl/dist/mapbox-gl-csp" {
  import mapboxgl from "mapbox-gl";
  // Expose the same namespace (so mapboxgl.Map works)
  export = mapboxgl;
}
declare module "mapbox-gl/dist/mapbox-gl-csp-worker" {
  const WorkerFactory: { new (): Worker; default: new () => Worker };
  export default WorkerFactory;
}
