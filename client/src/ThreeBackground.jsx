import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const ThreeBackground = () => {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const pointLight1 = new THREE.PointLight(0x00f2ff, 5, 100);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x7000ff, 5, 100);
    pointLight2.position.set(-5, -5, -5);
    scene.add(pointLight2);

    // Core Orb (Solid, glowing effect)
    const coreGeometry = new THREE.IcosahedronGeometry(1.5, 2);
    const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x7000ff,
        emissiveIntensity: 0.8,
        wireframe: false,
        transparent: true,
        opacity: 0.9,
        roughness: 0.2,
        metalness: 0.8
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);

    // Outer Wireframe
    const wireGeometry = new THREE.IcosahedronGeometry(2.2, 1);
    const wireMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00f2ff, 
        emissive: 0x00f2ff,
        emissiveIntensity: 0.5,
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });
    const wireframe = new THREE.Mesh(wireGeometry, wireMaterial);

    const orbGroup = new THREE.Group();
    orbGroup.add(core);
    orbGroup.add(wireframe);
    scene.add(orbGroup);

    const createNoteTexture = (char) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        
        context.fillStyle = 'transparent';
        context.fillRect(0, 0, 64, 64);
        
        context.fillStyle = '#ffffff';
        context.font = 'bold 40px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(char, 32, 32);
        
        return new THREE.CanvasTexture(canvas);
    };

    const texture1 = createNoteTexture('♪');
    const texture2 = createNoteTexture('♫');

    const particlesGroup = new THREE.Group();
    scene.add(particlesGroup);

    const systems = [];

    const createParticleSystem = (texture, count, size, color) => {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        for(let i=0; i < count * 3; i++) {
            pos[i] = (Math.random() - 0.5) * 40;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        
        const mat = new THREE.PointsMaterial({
            size: size,
            map: texture,
            color: color,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.Points(geo, mat);
        particlesGroup.add(mesh);
        systems.push({ geo, mat });
    };

    // Create different groups of notes
    createParticleSystem(texture1, 300, 1.2, 0x00f2ff); // Cyan
    createParticleSystem(texture2, 200, 1.5, 0x7000ff); // Purple
    createParticleSystem(texture1, 150, 0.8, 0xff007a); // Pink

    camera.position.z = 10;

    let targetX = 0;
    let targetY = 0;
    const handleMouseMove = (e) => {
        // Increase the movement range (divide by 50 instead of 100)
        targetX = (e.clientX - window.innerWidth / 2) / 50;
        targetY = (e.clientY - window.innerHeight / 2) / 50;
    };
    document.addEventListener('mousemove', handleMouseMove);

    const clock = new THREE.Clock();
    let animationFrameId;

    let currentMouseX = 0;
    let currentMouseY = 0;

    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        const elapsedTime = clock.getElapsedTime();

        // Smooth interpolation for mouse positions (increased from 0.02 to 0.08 for faster response)
        currentMouseX += (targetX - currentMouseX) * 0.08;
        currentMouseY += (targetY - currentMouseY) * 0.08;

        // Smooth continuous rotation
        orbGroup.rotation.y += 0.002;
        orbGroup.rotation.x += 0.001;
        
        // Counter rotation for core
        core.rotation.y -= 0.003;
        core.rotation.z += 0.002;

        // Floating effect
        orbGroup.position.y = Math.sin(elapsedTime * 0.8) * 0.4;

        // Apply mouse rotation to the orb group for a cooler 3D feel
        orbGroup.rotation.y += currentMouseX * 0.05;
        orbGroup.rotation.x += currentMouseY * 0.05;

        // Dynamic pulsing core
        coreMaterial.emissiveIntensity = 0.5 + Math.sin(elapsedTime * 2) * 0.3;

        // Gentle particle movement + mouse parallax
        particlesGroup.rotation.y = elapsedTime * 0.02 + currentMouseX * 0.1;
        particlesGroup.rotation.x = elapsedTime * 0.01 + currentMouseY * 0.1;
        
        // Smooth camera movement towards mouse
        camera.position.x = currentMouseX * 2;
        camera.position.y = -currentMouseY * 2;
        camera.lookAt(scene.position);

        renderer.render(scene, camera);
    };

    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
      }
      // Clean up three js resources
      coreGeometry.dispose();
      coreMaterial.dispose();
      wireGeometry.dispose();
      wireMaterial.dispose();
      texture1.dispose();
      texture2.dispose();
      systems.forEach(sys => {
          sys.geo.dispose();
          sys.mat.dispose();
      });
      renderer.dispose();
    };
  }, []);

  return <div id="three-bg" ref={mountRef} />;
};

export default ThreeBackground;
