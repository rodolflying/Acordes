import React from 'react';

const CelestialIcon = ({ mood }) => {
  // Normalize mood name
  const m = mood ? mood.trim().toLowerCase() : '';

  // Render SVG content based on mood
  switch (m) {
    case 'melancólico':
    case 'melancholic':
      // Crescent Moon + Diagonal Rings + Orbital Nodes
      return (
        <svg className="celestial-svg mood-melancolico" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-melancolico" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-melancolico)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-melancolico)" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Ambient Glow */}
          <circle cx="50" cy="50" r="40" fill="url(#glow-melancolico)" />
          
          {/* Back half of the ring (drawn behind moon body) */}
          <path className="ring-path ring-back stream-active-reverse" d="M 12,60 A 42 16 0 0,1 88,40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.4" transform="rotate(-15 50 50)" />
          
          {/* Central Crescent Moon */}
          <path className="celestial-body float-body" d="M45,28 A20,20 0 1,0 72,55 A16,16 0 1,1 45,28 Z" fill="currentColor" />
          
          {/* Front half of the ring (drawn in front of moon body) */}
          <path className="ring-path ring-front stream-active" d="M 88,40 A 42 16 0 0,1 12,60" stroke="currentColor" strokeWidth="2.5" strokeDasharray="25 8" transform="rotate(-15 50 50)" />
          
          {/* Inner ring */}
          <ellipse className="ring-path ring-inner stream-active-reverse" cx="50" cy="50" rx="28" ry="8" stroke="currentColor" strokeWidth="1" strokeDasharray="15 5" opacity="0.6" transform="rotate(-15 50 50)" />
          
          {/* Orbiting particles */}
          <g className="orbit-particles" transform="rotate(-15 50 50)">
            <circle className="particle p1" cx="12" cy="60" r="3.5" fill="currentColor" />
            <circle className="particle p2" cx="88" cy="40" r="2" fill="currentColor" />
          </g>
        </svg>
      );

    case 'enérgico':
    case 'energetic':
      // Lightning Bolt + High-Speed Concentric Zig-Zag Orbits
      return (
        <svg className="celestial-svg mood-energetico" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-energetico" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-energetico)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-energetico)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-energetico)" />
          
          {/* Lightning Core */}
          <path className="celestial-body pulse-body" d="M54,18 L32,53 L49,53 L40,82 L66,45 L48,45 Z" fill="currentColor" />
          
          {/* Double Orbit Tracks */}
          <circle className="ring-path ring-track-1 stream-active" cx="50" cy="50" r="32" stroke="currentColor" strokeWidth="1" strokeDasharray="6 8" opacity="0.6" />
          <circle className="ring-path ring-track-2 stream-active-reverse" cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 4 4 4" opacity="0.8" />
          
          {/* Fast Orbiting Nodes */}
          <g className="orbit-nodes-energetic">
            <circle className="particle node-e1" cx="50" cy="18" r="4" fill="currentColor" />
            <circle className="particle node-e2" cx="50" cy="92" r="3" fill="currentColor" />
          </g>
        </svg>
      );

    case 'romántico':
    case 'romantic':
      // Heart + Soft Concentric Orbits + Stars
      return (
        <svg className="celestial-svg mood-romantico" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-romantico" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-romantico)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-romantico)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-romantico)" />
          
          {/* Orbit paths */}
          <ellipse className="ring-path ring-r1 stream-active" cx="50" cy="50" rx="38" ry="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 6" transform="rotate(30 50 50)" />
          <ellipse className="ring-path ring-r2 stream-active-reverse" cx="50" cy="50" rx="28" ry="8" stroke="currentColor" strokeWidth="1" strokeDasharray="12 4" opacity="0.6" transform="rotate(-30 50 50)" />
          
          {/* Heart Core */}
          <path className="celestial-body float-body" d="M50,68 C45,63 32,53 32,41 C32,31 39,26 47,28 C50,29.5 50,32 50,32 C50,32 50,29.5 53,28 C61,26 68,31 68,41 C68,53 55,63 50,68 Z" fill="currentColor" />
          
          {/* Heart nodes */}
          <g className="orbit-particles" transform="rotate(30 50 50)">
            <circle className="particle pr1" cx="88" cy="50" r="3" fill="currentColor" />
            <circle className="particle pr2" cx="12" cy="50" r="2" fill="currentColor" />
          </g>
        </svg>
      );

    case 'reflexivo':
    case 'reflective':
      // Multi-axial Gyroscopic Atom + Central Glow Sphere
      return (
        <svg className="celestial-svg mood-reflexivo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-reflexivo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-reflexivo)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--mood-reflexivo)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-reflexivo)" />
          
          {/* Three Intersecting Gyro-Rings */}
          <ellipse className="ring-path gyro-ring-1 stream-active" cx="50" cy="50" rx="38" ry="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="30 8" transform="rotate(0 50 50)" />
          <ellipse className="ring-path gyro-ring-2 stream-active-reverse" cx="50" cy="50" rx="38" ry="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 6" transform="rotate(60 50 50)" />
          <ellipse className="ring-path gyro-ring-3 stream-active" cx="50" cy="50" rx="38" ry="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="25 7" transform="rotate(120 50 50)" />
          
          {/* Central Shiny Orb */}
          <circle className="celestial-body float-body" cx="50" cy="50" r="14" fill="currentColor" />
          <circle cx="46" cy="46" r="4" fill="#ffffff" opacity="0.6" />
          
          {/* Gyro orbiting dots */}
          <g className="gyro-dots">
            <circle className="particle gd1" cx="88" cy="50" r="2.5" fill="currentColor" />
          </g>
        </svg>
      );

    case 'alegre':
    case 'happy':
      // Sun + Expanding Concentric Waves
      return (
        <svg className="celestial-svg mood-alegre" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-alegre" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-alegre)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-alegre)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-alegre)" />
          
          {/* Expanding Pulsing Ring waves */}
          <circle className="ring-path wave-ring-1 stream-active-reverse" cx="50" cy="50" r="25" stroke="currentColor" strokeWidth="1" strokeDasharray="10 4" opacity="0.4" />
          <circle className="ring-path wave-ring-2 stream-active" cx="50" cy="50" r="35" stroke="currentColor" strokeWidth="1.5" strokeDasharray="15 5" opacity="0.6" />
          <circle className="ring-path wave-ring-3 stream-active-reverse" cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.8" />
          
          {/* Central Sun */}
          <circle className="celestial-body spin-body" cx="50" cy="50" r="15" fill="currentColor" />
          
          {/* Solar Flares/Ray items */}
          <g className="sun-rays">
            <line x1="50" y1="26" x2="50" y2="31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="50" y1="69" x2="50" y2="74" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="26" y1="50" x2="31" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="69" y1="50" x2="74" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
      );

    case 'nostálgico':
    case 'nostalgic':
      // Sunset Half-Sun + Horizon Wave Bands
      return (
        <svg className="celestial-svg mood-nostalgico" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-nostalgico" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-nostalgico)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-nostalgico)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-nostalgico)" />
          
          {/* Layered Horizontal Bands (represent retro horizon orbits) */}
          <line className="ring-path horizon-line-1" x1="15" y1="44" x2="85" y2="44" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          <line className="ring-path horizon-line-2 stream-active" x1="10" y1="52" x2="90" y2="52" stroke="currentColor" strokeWidth="2" strokeDasharray="8 6" />
          <line className="ring-path horizon-line-3" x1="18" y1="60" x2="82" y2="60" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          
          {/* Half Sun Rise */}
          <path className="celestial-body float-body" d="M32,52 A18,18 0 0,1 68,52 Z" fill="currentColor" />
          
          {/* Orbiting Sunset Nodes */}
          <circle className="particle sunset-node" cx="80" cy="35" r="3.5" fill="currentColor" />
          <circle className="particle sunset-node-2" cx="22" cy="38" r="2" fill="currentColor" />
        </svg>
      );

    case 'épico':
    case 'epic':
      // Flame Core + Fast Tilted Loop Ellipses
      return (
        <svg className="celestial-svg mood-epico" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="glow-epico" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--mood-epico)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--mood-epico)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="url(#glow-epico)" />
          
          {/* Heavy Orbiting Loops */}
          <ellipse className="ring-path epic-ring-1 stream-active" cx="50" cy="50" rx="40" ry="10" stroke="currentColor" strokeWidth="2" strokeDasharray="30 8" transform="rotate(-40 50 50)" />
          <ellipse className="ring-path epic-ring-2 stream-active-reverse" cx="50" cy="50" rx="34" ry="7" stroke="currentColor" strokeWidth="1.2" strokeDasharray="20 6" opacity="0.6" transform="rotate(45 50 50)" />
          
          {/* Flame Core */}
          <path className="celestial-body pulse-body" d="M50,18 C58,35 64,46 64,55 C64,64 58,70 50,70 C42,70 36,64 36,55 C36,46 45,30 50,18 Z M50,42 C46,47 44,52 44,56 C44,60 47,62 50,62 C53,62 56,60 56,56 C56,52 54,47 50,42 Z" fill="currentColor" />
          
          {/* Flame spark particles */}
          <g className="orbit-particles" transform="rotate(-40 50 50)">
            <circle className="particle pe1" cx="90" cy="50" r="3.5" fill="currentColor" />
            <circle className="particle pe2" cx="10" cy="50" r="2" fill="currentColor" />
          </g>
        </svg>
      );

    default:
      // Generic Music Planet with a Single Ring
      return (
        <svg className="celestial-svg mood-generic" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />
          <ellipse className="ring-path" cx="50" cy="50" rx="35" ry="10" stroke="currentColor" strokeWidth="1.5" transform="rotate(-20 50 50)" />
          <circle className="celestial-body float-body" cx="50" cy="50" r="14" fill="currentColor" />
          <circle className="particle" cx="15" cy="50" r="3" fill="currentColor" />
        </svg>
      );
  }
};

export default CelestialIcon;
