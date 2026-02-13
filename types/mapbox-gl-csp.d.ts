declare module "mapbox-gl/dist/mapbox-gl-csp" {
  import mapboxgl from "mapbox-gl";
  export = mapboxgl;
}
declare module "mapbox-gl/dist/mapbox-gl-csp-worker" {
  const WorkerFactory: { new (): Worker; default: new () => Worker };
  export default WorkerFactory;
}
