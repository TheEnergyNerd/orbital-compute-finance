// Simple OrbitControls implementation for Three.js
// Works with global THREE object - simplified version
(function(global) {
  'use strict';
  
  if (typeof THREE === 'undefined') {
    console.error('THREE.js must be loaded before OrbitControls');
    return;
  }
  
  function OrbitControls(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement !== undefined ? domElement : document;
    
    // Properties
    this.enableDamping = true;
    this.dampingFactor = 0.05;
    this.enablePan = false; // Disable panning - only zoom and rotate
    this.enableZoom = true;
    this.enableRotate = true;
    this.minDistance = 1.5;
    this.maxDistance = 20;
    this.target = new THREE.Vector3(0, 0, 0);
    this.enabled = true;
    this.rotateSpeed = 1.0;
    this.panSpeed = 1.0;
    this.zoomSpeed = 1.0;
    
    var scope = this;
    var spherical = new THREE.Spherical();
    var sphericalDelta = new THREE.Spherical();
    var scale = 1;
    var panOffset = new THREE.Vector3();
    
    // Convert camera position to spherical coordinates relative to target
    function updateSpherical() {
      var offset = new THREE.Vector3();
      offset.copy(scope.camera.position).sub(scope.target);
      spherical.setFromVector3(offset);
    }
    
    // Initialize
    updateSpherical();
    
    this.update = function() {
      if (!scope.enabled) return;
      
      // Apply rotation deltas
      if (scope.enableDamping) {
        spherical.theta += sphericalDelta.theta * scope.dampingFactor;
        // Don't apply phi delta - tilt is locked
        sphericalDelta.theta *= (1 - scope.dampingFactor);
        sphericalDelta.phi = 0; // Reset phi delta since we don't use it
        panOffset.multiplyScalar(1 - scope.dampingFactor);
      } else {
        spherical.theta += sphericalDelta.theta;
        // Don't apply phi - tilt is locked
        sphericalDelta.set(0, 0, 0);
      }
      
      // Lock phi (tilt angle) - only allow rotation around vertical axis
      // Keep phi at a fixed angle (e.g., horizontal view at equator level)
      const fixedPhi = Math.PI / 2; // 90 degrees = horizontal view
      spherical.phi = fixedPhi;
      
      // Apply zoom
      spherical.radius *= scale;
      spherical.radius = Math.max(scope.minDistance, Math.min(scope.maxDistance, spherical.radius));
      
      // Apply pan
      scope.target.add(panOffset);
      
      // Convert back to cartesian and update camera
      var offset = new THREE.Vector3();
      offset.setFromSpherical(spherical);
      scope.camera.position.copy(scope.target).add(offset);
      scope.camera.lookAt(scope.target);
      
      // Reset for next frame
      scale = 1;
      if (!scope.enableDamping) {
        panOffset.set(0, 0, 0);
      }
    };
    
    var STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };
    var state = STATE.NONE;
    var rotateStart = new THREE.Vector2();
    var rotateEnd = new THREE.Vector2();
    var panStart = new THREE.Vector2();
    var panEnd = new THREE.Vector2();
    var dollyStart = new THREE.Vector2();
    var dollyEnd = new THREE.Vector2();
    
    function onMouseDown(event) {
      if (!scope.enabled || scope.domElement !== event.target) return;
      event.preventDefault();
      
      switch (event.button) {
        case 0: // left
          if (!scope.enableRotate) return;
          rotateStart.set(event.clientX, event.clientY);
          state = STATE.ROTATE;
          break;
        case 1: // middle
          if (!scope.enableZoom) return;
          dollyStart.set(event.clientX, event.clientY);
          state = STATE.DOLLY;
          break;
        case 2: // right
          if (!scope.enablePan) return;
          panStart.set(event.clientX, event.clientY);
          state = STATE.PAN;
          break;
      }
      
      if (state !== STATE.NONE) {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        scope.domElement.style.cursor = 'grabbing';
      }
    }
    
    function onMouseMove(event) {
      if (!scope.enabled || state === STATE.NONE) return;
      event.preventDefault();
      
      switch (state) {
        case STATE.ROTATE:
          rotateEnd.set(event.clientX, event.clientY);
          var rotateDelta = new THREE.Vector2().subVectors(rotateEnd, rotateStart);
          var element = scope.domElement;
          // Only allow horizontal rotation (theta), disable vertical tilt (phi)
          sphericalDelta.theta -= 2 * Math.PI * rotateDelta.x / element.clientHeight * scope.rotateSpeed;
          // Don't update phi - keep tilt locked (phi is locked in update function)
          rotateStart.copy(rotateEnd);
          break;
          
        case STATE.DOLLY:
          dollyEnd.set(event.clientX, event.clientY);
          var dollyDelta = new THREE.Vector2().subVectors(dollyEnd, dollyStart);
          if (dollyDelta.y > 0) {
            scale /= 0.95;
          } else if (dollyDelta.y < 0) {
            scale *= 0.95;
          }
          dollyStart.copy(dollyEnd);
          break;
          
        case STATE.PAN:
          panEnd.set(event.clientX, event.clientY);
          var panDelta = new THREE.Vector2().subVectors(panEnd, panStart);
          var element = scope.domElement;
          var distance = scope.camera.position.distanceTo(scope.target);
          panDelta.multiplyScalar(distance * scope.panSpeed * 0.001);
          var panLeft = new THREE.Vector3();
          var panUp = new THREE.Vector3();
          panLeft.setFromMatrixColumn(scope.camera.matrix, 0).multiplyScalar(-panDelta.x);
          panUp.setFromMatrixColumn(scope.camera.matrix, 1).multiplyScalar(panDelta.y);
          panOffset.add(panLeft).add(panUp);
          panStart.copy(panEnd);
          break;
      }
    }
    
    function onMouseUp(event) {
      if (state !== STATE.NONE) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        scope.domElement.style.cursor = 'default';
        state = STATE.NONE;
      }
    }
    
    function onMouseWheel(event) {
      if (!scope.enabled || !scope.enableZoom || state !== STATE.NONE) return;
      event.preventDefault();
      event.stopPropagation();
      
      if (event.deltaY < 0) {
        scale /= 0.95;
      } else if (event.deltaY > 0) {
        scale *= 0.95;
      }
    }
    
    function onContextMenu(event) {
      if (!scope.enabled) return;
      event.preventDefault();
    }
    
    // Attach event listeners
    scope.domElement.addEventListener('contextmenu', onContextMenu);
    scope.domElement.addEventListener('mousedown', onMouseDown);
    scope.domElement.addEventListener('wheel', onMouseWheel);
    
    this.dispose = function() {
      scope.domElement.removeEventListener('contextmenu', onContextMenu);
      scope.domElement.removeEventListener('mousedown', onMouseDown);
      scope.domElement.removeEventListener('wheel', onMouseWheel);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }
  
  global.OrbitControls = OrbitControls;
  
})(window);
