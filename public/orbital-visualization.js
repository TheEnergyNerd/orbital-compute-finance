/**
 * Orbital Compute Visualization Library
 * Standalone JavaScript functions for rendering orbital compute simulations
 * 
 * Dependencies: Three.js (https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.min.js)
 * 
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.min.js"></script>
 *   <script src="orbital-visualization.js"></script>
 */

(function(global) {
  'use strict';

  // Note: Three.js should be loaded before this script
  // We'll check at runtime when functions are called, not at load time

  const OrbitalViz = {};

  // ============================================================================
  // COORDINATE CONVERSION UTILITIES
  // ============================================================================

  /**
   * Convert latitude/longitude/altitude to Three.js XYZ coordinates
   * Earth radius is normalized to 1.0 in the scene
   */
  OrbitalViz.latLonAltToXYZ = function(lat, lon, altKm) {
    const radius = 1.0 + (altKm / 6371); // Normalize altitude (Earth radius ~6371km)
    const phi = (90 - lat) * (Math.PI / 180); // Colatitude
    const theta = (lon + 180) * (Math.PI / 180);
    
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    
    return [x, y, z];
  };

  /**
   * Convert latitude/longitude to 3D vector (surface position)
   */
  OrbitalViz.latLngToVec3 = function(latDeg, lonDeg, radius) {
    const phi = (90 - latDeg) * (Math.PI / 180);
    const theta = (lonDeg + 180) * (Math.PI / 180);
    
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    
    return [x, y, z];
  };

  /**
   * Convert XYZ coordinates back to lat/lon/alt
   */
  OrbitalViz.xyzToLatLonAlt = function(x, y, z) {
    const radius = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    const phi = Math.acos(y / radius);
    const lat = 90 - (phi * 180 / Math.PI);
    const theta = Math.atan2(-z, x);
    const lon = (theta * 180 / Math.PI) - 180;
    const altKm = (radius - 1.0) * 6371;
    
    return [lat, lon, altKm];
  };

  /**
   * Create geodesic arc points for drawing paths between two points on a sphere
   */
  OrbitalViz.createGeodesicArc = function(fromLat, fromLon, fromAlt, toLat, toLon, toAlt, numPoints) {
    numPoints = numPoints || 96;
    
    const startVec = new THREE.Vector3(...OrbitalViz.latLonAltToXYZ(fromLat, fromLon, fromAlt));
    const endVec = new THREE.Vector3(...OrbitalViz.latLonAltToXYZ(toLat, toLon, toAlt));
    
    const a = startVec.clone().normalize();
    const b = endVec.clone().normalize();
    const mid = a.clone().add(b).normalize();
    
    const startRadius = startVec.length();
    const endRadius = endVec.length();
    const avgRadius = (startRadius + endRadius) / 2;
    const liftedMid = mid.normalize().multiplyScalar(avgRadius * 1.3);
    
    const curve = new THREE.CatmullRomCurve3([startVec, liftedMid, endVec]);
    const curvePoints = curve.getPoints(numPoints);
    
    return curvePoints.map(v => {
      const radius = Math.sqrt(v.x**2 + v.y**2 + v.z**2);
      if (radius < 1.02) {
        const scale = 1.02 / radius;
        return [v.x * scale, v.y * scale, v.z * scale];
      }
      return [v.x, v.y, v.z];
    });
  };

  // ============================================================================
  // ANIMATION EASING FUNCTIONS
  // ============================================================================

  OrbitalViz.easeInOutQuad = function(t) {
    return t < 0.5 
      ? 2 * t * t 
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
  };

  OrbitalViz.lerp = function(start, end, t) {
    return start + (end - start) * t;
  };

  // ============================================================================
  // GLOBE/EARTH RENDERING
  // ============================================================================

  /**
   * Create and add Earth globe mesh to a Three.js scene
   * @returns {Promise<THREE.Mesh>} Promise resolving to the Earth mesh
   */
  OrbitalViz.createGlobe = function(scene, textureUrl) {
    if (typeof THREE === 'undefined') {
      return Promise.reject(new Error('Three.js is required. Include it before this script.'));
    }
    
    textureUrl = textureUrl || 
      'https://raw.githubusercontent.com/turban/webgl-earth/master/images/2_no_clouds_4k.jpg';
    
    return new Promise((resolve, reject) => {
      const geometry = new THREE.SphereGeometry(1, 128, 128);
      const textureLoader = new THREE.TextureLoader();
      
      textureLoader.load(
        textureUrl,
        function(texture) {
          texture.flipY = true;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          
          const material = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.1,
            roughness: 0.9,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide
          });
          
          const earthMesh = new THREE.Mesh(geometry, material);
          earthMesh.rotation.set(0, 0, 0);
          earthMesh.position.set(0, 0, 0);
          scene.add(earthMesh);
          
          // Add atmosphere glow
          const atmosphereGeometry = new THREE.SphereGeometry(1.01, 64, 64);
          const atmosphereMaterial = new THREE.MeshStandardMaterial({
            color: 0x87ceeb,
            transparent: true,
            opacity: 0.15,
            emissive: 0x87ceeb,
            emissiveIntensity: 0.2,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true
          });
          const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
          scene.add(atmosphere);
          
          resolve(earthMesh);
        },
        undefined,
        reject
      );
    });
  };

  // ============================================================================
  // SATELLITE RENDERING
  // ============================================================================

  /**
   * Create GPU-instanced satellite renderer
   * @param {Array} satellites - Array of {id, x, y, z, altitudeKm, color?}
   * @param {Object} options - {size?, geometry?}
   * @returns {THREE.InstancedMesh}
   */
  OrbitalViz.createSatellites = function(scene, satellites, options) {
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js is required. Include it before this script.');
    }
    
    options = options || {};
    const size = options.size || 0.01;
    const geometryType = options.geometry || 'octahedron';
    
    let geo;
    switch (geometryType) {
      case 'sphere':
        geo = new THREE.SphereGeometry(size, 8, 8);
        break;
      case 'box':
        geo = new THREE.BoxGeometry(size, size, size);
        break;
      case 'octahedron':
      default:
        geo = new THREE.OctahedronGeometry(size, 0);
        break;
    }
    
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff
    });
    
    const instancedMesh = new THREE.InstancedMesh(geo, material, satellites.length);
    const dummy = new THREE.Object3D();
    
    satellites.forEach((sat, i) => {
      const x = sat.x || 0;
      const y = sat.y || 0;
      const z = sat.z || 0;
      
      let scale = 1.0;
      if (sat.altitudeKm !== undefined) {
        if (sat.altitudeKm >= 35786) scale = 2.0;
        else if (sat.altitudeKm >= 10000) scale = 1.5;
        else if (sat.altitudeKm >= 800) scale = 1.2;
        else if (sat.altitudeKm >= 400) scale = 1.0;
        else scale = 0.8;
      }
      
      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    });
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(instancedMesh);
    
    return instancedMesh;
  };

  /**
   * Update satellite positions
   */
  OrbitalViz.updateSatellites = function(instancedMesh, satellites) {
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js is required. Include it before this script.');
    }
    
    if (instancedMesh.count !== satellites.length) {
      instancedMesh.count = satellites.length;
    }
    
    const dummy = new THREE.Object3D();
    
    satellites.forEach((sat, i) => {
      const x = sat.x || 0;
      const y = sat.y || 0;
      const z = sat.z || 0;
      
      let scale = 1.0;
      if (sat.altitudeKm !== undefined) {
        if (sat.altitudeKm >= 35786) scale = 2.0;
        else if (sat.altitudeKm >= 10000) scale = 1.5;
        else if (sat.altitudeKm >= 800) scale = 1.2;
        else if (sat.altitudeKm >= 400) scale = 1.0;
        else scale = 0.8;
      }
      
      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    });
    
    instancedMesh.instanceMatrix.needsUpdate = true;
  };

  // ============================================================================
  // GROUND STATION RENDERING
  // ============================================================================

  /**
   * Create and render ground stations
   * @param {Array} groundStations - Array of {lat, lon, type?, id?}
   * @param {Object} options - {dataCenterColor?, launchSiteColor?, size?}
   * @returns {Array<THREE.InstancedMesh>}
   */
  OrbitalViz.createGroundStations = function(scene, groundStations, options) {
    options = options || {};
    const dataCenterColor = options.dataCenterColor || '#4a90e2';
    const launchSiteColor = options.launchSiteColor || '#ff8800';
    
    const dataCenters = groundStations.filter(s => !s.type || s.type === 'data_center');
    const launchSites = groundStations.filter(s => s.type === 'launch_site');
    
    const meshes = [];
    
    if (dataCenters.length > 0) {
      const dcGeometry = new THREE.SphereGeometry(0.008, 8, 8);
      const dcMaterial = new THREE.MeshBasicMaterial({ color: dataCenterColor });
      const dcMesh = new THREE.InstancedMesh(dcGeometry, dcMaterial, dataCenters.length);
      
      const dummy = new THREE.Object3D();
      dataCenters.forEach((site, i) => {
        const [x, y, z] = OrbitalViz.latLngToVec3(site.lat, site.lon, 1.002);
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dcMesh.setMatrixAt(i, dummy.matrix);
      });
      
      dcMesh.instanceMatrix.needsUpdate = true;
      scene.add(dcMesh);
      meshes.push(dcMesh);
    }
    
    if (launchSites.length > 0) {
      const launchGeometry = new THREE.SphereGeometry(0.01, 8, 8);
      const launchMaterial = new THREE.MeshBasicMaterial({ color: launchSiteColor });
      const launchMesh = new THREE.InstancedMesh(launchGeometry, launchMaterial, launchSites.length);
      
      const dummy = new THREE.Object3D();
      launchSites.forEach((site, i) => {
        const [x, y, z] = OrbitalViz.latLngToVec3(site.lat, site.lon, 1.002);
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        launchMesh.setMatrixAt(i, dummy.matrix);
      });
      
      launchMesh.instanceMatrix.needsUpdate = true;
      scene.add(launchMesh);
      meshes.push(launchMesh);
    }
    
    return meshes;
  };

  // ============================================================================
  // ORBITAL SHELLS VISUALIZATION
  // ============================================================================

  /**
   * Create orbital shell rings
   * @param {Array} orbitalShells - Array of {altitude, count, color}
   * @returns {Array<THREE.Line>}
   */
  OrbitalViz.createOrbitalShells = function(scene, orbitalShells) {
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js is required. Include it before this script.');
    }
    
    const lines = [];
    
    orbitalShells.forEach(shell => {
      const radius = 1.0 + (shell.altitude / 6371);
      const color = shell.color || '#ffffff';
      
      const points = [];
      const segments = 128;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const x = radius * Math.cos(theta);
        const y = 0;
        const z = radius * Math.sin(theta);
        points.push(new THREE.Vector3(x, y, z));
      }
      
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        linewidth: 1
      });
      
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      lines.push(line);
    });
    
    return lines;
  };

  // ============================================================================
  // DATA FLOW ANIMATIONS
  // ============================================================================

  /**
   * Create animated data flow connections
   * @param {Array} dataFlows - Array of {id, fromLat, fromLon, fromAlt, toLat, toLon, toAlt, color?, speed?}
   * @param {Object} options - {pulseColor?, lineColor?, lineWidth?, pulseSize?}
   * @returns {Object} {update: function(deltaTime), flows: Array}
   */
  OrbitalViz.createDataFlows = function(scene, dataFlows, options) {
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js is required. Include it before this script.');
    }
    
    options = options || {};
    const pulseColor = options.pulseColor || '#00f0ff';
    const lineColor = options.lineColor || '#4488ff';
    const lineWidth = options.lineWidth || 2;
    const pulseSize = options.pulseSize || 0.01;
    
    const flows = [];
    
    dataFlows.forEach(flow => {
      const arcPoints = OrbitalViz.createGeodesicArc(
        flow.fromLat, flow.fromLon, flow.fromAlt || 550,
        flow.toLat, flow.toLon, flow.toAlt || 550,
        96
      );
      
      const points = arcPoints.map(p => new THREE.Vector3(...p));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      
      const lineMaterial = new THREE.LineBasicMaterial({
        color: flow.color || lineColor,
        transparent: true,
        opacity: 0.6,
        linewidth: lineWidth
      });
      
      const line = new THREE.Line(geometry, lineMaterial);
      scene.add(line);
      
      const pulseGeometry = new THREE.SphereGeometry(pulseSize, 8, 8);
      const pulseMaterial = new THREE.MeshBasicMaterial({
        color: pulseColor,
        transparent: true,
        opacity: 0.9
      });
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      scene.add(pulse);
      
      flows.push({
        id: flow.id,
        line: line,
        pulse: pulse,
        points: points,
        progress: 0,
        speed: flow.speed || 1.0
      });
    });
    
    return {
      update: function(deltaTime) {
        flows.forEach(flow => {
          flow.progress += (deltaTime * flow.speed) / 3.0;
          if (flow.progress >= 1.0) {
            flow.progress = 0.0;
          }
          
          const pointIndex = Math.floor(flow.progress * (flow.points.length - 1));
          const nextIndex = Math.min(pointIndex + 1, flow.points.length - 1);
          const t = (flow.progress * (flow.points.length - 1)) - pointIndex;
          
          const currentPoint = flow.points[pointIndex];
          const nextPoint = flow.points[nextIndex];
          
          const x = currentPoint.x + (nextPoint.x - currentPoint.x) * t;
          const y = currentPoint.y + (nextPoint.y - currentPoint.y) * t;
          const z = currentPoint.z + (nextPoint.z - currentPoint.z) * t;
          
          flow.pulse.position.set(x, y, z);
        });
      },
      flows: flows
    };
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrbitalViz;
  } else {
    global.OrbitalViz = OrbitalViz;
  }

})(typeof window !== 'undefined' ? window : this);

