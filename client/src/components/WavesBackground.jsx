// client/src/components/WavesBackground.jsx
// Fondo estático de olas (usado solo en la pantalla de selección de empresa).

export default function WavesBackground() {
  return (
    <div className="login-waves" aria-hidden="true">
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="wavesBase" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0d5aa0" />
            <stop offset="45%" stopColor="#0b4a8c" />
            <stop offset="100%" stopColor="#093f7d" />
          </linearGradient>
          <linearGradient id="wavesA" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor="#5fe6df" />
            <stop offset="100%" stopColor="#1f89bd" />
          </linearGradient>
          <linearGradient id="wavesB" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor="#3ecfd8" />
            <stop offset="100%" stopColor="#1a72ad" />
          </linearGradient>
          <linearGradient id="wavesC" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor="#2fb6c9" />
            <stop offset="100%" stopColor="#155f9d" />
          </linearGradient>
          <linearGradient id="wavesD" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor="#1f96b8" />
            <stop offset="100%" stopColor="#0f4f8f" />
          </linearGradient>
        </defs>

        <rect width="1920" height="1080" fill="url(#wavesBase)" />

        <path
          d="M0,0 H520 C 380,220 300,420 380,620 C 440,780 560,920 500,1080 H0 Z"
          fill="url(#wavesD)"
          opacity="0.9"
        />
        <path
          d="M0,0 H430 C 300,210 230,410 300,600 C 360,760 470,900 420,1080 H0 Z"
          fill="url(#wavesC)"
          opacity="0.92"
        />
        <path
          d="M0,0 H320 C 210,200 160,390 220,570 C 270,720 360,860 320,1080 H0 Z"
          fill="url(#wavesB)"
          opacity="0.95"
        />
        <path
          d="M0,0 H190 C 120,190 90,370 130,540 C 165,690 230,830 200,1080 H0 Z"
          fill="url(#wavesA)"
        />
      </svg>
    </div>
  );
}
