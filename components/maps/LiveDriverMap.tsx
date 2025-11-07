'use client';

import React, { useEffect, useRef } from 'react';
import mapboxgl, { Map, MapMouseEvent, EventData } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type DriverFeatureProps = {
  id?: string;
  [k: string]: any;
};

type Props = {
  features?: GeoJSON.FeatureCollection<GeoJSON.Point, DriverFeatureProps>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  center?: [number, number];
  zoom?: number;
  style?: React.CSSProperties;
};

const DEFAULT_CENTER: [number, number] = [121.066, 16.801];
const DEFAULT_ZOOM = 12;

export default function LiveDriverMap({
  features,
  selectedId = null,
  onSelect,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  style,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  // Create map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

    map.on('load', () => {
      // Source
      if (!map.getSource('drivers')) {
        map.addSource('drivers', {
          type: 'geojson',
          data:
            features ??
            ({
              type: 'FeatureCollection',
              features: [],
            } as GeoJSON.FeatureCollection),
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });
      }

      // Cluster circles
      if (!map.getLayer('clusters')) {
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'drivers',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#A7F3D0',
              10,
              '#6EE7B7',
              30,
              '#34D399',
            ],
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 28],
          },
        });
      }

      // Cluster count
      if (!map.getLayer('cluster-count')) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'drivers',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12,
          },
          paint: {
            'text-color': '#064E3B',
          },
        });
      }

      // Single points
      if (!map.getLayer('unclustered-point')) {
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'drivers',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'case',
              ['==', ['get', 'id'], selectedId ?? ''],
              '#ef4444', // selected
              '#2563eb', // normal
            ],
            'circle-radius': 7,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          },
        });
      }

      // ---- CLICK HANDLERS (typed) ----

      // Expand clusters
      map.on(
        'click',
        'clusters',
        (e: MapMouseEvent & EventData) => {
          const featuresAtPoint = map.queryRenderedFeatures(e.point, {
            layers: ['clusters'],
          });
          const feature = featuresAtPoint[0];
          if (!feature) return;

          const clusterId = feature.properties?.cluster_id as number | undefined;
          const src = map.getSource('drivers') as mapboxgl.GeoJSONSource | undefined;
          if (!src || clusterId === undefined) return;

          src.getClusterExpansionZoom(clusterId, (err, zoomLevel) => {
            if (err) return;
            const geom = feature.geometry as GeoJSON.Point;
            const [lng, lat] = geom.coordinates as [number, number];
            map.easeTo({ center: [lng, lat], zoom: zoomLevel });
          });
        }
      );

      // Select single driver
      map.on(
        'click',
        'unclustered-point',
        (e: MapMouseEvent & EventData) => {
          const featuresAtPoint = map.queryRenderedFeatures(e.point, {
            layers: ['unclustered-point'],
          });
          const feature = featuresAtPoint[0];
          const id = (feature?.properties?.id as string | undefined) ?? null;
          onSelect?.(id);
        }
      );

      map.on('mouseenter', 'clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'clusters', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', 'unclustered-point', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'unclustered-point', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update source data when features change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !features) return;
    const src = map.getSource('drivers') as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(features as any);
  }, [features]);

  // Update selected styling
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('unclustered-point')) return;

    map.setPaintProperty('unclustered-point', 'circle-color', [
      'case',
      ['==', ['get', 'id'], selectedId ?? ''],
      '#ef4444',
      '#2563eb',
    ]);
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '70vh',
        borderRadius: 12,
        overflow: 'hidden',
        ...style,
      }}
    />
  );
}
