export function MatchGlobalStyles() {
  return (
    <style jsx global>{`
      .hit-blink {
        animation: hit-blink 0.18s steps(2, end) 4;
      }
      .impact-burst {
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        border: 3px solid rgba(251, 146, 60, 0.95);
        box-shadow: 0 0 18px rgba(251, 146, 60, 0.9);
        animation: impact-burst 0.42s ease-out forwards;
      }
      .heart-shake {
        animation: heart-shake 0.45s ease-in-out;
      }
      .flame-aura {
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        background: radial-gradient(
          circle at 50% 65%,
          rgba(251, 146, 60, 0.9),
          rgba(251, 146, 60, 0.35) 55%,
          rgba(251, 146, 60, 0) 75%
        );
        filter: blur(0.4px);
        animation: flame-flicker 0.28s ease-in-out infinite alternate;
      }
      .piece-explode {
        animation: piece-explode 0.45s ease-out forwards;
      }
      @keyframes hit-blink {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.2;
        }
        100% {
          opacity: 1;
        }
      }
      @keyframes impact-burst {
        0% {
          transform: translate(-50%, -50%) scale(0.4);
          opacity: 1;
        }
        100% {
          transform: translate(-50%, -50%) scale(2.1);
          opacity: 0;
        }
      }
      @keyframes heart-shake {
        0% {
          transform: translateX(0);
        }
        20% {
          transform: translateX(-2px);
        }
        40% {
          transform: translateX(2px);
        }
        60% {
          transform: translateX(-2px);
        }
        80% {
          transform: translateX(2px);
        }
        100% {
          transform: translateX(0);
        }
      }
      @keyframes flame-flicker {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.8;
        }
        100% {
          transform: translate(-50%, -50%) scale(1.12);
          opacity: 1;
        }
      }
      @keyframes piece-explode {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        70% {
          transform: translate(-50%, -50%) scale(1.8);
          opacity: 0.9;
        }
        100% {
          transform: translate(-50%, -50%) scale(2.1);
          opacity: 0;
        }
      }
    `}</style>
  );
}
