// client/src/components/WavesBackground.jsx
// Fondo estático de olas. variant="blue" (default, Kazaro) o "green" (Pazar).

const PALETTES = {
  blue: {
    base: ["#0d5aa0", "#0b4a8c", "#093f7d"],
    a: ["#5fe6df", "#1f89bd"],
    b: ["#3ecfd8", "#1a72ad"],
    c: ["#2fb6c9", "#155f9d"],
    d: ["#1f96b8", "#0f4f8f"],
  },
  green: {
    base: ["#2f6f1e", "#1f5416", "#163f10"],
    a: ["#d4ec7a", "#7cb342"],
    b: ["#b8dd5a", "#6ba838"],
    c: ["#9ccb45", "#5c9530"],
    d: ["#7bb23a", "#4a7d28"],
  },
};

export default function WavesBackground({ variant = "blue" }) {
  const p = PALETTES[variant] || PALETTES.blue;
  return (
    <div className="login-waves" aria-hidden="true">
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="wavesBase" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={p.base[0]} />
            <stop offset="45%" stopColor={p.base[1]} />
            <stop offset="100%" stopColor={p.base[2]} />
          </linearGradient>
          <linearGradient id="wavesA" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor={p.a[0]} />
            <stop offset="100%" stopColor={p.a[1]} />
          </linearGradient>
          <linearGradient id="wavesB" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor={p.b[0]} />
            <stop offset="100%" stopColor={p.b[1]} />
          </linearGradient>
          <linearGradient id="wavesC" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor={p.c[0]} />
            <stop offset="100%" stopColor={p.c[1]} />
          </linearGradient>
          <linearGradient id="wavesD" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor={p.d[0]} />
            <stop offset="100%" stopColor={p.d[1]} />
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
